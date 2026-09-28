// Crea el primer superadmin a partir de variables de entorno. No hay
// credenciales por defecto: sin ADMIN_INITIAL_PASSWORD no se crea nadie.
const bcrypt = require('bcryptjs');

const bootstrapAdmin = async (Admin, env = process.env) => {
  if (await Admin.count() > 0) return { created: false, reason: 'exists' };
  const password = env.ADMIN_INITIAL_PASSWORD;
  if (!password) return { created: false, reason: 'missing_password' };
  if (password.length < 12) throw new Error('ADMIN_INITIAL_PASSWORD debe tener al menos 12 caracteres.');
  if (!env.ADMIN_DEFAULT_EMAIL) throw new Error('ADMIN_DEFAULT_EMAIL es requerido para crear el primer admin.');
  const username = (env.ADMIN_INITIAL_USERNAME || 'admin').toLowerCase();
  await Admin.create({
    username,
    email: env.ADMIN_DEFAULT_EMAIL,
    phone: env.ADMIN_INITIAL_PHONE || '+0000000000',
    password_hash: await bcrypt.hash(password, 12),
    access_code: env.ADMIN_INITIAL_ACCESS_CODE || null,
    activation_code: null,
    is_active: true,
    role: 'superadmin'
  });
  return { created: true, username };
};

module.exports = { bootstrapAdmin };
