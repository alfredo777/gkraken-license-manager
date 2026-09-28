// Pasa una licencia a PRO tras un pago (Stripe, PayPal, Bitcoin, manual) o por
// decisión del admin. La clave de licencia NO cambia: la app sigue usando la
// misma clave y solo ve cambiar license_type / plan_type / fechas.
const { License, Payment } = require('../models');
const { sendPaymentConfirmation, sendLicenseInfo } = require('./mailer');

const PLAN_TYPES = ['monthly', 'annual'];

const endDateFor = (license, planType) => {
  // Si ya es PRO vigente, el periodo nuevo se suma al final del actual.
  const now = new Date();
  const current = license.end_date ? new Date(license.end_date) : null;
  const base = (license.license_type === 'pro' && license.status === 'active' && current && current > now) ? current : now;
  const end = new Date(base);
  if (planType === 'annual') end.setFullYear(end.getFullYear() + 1); else end.setMonth(end.getMonth() + 1);
  return end;
};

/**
 * @param {License} license
 * @param {object} opts plan_type, payment {method, amount, currency, transaction_id, details, ip}, extra (campos
 *   adicionales del License), notify (default true)
 * @returns {{applied: boolean, duplicate?: boolean}}
 */
const applyUpgrade = async (license, { plan_type, payment, extra = {}, notify = true }) => {
  if (!PLAN_TYPES.includes(plan_type)) throw new Error(`plan_type inválido: ${plan_type}`);
  if (payment?.transaction_id) {
    const dup = await Payment.findOne({ where: { transaction_id: payment.transaction_id } });
    if (dup) return { applied: false, duplicate: true };
  }
  const wasActivePro = license.license_type === 'pro' && license.status === 'active';
  await license.update({
    license_type: 'pro', plan_type, status: 'active',
    start_date: wasActivePro && license.start_date ? license.start_date : new Date(),
    end_date: endDateFor(license, plan_type),
    max_devices: Math.max(license.max_devices || 1, 1),
    ...extra
  });
  if (payment) {
    await Payment.create({
      license_id: license.id, amount: payment.amount, currency: payment.currency || 'USD', method: payment.method,
      plan_type, transaction_id: payment.transaction_id, status: 'completed',
      payment_details: payment.details ? JSON.stringify(payment.details) : null, ip_address: payment.ip || null, paid_at: new Date()
    });
    if (notify) await sendPaymentConfirmation(license.email, license.name, payment.amount, plan_type);
  }
  if (notify) await sendLicenseInfo(license.email, license.toJSON());
  return { applied: true };
};

// Busca la licencia de un pago por id; devuelve null si no existe.
const findLicense = (id) => (id ? License.findByPk(id) : null);

module.exports = { applyUpgrade, findLicense, PLAN_TYPES };
