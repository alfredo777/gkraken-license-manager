# gkraken-license-manager — notas para la siguiente sesión

Gestor de licencias **y web pública** de Green Kraken (Monter Labs AI), más el
**gateway de IA** (proceso aparte). Golem AI es otro sistema y no se toca.

Estado al 2026-10-22: todo en la rama `claude/nice-rubin-t2yt6o`, PR
[#1](https://github.com/alfredo777/gkraken-license-manager/pull/1) abierto y sin
conflictos. La app vive en `alfredo777/green-kraken` (misma rama, PR #2).

## Mapa
- `server.js` arranca la web/API (BD, admin inicial, cron); `app.js` es la app Express sin efectos (la usan las pruebas).
- `gateway.js` + `gatewayApp.js` + `gateway/` — gateway de IA (`npm run gateway`, `GATEWAY_WORKERS`): `pipeline.js` (token → plan → modelo → límites → cuota → clave → reenvío → cobro), `quota.js` (préstamos atómicos), `adapters/{anthropic,openai,gemini}.js`.
- `controllers/`: `clientApiController` (API de la app), `googleAuthController` (login Google de app y web), `accountController` (Mi cuenta), `aiAdminController` (/dashboard/ai), `paymentController` (Stripe/PayPal/Coinbase + webhook).
- `utils/`: `licenseService` (alta FREE, respuestas para la app), `applyUpgrade` (PRO sin cambiar la clave), `aiBilling` (suscripción de IA), `secretBox` (AES-256-GCM de claves de proveedores), `aiTokens`, `schemaUpgrade` (columnas nuevas en bases existentes), `startupChecks`.
- Vistas: `views/layouts/site.hbs` + `public/css/site.css` para lo público (landing, /como-funciona, /cuenta); `views/layouts/main.hbs` (Tailwind) solo para el panel admin.

## Reglas que hay que mantener
- Código, textos y commits en español.
- Estilos públicos según `green-kraken/docs/ESTILOS_WEB.md`: tokens espejo de `GKColors`, oscuro por defecto, sin altos fijos, lo opcional reserva su hueco, sin CDNs.
- Un upgrade nunca cambia la clave de licencia (la app hace polling por clave).
- Las claves de proveedores de IA solo se guardan cifradas; nunca se devuelven ni se loguean. El token del equipo (`gkai_…`) solo se guarda como hash.
- Cada evento de Stripe se aplica una vez (`processed_events`).
- Columnas nuevas de tablas existentes: agregarlas en `utils/schemaUpgrade.js` (en producción `sync()` no altera tablas).
- En Handlebars `currency` es un helper: para el código de moneda usar `currencyCode`.

## Pruebas
- `npm test` → 94 pruebas (jest + supertest, SQLite en memoria; variables en `tests/setupEnv.js`).
- `tests/gateway.test.js` levanta un proveedor falso local; vaciar `usageLog` y `quota.reset()` entre pruebas.
- La medición de carga del README se hizo con scripts de proveedor falso (no versionados).

## Decisiones tomadas
- El login con Google crea la licencia FREE; migrar de equipo exige Google (`/api/v1/migrate` por email responde 410). Registro por formulario solo con `ALLOW_FORM_REGISTRATION=true`.
- Plan de IA mensual medido en tokens × `token_factor` por modelo; pago con Stripe Checkout en modo suscripción.
- La app limita FREE a 3 flujos de trabajo; `advanced_features` (PRO) lo quita.

## Pendiente del usuario
- `.env` (ver `.env.example`), cliente OAuth de Google (redirect `/auth/google/callback`), eventos del webhook de Stripe, desplegar el gateway en su subdominio (nginx `proxy_buffering off`), `npm run seed:ai` y cargar claves/modelos/planes en `/dashboard/ai`, y fusionar el PR #1.

## Pendiente en código (no empezado)
- Botón al Stripe Billing Portal para actualizar la tarjeta en `past_due` (el aviso ya existe en `views/account/index.hbs`).
- Cambio de plan de IA con prorrateo (`subscriptions.update`); hoy cancela la anterior y cobra la nueva completa.
- `utils/mailer.js`: marca Green Kraken y escapar los nombres en el HTML.
