// Cuota de tokens del periodo.
//
// Cada copia del gateway toma "préstamos" de tokens de la base de datos con una
// actualización atómica (varias copias nunca pueden pasarse del límite) y los
// gasta desde memoria. Así hay una escritura por préstamo y no una por petición.
// Lo que sobra se devuelve cuando el préstamo queda sin uso y al apagar.
const { Op, literal } = require('sequelize');
const { AiSubscription } = require('../models');

const LEASE = Number(process.env.AI_QUOTA_LEASE_TOKENS || 20000);
const IDLE_RETURN_MS = Number(process.env.AI_QUOTA_LEASE_IDLE_MS || 15000);
const int = (n) => Math.max(0, Math.ceil(Number(n) || 0));

// Un préstamo pertenece a un periodo: al renovarse el mes (tokens_used vuelve a 0)
// el préstamo viejo se descarta en lugar de devolverse al periodo nuevo.
const leases = new Map(); // `${id}:${periodStart}` -> { id, period, balance, touched, pending }
const keyOf = (sub) => `${sub.id}:${new Date(sub.period_start).getTime()}`;

const takeFromDb = async (subscriptionId, amount) => {
  const [affected] = await AiSubscription.update(
    { tokens_used: literal(`tokens_used + ${amount}`) },
    { where: { id: subscriptionId, status: 'active', [Op.and]: literal(`tokens_used + ${amount} <= tokens_limit`) } }
  );
  return affected === 1;
};

const giveBackToDb = (lease, amount) => amount > 0 && AiSubscription.update(
  { tokens_used: literal(`CASE WHEN tokens_used - ${amount} < 0 THEN 0 ELSE tokens_used - ${amount} END`) },
  { where: { id: lease.id, period_start: lease.period } }
);

const leaseOf = (sub) => {
  const key = keyOf(sub);
  let l = leases.get(key);
  if (!l) { l = { id: sub.id, period: new Date(sub.period_start), balance: 0, touched: Date.now(), pending: null }; leases.set(key, l); }
  return l;
};

// Reserva n tokens. Primero del préstamo en memoria; si no alcanza, pide más a la
// base de datos (un préstamo grande, o justo lo necesario si queda poco del plan).
const reserve = async (subscription, n) => {
  const subscriptionId = subscription.id;
  const amount = int(n);
  const lease = leaseOf(subscription);
  lease.touched = Date.now();
  for (;;) {
    if (lease.balance >= amount) { lease.balance -= amount; return true; }
    if (lease.pending) { await lease.pending; continue; }
    const need = amount - lease.balance;
    lease.pending = (async () => {
      if (await takeFromDb(subscriptionId, Math.max(need, LEASE))) { lease.balance += Math.max(need, LEASE); return true; }
      if (await takeFromDb(subscriptionId, need)) { lease.balance += need; return true; }
      return false;
    })();
    const ok = await lease.pending.finally(() => { lease.pending = null; });
    if (!ok) return false;
  }
};

// Cambia lo reservado por lo que realmente se usó.
const settle = async (subscription, reserved, actual) => {
  const subscriptionId = subscription.id;
  const delta = int(actual) - int(reserved);
  if (delta === 0) return;
  const lease = leaseOf(subscription);
  if (delta < 0) { lease.balance += -delta; return; }
  // Se usó más de lo reservado: primero del préstamo, el resto directo a la base.
  const fromLease = Math.min(lease.balance, delta);
  lease.balance -= fromLease;
  const rest = delta - fromLease;
  if (rest > 0) await AiSubscription.update({ tokens_used: literal(`tokens_used + ${rest}`) }, { where: { id: subscriptionId } });
};

// Devuelve a la base los préstamos sin uso reciente (o todos, al apagar).
const returnLeases = async (all = false) => {
  for (const [key, lease] of leases) {
    if (lease.pending || (!all && Date.now() - lease.touched < IDLE_RETURN_MS)) continue;
    const amount = lease.balance;
    leases.delete(key);
    if (amount > 0) await giveBackToDb(lease, amount);
  }
};

let timer = null;
const start = () => { if (!timer) { timer = setInterval(() => returnLeases().catch(e => console.error('Préstamos de cuota:', e.message)), 5000); timer.unref(); } };
const stop = async () => { if (timer) clearInterval(timer); timer = null; await returnLeases(true); };
const reset = () => leases.clear();

// Tokens prestados a esta copia que aún no se gastan (para mostrar el consumo real).
const unspent = (subscription) => leases.get(keyOf(subscription))?.balance || 0;

module.exports = { reserve, settle, returnLeases, start, stop, reset, unspent };
