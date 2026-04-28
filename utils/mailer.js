const mailgun = require('mailgun-js');

const mg = mailgun({
  apiKey: process.env.MAILGUN_API_KEY || 'key-placeholder',
  domain: process.env.MAILGUN_DOMAIN || 'placeholder.mailgun.org'
});

const sendEmail = async ({ to, subject, html, text }) => {
  try {
    const data = {
      from: `${process.env.APP_NAME} <${process.env.MAILGUN_FROM}>`,
      to, subject, html, text: text || subject
    };
    const result = await mg.messages().send(data);
    console.log(`📧 Email enviado a ${to}: ${subject}`);
    return { success: true, result };
  } catch (error) {
    console.error('❌ Error enviando email:', error.message);
    return { success: false, error: error.message };
  }
};

const sendActivationCode = async (email, code, username) => {
  return sendEmail({
    to: email,
    subject: `${process.env.APP_NAME} - Código de Activación`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
        <div style="background:linear-gradient(135deg,#667eea,#764ba2);padding:30px;border-radius:10px 10px 0 0;text-align:center;">
          <h1 style="color:white;margin:0;">${process.env.APP_NAME}</h1>
        </div>
        <div style="background:#f8f9fa;padding:30px;border-radius:0 0 10px 10px;">
          <h2 style="color:#333;">Hola ${username},</h2>
          <p style="color:#666;">Tu código de activación es:</p>
          <div style="background:#fff;border:2px dashed #667eea;padding:20px;text-align:center;margin:20px 0;border-radius:8px;">
            <span style="font-size:32px;font-weight:bold;color:#667eea;letter-spacing:5px;">${code}</span>
          </div>
          <p style="color:#999;font-size:14px;">Este código expira en 24 horas.</p>
        </div>
      </div>`
  });
};

const sendUnlockCode = async (email, code, name) => {
  return sendEmail({
    to: email,
    subject: `${process.env.APP_NAME} - Código de Desbloqueo`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
        <div style="background:linear-gradient(135deg,#f093fb,#f5576c);padding:30px;border-radius:10px 10px 0 0;text-align:center;">
          <h1 style="color:white;margin:0;">🔓 Código de Desbloqueo</h1>
        </div>
        <div style="background:#f8f9fa;padding:30px;border-radius:0 0 10px 10px;">
          <h2 style="color:#333;">Hola ${name},</h2>
          <p style="color:#666;">Tu código de desbloqueo:</p>
          <div style="background:#fff;border:2px dashed #f5576c;padding:20px;text-align:center;margin:20px 0;border-radius:8px;">
            <span style="font-size:36px;font-weight:bold;color:#f5576c;letter-spacing:8px;">${code}</span>
          </div>
          <p style="color:#999;font-size:14px;">⏰ Expira en 15 minutos.</p>
        </div>
      </div>`
  });
};

const sendLicenseInfo = async (email, license) => {
  return sendEmail({
    to: email,
    subject: `${process.env.APP_NAME} - Tu Licencia`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
        <div style="background:linear-gradient(135deg,#43e97b,#38f9d7);padding:30px;border-radius:10px 10px 0 0;text-align:center;">
          <h1 style="color:white;margin:0;">✅ Licencia Activada</h1>
        </div>
        <div style="background:#f8f9fa;padding:30px;border-radius:0 0 10px 10px;">
          <h2 style="color:#333;">Hola ${license.name},</h2>
          <p style="color:#666;">Tu licencia está activa.</p>
          <table style="width:100%;border-collapse:collapse;margin:20px 0;">
            <tr><td style="padding:8px;border-bottom:1px solid #eee;color:#999;">Licencia:</td><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">${license.license_key}</td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #eee;color:#999;">Tipo:</td><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">${(license.license_type || '').toUpperCase()}</td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #eee;color:#999;">Válida hasta:</td><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">${license.end_date ? new Date(license.end_date).toLocaleDateString('es-ES') : 'N/A'}</td></tr>
          </table>
        </div>
      </div>`
  });
};

const sendMigrationNotification = async (email, name, oldDevice, newDevice) => {
  return sendEmail({
    to: email,
    subject: `${process.env.APP_NAME} - Migración de Dispositivo`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
      <h2>Hola ${name},</h2>
      <p>Tu licencia ha sido migrada.</p>
      <p><strong>Anterior:</strong> ${oldDevice}</p>
      <p><strong>Nuevo:</strong> ${newDevice}</p>
      <p style="color:#999;">Si no autorizaste este cambio, contacta soporte.</p>
    </div>`
  });
};

const sendPaymentConfirmation = async (email, name, amount, plan) => {
  return sendEmail({
    to: email,
    subject: `${process.env.APP_NAME} - Confirmación de Pago`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
      <h2>Hola ${name},</h2>
      <p>Pago procesado: <strong>$${amount} USD</strong> (${plan})</p>
      <p>Tu licencia PRO ha sido activada.</p>
    </div>`
  });
};

module.exports = {
  sendEmail, sendActivationCode, sendUnlockCode,
  sendLicenseInfo, sendMigrationNotification, sendPaymentConfirmation
};
