// Registro de consumo por lotes: las filas se juntan en memoria y se escriben
// cada FLUSH_MS con un solo INSERT, para que la base de datos no frene cada petición.
const { Op } = require('sequelize');
const { AiUsage, AiToken } = require('../models');

const FLUSH_MS = Number(process.env.AI_USAGE_FLUSH_MS || 2000);
let rows = [];
let touched = new Set();
let timer = null;

const record = (row) => {
  rows.push(row);
  if (row.token_id) touched.add(row.token_id);
};

const flush = async () => {
  const batch = rows; const tokens = [...touched];
  rows = []; touched = new Set();
  try {
    if (batch.length) await AiUsage.bulkCreate(batch);
    if (tokens.length) await AiToken.update({ last_used_at: new Date() }, { where: { id: { [Op.in]: tokens } } });
  } catch (error) {
    console.error('No se pudo guardar el consumo de IA:', error.message);
    rows = batch.concat(rows);
  }
};

const start = () => { if (!timer) { timer = setInterval(flush, FLUSH_MS); timer.unref(); } };
const stop = async () => { if (timer) clearInterval(timer); timer = null; await flush(); };

module.exports = { record, flush, start, stop };
