// Límites por token dentro de este proceso: peticiones por minuto y peticiones
// simultáneas. Evitan que un solo usuario sature el gateway o la cuenta del
// proveedor. Con varias copias del gateway, cada copia aplica su propio límite.
const windows = new Map();
const running = new Map();

const tryAcquire = (tokenId, { rpm, maxConcurrent }) => {
  const now = Date.now();
  const recent = (windows.get(tokenId) || []).filter(t => now - t < 60000);
  if (rpm > 0 && recent.length >= rpm) { windows.set(tokenId, recent); return { ok: false, reason: 'Demasiadas peticiones por minuto.', retryAfter: Math.ceil((60000 - (now - recent[0])) / 1000) }; }
  const active = running.get(tokenId) || 0;
  if (maxConcurrent > 0 && active >= maxConcurrent) return { ok: false, reason: 'Demasiadas peticiones al mismo tiempo.', retryAfter: 2 };
  recent.push(now);
  windows.set(tokenId, recent);
  running.set(tokenId, active + 1);
  let released = false;
  return { ok: true, release: () => { if (released) return; released = true; running.set(tokenId, Math.max(0, (running.get(tokenId) || 1) - 1)); } };
};

const reset = () => { windows.clear(); running.clear(); };

module.exports = { tryAcquire, reset };
