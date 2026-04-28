const cron = require('node-cron');
const { Op } = require('sequelize');

const startAll = () => {
  // Check expired licenses every day at midnight
  cron.schedule('0 0 * * *', async () => {
    console.log('🔄 Verificando licencias expiradas...');
    try {
      const { License } = require('../models');
      const { sendEmail } = require('./mailer');

      const expired = await License.findAll({
        where: { status: 'active', end_date: { [Op.lt]: new Date() } }
      });

      for (const license of expired) {
        if (!license.auto_renew) {
          await license.update({ status: 'expired' });
          console.log(`⏰ Licencia expirada: ${license.license_key}`);
          await sendEmail({
            to: license.email,
            subject: `${process.env.APP_NAME} - Licencia Expirada`,
            html: `<p>Hola ${license.name}, tu licencia ${license.license_key} ha expirado.</p>`
          });
        }
      }
    } catch (err) {
      console.error('Error en cron de licencias:', err);
    }
  });

  // Renewal reminders 7 days before expiry
  cron.schedule('0 9 * * *', async () => {
    try {
      const { License } = require('../models');
      const { sendEmail } = require('./mailer');
      const sevenDays = new Date();
      sevenDays.setDate(sevenDays.getDate() + 7);

      const expiringSoon = await License.findAll({
        where: {
          status: 'active', license_type: 'pro',
          end_date: { [Op.between]: [new Date(), sevenDays] }
        }
      });

      for (const license of expiringSoon) {
        await sendEmail({
          to: license.email,
          subject: `${process.env.APP_NAME} - Tu licencia expira pronto`,
          html: `<p>Hola ${license.name}, tu licencia PRO expira el ${new Date(license.end_date).toLocaleDateString('es-ES')}.</p>`
        });
      }
    } catch (err) {
      console.error('Error en cron de recordatorios:', err);
    }
  });

  // Clean expired unlock codes every hour
  cron.schedule('0 * * * *', async () => {
    try {
      const { License } = require('../models');
      await License.update(
        { unlock_code: null, unlock_code_expires: null },
        { where: { unlock_code_expires: { [Op.lt]: new Date() } } }
      );
    } catch (err) {
      console.error('Error limpiando códigos:', err);
    }
  });

  console.log('⏰ Cron jobs iniciados');
};

module.exports = { startAll };
