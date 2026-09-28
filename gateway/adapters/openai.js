// Formato "chat completions" de OpenAI. Sirve para OpenAI, Grok (xAI), DeepSeek,
// Qwen (modo compatible), Mistral, Groq, Kimi y cualquier API compatible.
const { pipeLines, dataOf } = require('../sse');

module.exports = {
  format: 'openai',

  errorBody: (status, message) => ({ error: { message, type: status === 401 ? 'invalid_api_key' : status === 402 ? 'insufficient_quota' : status === 429 ? 'rate_limit_exceeded' : 'green_kraken_error', code: status } }),

  target: (req, body) => ({ providerSlug: req.params.provider, modelId: body.model }),

  prepare: (body, model) => {
    const out = { ...body };
    for (const field of ['max_tokens', 'max_completion_tokens']) {
      if (out[field] != null) out[field] = Math.min(Number(out[field]) || model.max_output_tokens, model.max_output_tokens);
    }
    const requested = Number(out.max_completion_tokens || out.max_tokens) || model.max_output_tokens;
    out._clientWantsUsage = Boolean(body.stream_options?.include_usage);
    if (out.stream) out.stream_options = { ...(body.stream_options || {}), include_usage: true };
    return { body: out, maxOutput: requested, inputForEstimate: [body.messages, body.tools] };
  },

  forward: async ({ res, body, provider, apiKey, signal, meter }) => {
    const { _clientWantsUsage, ...payload } = body;
    const upstream = await fetch(`${provider.base_url.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST', signal,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: payload.stream ? 'text/event-stream' : 'application/json' },
      body: JSON.stringify(payload)
    });
    meter.httpStatus = upstream.status;
    if (!upstream.ok || !payload.stream) {
      const text = await upstream.text();
      let data = null;
      try { data = JSON.parse(text); } catch (_) { data = null; }
      if (data?.usage) { meter.input = data.usage.prompt_tokens || 0; meter.output = data.usage.completion_tokens || 0; meter.measured = true; }
      if (!upstream.ok) meter.error = String(data?.error?.message || text).slice(0, 255);
      res.status(upstream.status).type(upstream.headers.get('content-type') || 'application/json').send(text);
      return;
    }
    res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders();
    await pipeLines(upstream, (line) => {
      const data = dataOf(line);
      if (data) {
        if (data.usage) { meter.input = data.usage.prompt_tokens || 0; meter.output = data.usage.completion_tokens || 0; meter.measured = true; }
        const choices = Array.isArray(data.choices) ? data.choices : [];
        for (const c of choices) meter.textChars += (c.delta?.content || '').length;
        // El trozo final solo con "usage" lo pedimos nosotros para medir; si la app
        // no lo pidió, no se le manda (su lector espera siempre choices[0]).
        if (choices.length === 0 && data.usage && !_clientWantsUsage) return;
      }
      res.write(line);
    });
    res.end();
  }
};
