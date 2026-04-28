# 🔐 License Manager

Sistema completo de administración de licencias de software con dashboard, API REST, múltiples métodos de pago y verificación de dispositivos.

## ✨ Características

- **Dashboard** completo con estadísticas en tiempo real
- **CRUD de licencias** (Free/Pro, mensual/anual)
- **Vinculación de dispositivos** con migración
- **API REST** con autenticación JWT
- **Verificación de licencia + dispositivo** en tiempo real
- **Pagos** con Stripe, PayPal y Bitcoin (Coinbase Commerce)
- **Renovación automática** con Stripe subscriptions
- **Encriptación** RSA-2048 con certificados digitales
- **Código de desbloqueo** dinámico enviado por email
- **Rastreo geográfico** (IP, país, ciudad) en cada acceso
- **Roles de usuario**: estudiante, docente, programador, emprendedor, investigador
- **Sistema de admin** con activación por email (Mailgun)
- **Cron jobs** para expiración y recordatorios
- **Landing page** con precios

## 🚀 Instalación

```bash
npm install
cp .env.example .env  # Configurar variables
npm run dev
```

## 🔑 Credenciales por defecto

- **Usuario:** admin
- **Contraseña:** Admin@123

## 📡 API Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | /api/v1/verify | Verificar licencia + dispositivo |
| POST | /api/v1/verify/unlock | Verificar código desbloqueo |
| POST | /api/v1/unlock/request | Solicitar código desbloqueo |
| GET | /api/v1/license/:key | Info de licencia |
| POST | /api/v1/auth/login | Login admin (JWT) |
| POST | /api/v1/licenses | Crear licencia |
| PUT | /api/v1/licenses/:id | Editar licencia |
| POST | /api/v1/licenses/:id/upgrade | Upgrade a PRO |
| POST | /api/v1/devices/migrate | Migrar dispositivo |

## 🏗️ Tech Stack

- Express.js + Handlebars
- Tailwind CSS (CDN)
- SQLite + Sequelize
- Stripe / PayPal / Coinbase Commerce
- Mailgun
- JWT + bcrypt

## 📁 Estructura

```
license-manager/
├── server.js
├── config/database.js
├── models/
├── routes/
├── controllers/
├── middleware/
├── utils/
├── views/
└── public/
```
