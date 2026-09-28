// Formato de mensajes de Anthropic (Claude). Usa el SDK oficial y reenvía cada
// evento del stream tal cual, así la app no nota diferencia con la API directa.
const { Anthropic, APIError, APIConnectionError, APIUserAbortError } = require('@anthropic-ai/sdk');

// Un cliente por proveedor y clave: reutiliza conexiones HTTP (keep-alive) en
// lugar de abrir una nueva por petición. Si la clave cambia, se crea otro.
const clients = new Map();
const clientFor = (provider, apiKey) => {
  const id = `${provider.id}:${provider.base_url}:${require('crypto').createHash('sha256').update(apiKey).digest('hex')}`;
  let client = clients.get(id);
  if (!client) {
    for (const key of clients.keys()) if (key.startsWith(`${provider.id}:`)) clients.delete(key);
    client = new Anthropic({ apiKey, baseURL: provider.base_url, maxRetries: 0, timeout: 10 * 60 * 1000 });
    clients.set(id, client);
  }
  return client;
};

const inputTokens = (u = {}) => (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);

module.exports = {
  format: 'anthropic',

  errorBody: (status, message) => ({ type: 'error', error: { type: status === 401 ? 'authentication_error' : status === 402 ? 'billing_error' : status === 403 ? 'permission_error' : status === 429 ? 'rate_limit_error' : status === 404 ? 'not_found_error' : 'api_error', message } }),

  target: (req, body) => ({ modelId: body.model }),

  prepare: (body, model) => {
    const maxOutput = Math.min(Number(body.max_tokens) || model.max_output_tokens, model.max_output_tokens);
    return { body: { ...body, max_tokens: maxOutput }, maxOutput, inputForEstimate: [body.system, body.messages, body.tools] };
  },

  forward: async ({ req, res, body, provider, apiKey, signal, meter }) => {
    const client = clientFor(provider, apiKey);
    const headers = {};
    if (req.get('anthropic-beta')) headers['anthropic-beta'] = req.get('anthropic-beta');
    try {
      if (body.stream) {
        const stream = await client.messages.create(body, { signal, headers });
        res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        res.flushHeaders();
        for await (const event of stream) {
          if (event.type === 'message_start') { meter.input = inputTokens(event.message.usage); meter.output = event.message.usage?.output_tokens || 0; meter.measured = true; }
          else if (event.type === 'message_delta' && event.usage) {
            if (event.usage.output_tokens != null) meter.output = event.usage.output_tokens;
            if (event.usage.input_tokens != null) meter.input = Math.max(meter.input, inputTokens(event.usage));
          } else if (event.type === 'content_block_delta') meter.textChars += (event.delta?.text || event.delta?.thinking || '').length;
          res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        }
        res.end();
      } else {
        const message = await client.messages.create(body, { signal, headers });
        meter.input = inputTokens(message.usage); meter.output = message.usage?.output_tokens || 0; meter.measured = true;
        res.status(200).json(message);
      }
    } catch (error) {
      if (error instanceof APIUserAbortError) { meter.status = 'aborted'; return; }
      if (error instanceof APIConnectionError) throw error;
      if (error instanceof APIError && error.status) {
        meter.httpStatus = error.status;
        meter.error = String(error.message).slice(0, 255);
        const payload = error.error || { type: 'error', error: { type: 'api_error', message: error.message } };
        if (!res.headersSent) return res.status(error.status).json(payload);
        res.write(`event: error\ndata: ${JSON.stringify(payload)}\n\n`);
        return res.end();
      }
      throw error;
    }
  }
};
