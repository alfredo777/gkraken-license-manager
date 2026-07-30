# GKraken License Manager

Sistema de gestion de licencias para la plataforma **Green Kraken** (GKraken). API REST construida con Express.js, Sequelize ORM y soporte para multiples pasarelas de pago.

## Arquitectura General

```
┌─────────────────────────────────────────────────────────┐
│                    Express Server                        │
│  Helmet CSP · CORS · Rate Limiter (200 req/15 min)      │
├─────────────────────────────────────────────────────────┤
│  Middleware: auth.js (Session + JWT) · ipTracker.js      │
├──────────┬──────────┬──────────┬──────────┬─────────────┤
│ License  │ Verify   │ Payment  │ Device   │ Admin       │
│ Ctrl     │ Ctrl     │ Ctrl     │ Ctrl     │ Ctrl        │
├──────────┴──────────┴──────────┴──────────┴─────────────┤
│  Sequelize ORM (SQLite dev / PostgreSQL prod)           │
│  Models: License · Admin · Device · Payment             │
│          AccessNode · DeviceMigration                    │
├─────────────────────────────────────────────────────────┤
│  Utils: encryption · codeGenerator · mailer · cronJobs  │
└─────────────────────────────────────────────────────────┘
```

## Stack Tecnico

| Componente | Tecnologia | Version |
|---|---|---|
| Runtime | Node.js | 18+ |
| Framework | Express | 4.18 |
| ORM | Sequelize | 6.35 |
| DB (dev) | SQLite3 | - |
| DB (prod) | PostgreSQL | - |
| Templates | Handlebars | 7.1 |
| CSS | Tailwind CSS | CDN |
| Crypto | node-forge + crypto-js | - |
| Pagos | Stripe 14.8 + PayPal REST SDK + Coinbase Commerce | - |
| Auth | jsonwebtoken 9.0 + bcryptjs | - |
| Email | Mailgun (mailgun-js) | - |
| GeoIP | geoip-lite | - |
| Cron | node-cron | - |

## Modelos de Datos

### License
Campo principal del sistema. Almacena toda la informacion de la licencia.

| Campo | Tipo | Descripcion |
|---|---|---|
| `license_key` | STRING | Clave unica: `FREE-XXXX-XXXX-XXXX-XXXX` o `PRO-XXXX-XXXX-XXXX-XXXX` |
| `license_type` | ENUM | `free` o `pro` |
| `plan_type` | ENUM | `free`, `monthly`, `annual`, `lifetime` |
| `status` | ENUM | `active`, `pending`, `expired`, `suspended`, `revoked` |
| `encryption_key` | TEXT | Clave AES-256 (32 bytes hex) |
| `encryption_certificate` | TEXT | Certificado X.509 PEM (RSA-2048, self-signed SHA-256) |
| `start_date` / `end_date` | DATE | Periodo de validez |
| `unlock_code` | STRING | Codigo temporal de 8 caracteres (expira en 15 min) |
| `auto_renew` | BOOLEAN | Renovacion automatica |
| `stripe_customer_id` | STRING | ID del cliente en Stripe |

### Device
Dispositivos vinculados a una licencia.

| Campo | Tipo | Descripcion |
|---|---|---|
| `device_id` | STRING(500) | SHA-256 hash de: CPU + RAM + Motherboard + MAC + Disk Serial |
| `device_name` | STRING | Nombre del dispositivo |
| `device_os` | STRING | Sistema operativo |
| `is_active` | BOOLEAN | Solo un dispositivo activo por licencia |

### Payment
Registro de pagos procesados.

| Campo | Tipo | Descripcion |
|---|---|---|
| `amount` | DECIMAL | Monto en USD |
| `method` | ENUM | `stripe`, `paypal`, `bitcoin`, `manual` |
| `transaction_id` | STRING | ID de transaccion del gateway |
| `status` | ENUM | `pending`, `completed`, `failed`, `refunded` |

### AccessNode
Registro de cada accion sobre una licencia (audit trail).

| Campo | Tipo | Descripcion |
|---|---|---|
| `action` | STRING | `registration`, `verification`, `unlock`, `upgrade`, `migration`, `renewal`, `payment`, `login` |
| `ip_address` | STRING | IP del cliente |
| `country` / `city` | STRING | Datos GeoIP |
| `latitude` / `longitude` | FLOAT | Coordenadas |

