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
cp .env.example .env  # Configurar variables (ver abajo)
npm run dev
npm test              # pruebas (SQLite en memoria, sin red)
```

## 🔑 Primer administrador

Ya no hay credenciales por defecto. Define en el `.env`:

- `ADMIN_DEFAULT_EMAIL`
- `ADMIN_INITIAL_PASSWORD` (mínimo 12 caracteres)
- opcionales: `ADMIN_INITIAL_USERNAME` (por defecto `admin`), `ADMIN_INITIAL_ACCESS_CODE` (segundo factor en el login)

El superadmin se crea al arrancar si no existe ningún admin (o con `npm run seed`). Después puedes borrar `ADMIN_INITIAL_PASSWORD` del `.env`.

En producción (`NODE_ENV=production`) el servidor no arranca si `SESSION_SECRET`, `JWT_SECRET` o `API_KEY` faltan, son los valores de ejemplo o tienen menos de 32 caracteres.

## 🌐 Sitio web de Green Kraken

Este servidor es también la web pública de Green Kraken: todo lo web vive aquí.

| Ruta | Qué es |
|------|--------|
| `/` | Landing (funciones, planes, descargas) |
| `/cuenta/entrar` | Entrada con Google para usuarios |
| `/como-funciona` | Cómo funciona la app y las dos formas de usar IA (clave propia / plan de IA), modelos y planes |
| `/cuenta` | Mi cuenta: licencia, dispositivos (liberar equipo), pasar a PRO, plan de IA, pagos |
| `/payments/success` | Confirmación después de pagar |
| `/admin/login`, `/dashboard` | Administración (Monter Labs) |

Si alguien entra por la web y su cuenta de Google no tiene licencia, se crea una FREE sin dispositivo. El equipo se vincula la primera vez que inicia sesión en la app.

Las páginas públicas usan `views/layouts/site.hbs` y `public/css/site.css`, que siguen las reglas de `green-kraken/docs/ESTILOS_WEB.md`:
- los mismos tokens de color que `GKColors`;
- oscuro por defecto, con variante clara según el sistema;
- sin alturas fijas;
- sin CDNs ni fuentes externas;
- sin animaciones con `prefers-reduced-motion`.

Los logos de `public/img/` son los optimizados de la cáscara web de la app (`web/brand/marca.png`, `web/icons/*`). El panel de administración conserva su plantilla (`layouts/main.hbs`).

Enlaces de descarga: `DOWNLOAD_URL_WINDOWS`, `DOWNLOAD_URL_MACOS` y `DOWNLOAD_URL_LINUX`. Si una está vacía, esa plataforma muestra "Próximamente".

Detrás de nginx u otro proxy, define `TRUST_PROXY=1`. Sin eso, la cookie de sesión segura no se envía y el login web no funciona en producción.

## 🤖 Plan de IA de Green Kraken (gateway)

Monter Labs vende acceso a IA dentro de la app: Claude, Grok, ChatGPT, Gemini, DeepSeek, Qwen… sin que el usuario tenga cuenta con cada proveedor. El usuario puede seguir usando **su propia clave**. En ese caso la app llama directo al proveedor y nada pasa por aquí.

```
App ──(token del equipo)──▶ Gateway ──(clave de Monter Labs)──▶ Proveedor
            ▲ verifica token, plan, modelo, límites y cuota
            ▲ descifra la clave solo para esa petición
            ▲ reenvía la respuesta en streaming y cobra los tokens reales
```

- **Claves de los proveedores:** se guardan cifradas con AES-256-GCM (`AI_KEYS_MASTER_KEY`) en `ai_providers` y nunca llegan a la app. El panel solo muestra los últimos 4 caracteres.
- **Token por equipo:** es `gkai_…` y se entrega una sola vez al terminar el login con Google en la app. En la base solo se guarda su hash. Se revoca al liberar o migrar el equipo, desde Mi cuenta o desde el panel. Tarda como máximo `AI_GATEWAY_CACHE_MS` en aplicar (30 s por defecto).
- **Plan mensual en tokens:** se paga con una suscripción de Stripe desde Mi cuenta.
  - El webhook maneja `checkout.session.completed`, `invoice.paid` (reinicia los tokens), `customer.subscription.updated` y `customer.subscription.deleted`. Suscribe esos eventos en Stripe.
  - Cada evento se aplica una sola vez (tabla `processed_events`).
  - Cada modelo tiene un **factor**: los tokens que descuenta del plan son los tokens reales × factor, para que los modelos caros consuman más.
- **Formatos que acepta el gateway**, iguales a las APIs originales:

  | Ruta | Proveedores | Dónde va el token |
  |------|-------------|-------------------|
  | `POST /v1/anthropic/messages` | Claude, vía el SDK oficial | `x-api-key` |
  | `POST /v1/openai/:proveedor/chat/completions` | OpenAI, xAI, DeepSeek, Qwen, Mistral, Groq, Kimi | `Authorization: Bearer` |
  | `POST /v1/gemini/models/:modelo:generateContent` | Gemini | `?key=` |

  `GET /v1/models` lista lo que incluye el plan. `GET /v1/usage` devuelve el consumo del periodo.
- **Administración:** en `/dashboard/ai` se configuran proveedores, claves (solo superadmin), modelos, costos, factor, planes, suscripciones y el reporte de costo y margen. `npm run seed:ai` crea los proveedores y los modelos de Claude. Los ids de modelo de los demás proveedores se agregan desde el panel.

### Desplegar el gateway

Es un proceso aparte: `npm run gateway`. Usa la misma base de datos y el mismo `.env`, pero no comparte recursos con la web.

```bash
openssl rand -base64 32          # → AI_KEYS_MASTER_KEY (el mismo valor en el gestor y en el gateway)
GATEWAY_PORT=3100 GATEWAY_WORKERS=4 npm run gateway
```

- **Subdominio:** publícalo en uno propio, por ejemplo `https://ai.tu-dominio.com`, y compila la app con `--dart-define=AI_GATEWAY_URL=https://ai.tu-dominio.com`.
- **nginx:** para que el streaming no se acumule en el proxy, usa `proxy_buffering off;` y `proxy_read_timeout 600s;`.
- **Escalar:** `GATEWAY_WORKERS` levanta una copia por núcleo, y se pueden poner más máquinas detrás de un balanceador.
  - **Límites:** los de peticiones por minuto y peticiones a la vez son por copia.
  - **Cuota:** nunca se pasa del límite. Cada copia toma "préstamos" de tokens de la base de datos con una actualización atómica (`AI_QUOTA_LEASE_TOKENS`, 20,000 por defecto) y los gasta desde memoria. Lo que no usa lo devuelve a los `AI_QUOTA_LEASE_IDLE_MS` sin uso y al apagarse.
- **Registro de consumo:** las filas de `ai_usage` se escriben en lotes cada `AI_USAGE_FLUSH_MS` (2 s por defecto).

**Medición.** Proveedor simulado que tarda ~1.1 s por respuesta en streaming, con SQLite, en una máquina de 4 núcleos que comparten el gateway, el proveedor falso y el generador de carga:

| Escenario | Primer byte (p50) | Respuesta completa (p50 / p95) |
|-----------|-------------------|--------------------------------|
| Directo al proveedor, 200 a la vez | 71 ms | 1.14 s / 1.14 s |
| Gateway, 1 petición | 18 ms | 1.07 s |
| Gateway, 1 proceso, 200 a la vez | ~280 ms | 1.33 s / 1.36 s |
| Gateway, 3 procesos, 200 a la vez | ~160 ms | 1.16 s / 1.27 s |
| Gateway, 3 procesos, 500 a la vez | 285 ms | 1.34 s / 1.54 s |

En todas las rondas, los tokens cobrados coincidieron exactamente con el registro (1,100 peticiones, 77,000 tokens). Con PostgreSQL en producción el acceso a la base es menor todavía.

## 🐙 Green Kraken (app)

Este servidor es el gestor de licencias propio de Green Kraken (Monter Labs AI). La app se compila apuntando aquí:

```bash
flutter build <plataforma> \
  --dart-define=LICENSE_BASE_URL=https://licencias.tu-dominio.com \
  --dart-define=LICENSE_API_KEY=<el mismo valor que API_KEY del servidor>
```

Genera la clave con `openssl rand -hex 32`. La clave que estuvo publicada en el historial de green-kraken se rechaza al arrancar.

### Login con Google (crea la licencia)

1. En Google Cloud Console (proyecto de Monter Labs) → *APIs y servicios → Credenciales* → crear **ID de cliente OAuth** de tipo **Aplicación web**.
2. URI de redirección autorizado: `https://licencias.tu-dominio.com/auth/google/callback` (o el valor de `GOOGLE_REDIRECT_URI`). Sirve para la app y para la web.
3. Configura la pantalla de consentimiento (scopes `openid`, `email`, `profile`).
4. Copia el ID y el secreto a `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`.

Flujo:

1. La app llama `POST /api/v1/auth/google/start` con los datos del dispositivo y `mode` (`register` o `migrate`). Recibe `auth_url`, `session_id` y `poll_token`.
2. La app abre `auth_url` en el navegador; el usuario elige su cuenta de Google.
3. `/auth/google/callback` verifica el `id_token` y:
   - `register`: si la cuenta no tiene licencia, crea una **FREE** y vincula el dispositivo. Si ya existe (por `google_sub` o por email), la reconoce; si el dispositivo es nuevo y hay cupo (`max_devices`), lo vincula; si no, responde `needs_migration: true`.
   - `migrate`: mueve la licencia de esa cuenta a este dispositivo (desactiva el menos reciente).
4. La app consulta `GET /api/v1/auth/google/status/:session_id` con la cabecera `X-Poll-Token` hasta recibir `status: completed` (el resultado se entrega una sola vez) o `failed`.

El registro por formulario (`POST /api/v1/register`) queda desactivado salvo `ALLOW_FORM_REGISTRATION=true`, y la migración por email (`POST /api/v1/migrate`) responde 410: para mover una licencia hay que iniciar sesión con la cuenta dueña.

### Pagos desde la app

`POST /api/v1/upgrade/checkout` crea una sesión de Stripe Checkout con el precio del servidor. Al completarse, el webhook `checkout.session.completed` pasa la licencia a PRO **sin cambiar la clave**. La app consulta `GET /api/v1/upgrade/status/:key` hasta ver `is_pro: true`. En Stripe, suscribe el webhook `https://licencias.tu-dominio.com/webhook/stripe` a `checkout.session.completed` y `payment_intent.succeeded`.

## 📡 API Endpoints

**App Green Kraken** (cabecera `X-API-Key`):

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | /api/v1/auth/google/start | Inicia login con Google (crea o migra licencia) |
| GET | /api/v1/auth/google/status/:id | Resultado del login (cabecera `X-Poll-Token`) |
| POST | /api/v1/verify | Verificar licencia + dispositivo (`status_detail.code`, `device_link_info`, …) |
| POST | /api/v1/upgrade/checkout | Crear pago PRO (Stripe Checkout) |
| GET | /api/v1/upgrade/status/:key | Estado del upgrade |
| POST | /api/v1/register | Registro por formulario (desactivado por defecto) |
| POST | /api/v1/verify/unlock | Verificar código desbloqueo |
| POST | /api/v1/unlock/request | Solicitar código desbloqueo |
| GET | /api/v1/license/:key | Info pública de licencia |

**Administración** (`Authorization: Bearer <JWT>` de `POST /api/v1/auth/login`):

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | /api/v1/licenses | Crear licencia |
| PUT | /api/v1/licenses/:id | Editar licencia (incluye `max_devices`) |
| POST | /api/v1/licenses/:id/upgrade | Upgrade a PRO (conserva la clave) |
| POST | /api/v1/licenses/:id/unlock | Generar código de desbloqueo |
| POST | /api/v1/devices/migrate | Migrar dispositivo |
| POST | /api/v1/payments/manual | Registrar pago manual |

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
├── server.js          # arranque (BD, admin inicial, cron, listen)
├── app.js             # app Express (sin efectos; la usan las pruebas)
├── config/database.js
├── models/
├── routes/
├── controllers/
├── middleware/
├── utils/
├── views/
├── seeders/
├── tests/
└── public/
```
