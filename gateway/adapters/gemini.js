// Formato nativo de Google Gemini (generateContent / streamGenerateContent).
// La app manda el token en ?key= como haría con Google; aquí se cambia por la
// clave real en la cabecera x-goog-api-key.
const { pipeLines, dataOf } = require('../sse');

const usageFrom = (meta, meter) => {
  if (!meta) return;
  meter.input = meta.promptTokenCount || 0;
  meter.output = (meta.candidatesTokenCount || 0) + (meta.thoughtsTokenCount || 0);
  meter.measured = true;
};

module.exports = {
  format: 'gemini',

  errorBody: (status, message) => ({ error: { code: status, message, status: status === 401 ? 'UNAUTHENTICATED' : status === 402 || status === 429 ? 'RESOURCE_EXHAUSTED' : status === 403 ? 'PERMISSION_DENIED' : status === 404 ? 'NOT_FOUND' : 'UNAVAILABLE' } }),

  target: (req) => ({ modelId: req.params[0] }),

  prepare: (body, model) => {
    const generationConfig = { ...(body.generationConfig || {}) };
    generationConfig.maxOutputTokens = Math.min(Number(generationConfig.maxOutputTokens) || model.max_output_tokens, model.max_output_tokens);
    return { body: { ...body, generationConfig }, maxOutput: generationConfig.maxOutputTokens, inputForEstimate: [body.contents, body.systemInstruction] };
  },

  forward: async ({ req, res, body, provider, apiKey, signal, meter }) => {
    const action = req.params[1];
    const alt = action === 'streamGenerateContent' ? '?alt=sse' : '';
    const upstream = await fetch(`${provider.base_url.replace(/\/$/, '')}/models/${encodeURIComponent(req.params[0])}:${action}${alt}`, {
      method: 'POST', signal,
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    meter.httpStatus = upstream.status;
    if (!upstream.ok || !alt) {
      const text = await upstream.text();
      let data = null;
      try { data = JSON.parse(text); } catch (_) { data = null; }
      usageFrom(data?.usageMetadata, meter);
      if (!upstream.ok) meter.error = String(data?.error?.message || text).slice(0, 255);
      res.status(upstream.status).type(upstream.headers.get('content-type') || 'application/json').send(text);
      return;
    }
    res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    res.flushHeaders();
    await pipeLines(upstream, (line) => {
      const data = dataOf(line);
      if (data) {
        usageFrom(data.usageMetadata, meter);
        for (const c of data.candidates || []) for (const p of c.content?.parts || []) meter.textChars += (p.text || '').length;
      }
      res.write(line);
    });
    res.end();
  }
};