### DeviceMigration
Historial de migraciones de dispositivo.

### Admin
Administradores del sistema con roles `admin` o `superadmin`.

## API REST

Base URL: `/api/v1`

### Endpoints Publicos

| Metodo | Ruta | Descripcion |
|---|---|---|
| `POST` | `/verify` | Verificar licencia + dispositivo |
| `POST` | `/verify/unlock` | Verificar codigo de desbloqueo |
| `POST` | `/unlock/request` | Solicitar codigo de desbloqueo por email |
| `GET` | `/license/:license_key` | Obtener info publica de licencia |

### Endpoints Protegidos (JWT Bearer)

| Metodo | Ruta | Descripcion |
|---|---|---|
| `POST` | `/auth/login` | Autenticacion, retorna JWT (24h) |
| `POST` | `/licenses` | Crear licencia |
| `PUT` | `/licenses/:id` | Actualizar licencia |
| `POST` | `/licenses/:id/upgrade` | Upgrade FREE a PRO |
| `POST` | `/licenses/:id/unlock` | Generar codigo de desbloqueo |
| `POST` | `/devices/migrate` | Migrar dispositivo |
| `POST` | `/payments/stripe/intent` | Crear Stripe PaymentIntent |
| `POST` | `/payments/stripe/subscription` | Crear Stripe Subscription |
| `POST` | `/payments/paypal/create` | Crear orden PayPal |
| `POST` | `/payments/bitcoin/create` | Crear cargo Bitcoin (Coinbase) |
| `POST` | `/payments/manual` | Registrar pago manual |

### Verificacion de Licencia

```json
POST /api/v1/verify
{
  "license_key": "PRO-XXXX-XXXX-XXXX-XXXX",
  "device_id": "sha256-hash-del-hardware",
  "app_version": "1.0.0"
}
```

Respuesta:
```json
{
  "valid": true,
  "license_type": "pro",
  "plan_type": "annual",
  "status": "active",
  "end_date": "2027-07-30T00:00:00.000Z",
  "days_remaining": 365,
  "app_version": "1.0.0",
  "reason": "Licencia y dispositivo validos.",
  "timestamp": "2026-07-30T12:00:00.000Z"
}
```

La verificacion valida en orden: existencia de licencia, status activo, fecha de expiracion, y dispositivo vinculado activo.

## Pasarelas de Pago

### Stripe
- **PaymentIntent**: Pago unico con `automatic_payment_methods`
- **Subscription**: Pagos recurrentes con `payment_behavior: default_incomplete`
- **Webhook**: `payment_intent.succeeded` activa la licencia PRO

### PayPal
- Flujo redirect: crea payment, redirige a PayPal, ejecuta al retornar
- Callback en `/payments/paypal/success`

### Bitcoin (Coinbase Commerce)
- Crea charge con precio fijo en USD
- Webhook `charge:confirmed` activa la licencia

### Pago Manual
- Solo admin autenticado
- Registra transaccion `MANUAL-{timestamp}`

Todos los gateways al completar el pago:
1. Generan nueva clave PRO (si era FREE)
2. Crean nuevo certificado X.509
3. Crean nueva encryption key AES-256
4. Registran el Payment en BD
5. Envian email de confirmacion + info de licencia

## Seguridad

### Criptografia por Licencia
- **RSA-2048**: Keypair generado con node-forge
- **X.509**: Certificado self-signed con SHA-256, validez 1 ano
- **AES-256**: Clave de 32 bytes (`crypto.randomBytes(32)`) para cifrado de datos

### Autenticacion
- **Dashboard Web**: Sesiones Express con cookie httpOnly (24h)
- **API REST**: JWT Bearer token (24h), firmado con `JWT_SECRET`
- **Passwords**: bcrypt con 12 salt rounds
- **Access Code**: Factor adicional opcional por admin

### Protecciones del Servidor
- Helmet con CSP
- Rate limiting: 200 peticiones / 15 minutos en `/api/`
- CORS configurado
- Cookies seguras en produccion

