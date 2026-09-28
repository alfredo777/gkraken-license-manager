// Lee un cuerpo de respuesta (fetch) línea por línea sin perder el streaming:
// cada línea se reenvía al cliente apenas llega, y se puede inspeccionar o filtrar.
const pipeLines = async (upstream, onLine) => {
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl + 1);
      buffer = buffer.slice(nl + 1);
      onLine(line);
    }
  }
  buffer += decoder.decode();
  if (buffer) onLine(buffer);
};

const dataOf = (line) => {
  const t = line.trim();
  if (!t.startsWith('data:')) return null;
  const payload = t.slice(5).trim();
  if (!payload || payload === '[DONE]') return null;
  try { return JSON.parse(payload); } catch (_) { return null; }
};

module.exports = { pipeLines, dataOf };
