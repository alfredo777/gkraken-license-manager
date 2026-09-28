// Construye la app Express sin abrir puerto ni tocar la base de datos, para
// poder usarla en pruebas. El arranque real está en server.js.
const express = require('express');
const { engine } = require('express-handlebars');
const session = require('express-session');
const flash = require('connect-flash');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const methodOverride = require('method-override');
const cookieParser = require('cookie-parser');
const path = require('path');

const app = express();

app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.tailwindcss.com", "https://js.stripe.com", "https://www.paypal.com", "https://cdn.jsdelivr.net"], styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net"], fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdn.jsdelivr.net"], imgSrc: ["'self'", "data:", "https:"], connectSrc: ["'self'", "https://api.stripe.com"], frameSrc: ["https://js.stripe.com", "https://www.paypal.com"] } } }));
app.use(cors());
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200, message: { error: 'Demasiadas solicitudes.' } });
app.use('/api/', apiLimiter);

// Webhooks: necesitan el cuerpo crudo para verificar la firma, así que se
// montan antes de express.json().
const paymentCtrl = require('./controllers/paymentController');
app.post('/webhook/stripe', express.raw({ type: 'application/json' }), paymentCtrl.stripeWebhook);
app.post('/payments/webhook/bitcoin', express.raw({ type: 'application/json' }), paymentCtrl.bitcoinWebhook);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: process.env.NODE_ENV === 'production', httpOnly: true, maxAge: 24 * 60 * 60 * 1000 } }));
app.use(flash());

const hbs = engine({
  extname: '.hbs', defaultLayout: 'main',
  layoutsDir: path.join(__dirname, 'views/layouts'),
  partialsDir: path.join(__dirname, 'views/partials'),
  helpers: {
    eq: (a, b) => a === b, neq: (a, b) => a !== b, gt: (a, b) => a > b, lt: (a, b) => a < b,
    and: (a, b) => a && b, or: (a, b) => a || b, not: (a) => !a,
    formatDate: (d) => { if (!d) return 'N/A'; return new Date(d).toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' }); },
    formatDateTime: (d) => { if (!d) return 'N/A'; return new Date(d).toLocaleString('es-ES'); },
    truncate: (s, l) => { if (!s) return ''; return s.length > l ? s.substring(0, l) + '...' : s; },
    statusBadge: (s) => { const b = { active: '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">Activa</span>', expired: '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-800">Expirada</span>', suspended: '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-yellow-100 text-yellow-800">Suspendida</span>', pending: '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">Pendiente</span>', completed: '<span class="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">Completado</span>' }; return b[s] || s; },
    typeBadge: (t) => t === 'pro' ? '<span class="px-2 py-1 text-xs font-bold rounded-full bg-purple-100 text-purple-800">PRO</span>' : '<span class="px-2 py-1 text-xs font-bold rounded-full bg-gray-100 text-gray-800">FREE</span>',
    json: (c) => JSON.stringify(c), inc: (v) => parseInt(v) + 1,
    ifCond: function(v1, op, v2, opts) { switch(op) { case '==': return (v1==v2)?opts.fn(this):opts.inverse(this); case '===': return (v1===v2)?opts.fn(this):opts.inverse(this); case '!=': return (v1!=v2)?opts.fn(this):opts.inverse(this); default: return opts.inverse(this); } },
    select: function(v, opts) { return opts.fn(this).replace(new RegExp(' value=\"' + v + '\"'), '$& selected="selected"'); },
    daysRemaining: (d) => { if (!d) return 0; const diff = Math.ceil((new Date(d) - new Date()) / (1000*60*60*24)); return diff > 0 ? diff : 0; },
    currency: (a) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(a)
  }
});

app.engine('.hbs', hbs);
app.set('view engine', '.hbs');
app.set('views', path.join(__dirname, 'views'));

app.use((req, res, next) => {
  res.locals.success_msg = req.flash('success_msg');
  res.locals.error_msg = req.flash('error_msg');
  res.locals.error = req.flash('error');
  res.locals.admin = req.session.admin || null;
  res.locals.appName = process.env.APP_NAME;
  res.locals.appUrl = process.env.APP_URL;
  res.locals.stripePublishableKey = process.env.STRIPE_PUBLISHABLE_KEY;
  res.locals.paypalClientId = process.env.PAYPAL_CLIENT_ID;
  res.locals.currentYear = new Date().getFullYear();
  next();
});

app.use('/', require('./routes/landing'));
app.use('/admin', require('./routes/admin'));
app.use('/dashboard', require('./routes/dashboard'));
app.use('/payments', require('./routes/payments'));
app.use('/api/v1', require('./routes/api'));
app.use('/auth', require('./routes/auth'));

app.use((req, res) => { res.status(404).render('404', { layout: 'main', title: '404' }); });
app.use((err, req, res, next) => { console.error(err.stack); res.status(500).render('error', { layout: 'main', title: 'Error', message: process.env.NODE_ENV === 'development' ? err.message : 'Error interno' }); });

module.exports = app;