### Device Fingerprint
Hash SHA-256 de: CPU + RAM + Motherboard Serial + MAC Address + Disk Serial

## Trabajos Programados (Cron)

| Programacion | Tarea |
|---|---|
| `0 0 * * *` (medianoche) | Marcar licencias expiradas, enviar email |
| `0 9 * * *` (9:00 AM) | Recordatorio de renovacion (7 dias antes) |
| `0 * * * *` (cada hora) | Limpiar codigos de desbloqueo expirados |

## Notificaciones por Email

Todas las notificaciones se envian via Mailgun:

| Funcion | Trigger |
|---|---|
| `sendLicenseInfo` | Crear licencia, upgrade, pago completado |
| `sendUnlockCode` | Admin genera codigo, usuario solicita codigo |
| `sendPaymentConfirmation` | Cualquier pago completado (Stripe/PayPal/Bitcoin/Manual) |
| `sendMigrationNotification` | Migracion de dispositivo |
| `sendActivationCode` | Registro de nuevo admin |
| `sendEmail` (generico) | Licencia expirada, recordatorio de renovacion |

## Variables de Entorno

```env
# App
APP_NAME=GKraken
APP_URL=http://localhost:3000
NODE_ENV=development

# Base de datos
DB_DIALECT=sqlite
DB_STORAGE=./database.sqlite
# PostgreSQL (produccion):
# DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD

# Auth
JWT_SECRET=your-jwt-secret
SESSION_SECRET=your-session-secret

# Stripe
STRIPE_SECRET_KEY=sk_...
STRIPE_PUBLISHABLE_KEY=pk_...
STRIPE_WEBHOOK_SECRET=whsec_...

# PayPal
PAYPAL_MODE=sandbox
PAYPAL_CLIENT_ID=...
PAYPAL_CLIENT_SECRET=...

# Bitcoin
COINBASE_COMMERCE_API_KEY=...
COINBASE_COMMERCE_WEBHOOK_SECRET=...

# Email
MAILGUN_API_KEY=...
MAILGUN_DOMAIN=...
MAILGUN_FROM=noreply@yourdomain.com

# Precios
PRICE_MONTHLY=7
PRICE_ANNUAL=49

# API Key (opcional)
API_KEY=your-api-key
```

## Instalacion

```bash
# Clonar e instalar
git clone <repo-url>
cd gkraken-license-manager
npm install

# Configurar variables de entorno
cp .env.example .env
# Editar .env con tus credenciales

# Iniciar en desarrollo
npm run dev

# Iniciar en produccion
NODE_ENV=production npm start
```

El sistema crea automaticamente un admin por defecto:
- **Usuario**: `admin`
- **Password**: `Admin@123`
- **Access Code**: `ADMIN-2024-MASTER`
- **Rol**: `superadmin`

## Estructura del Proyecto

```
gkraken-license-manager/
├── server.js                 # Entry point, Express setup
├── config/
│   └── database.js           # Sequelize config
├── controllers/
│   ├── adminController.js    # Auth, registro, perfil
│   ├── licenseController.js  # CRUD licencias, upgrade, unlock
│   ├── verificationController.js  # Verificacion publica
│   ├── paymentController.js  # Stripe, PayPal, Bitcoin, manual
│   └── deviceController.js   # Dispositivos, migracion
├── middleware/
│   ├── auth.js               # Session + JWT + API Key
│   └── ipTracker.js          # GeoIP tracking
├── models/
│   ├── index.js              # Asociaciones
│   ├── License.js
│   ├── Admin.js
│   ├── Device.js
│   ├── Payment.js
│   ├── AccessNode.js
│   └── DeviceMigration.js
├── routes/
│   ├── api.js                # REST API /api/v1
│   ├── admin.js              # Auth routes
│   ├── dashboard.js          # Dashboard web
│   ├── payments.js           # Payment pages
│   └── landing.js            # Landing page
├── utils/
│   ├── codeGenerator.js      # License keys, unlock codes
│   ├── encryption.js         # RSA, X.509, AES
│   ├── cronJobs.js           # Tareas programadas
│   └── mailer.js             # Mailgun emails
├── views/                    # Handlebars templates
└── public/                   # Static assets
```
