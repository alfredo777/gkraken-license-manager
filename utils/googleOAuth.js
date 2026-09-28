// Login con Google (OAuth 2.0, código de autorización + PKCE) del lado del
// servidor. El client secret nunca sale de aquí.
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');

const redirectUri = () => process.env.GOOGLE_REDIRECT_URI || `${process.env.APP_URL}/auth/google/callback`;
const isConfigured = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
const client = () => new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, redirectUri());

const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const challengeFor = (verifier) => crypto.createHash('sha256').update(verifier).digest('base64url');

const buildAuthUrl = (state, codeVerifier) => client().generateAuthUrl({
  access_type: 'online',
  scope: ['openid', 'email', 'profile'],
  state,
  code_challenge: challengeFor(codeVerifier),
  code_challenge_method: 'S256',
  prompt: 'select_account'
});

// Cambia el código por tokens y verifica el id_token (firma, audiencia, expiración).
// Devuelve { sub, email, email_verified, name, picture }.
const exchangeCode = async (code, codeVerifier) => {
  const c = client();
  const { tokens } = await c.getToken({ code, codeVerifier, redirect_uri: redirectUri() });
  if (!tokens.id_token) throw new Error('Google no devolvió id_token.');
  const ticket = await c.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID });
  const p = ticket.getPayload();
  return { sub: p.sub, email: p.email, email_verified: p.email_verified === true, name: p.name, picture: p.picture };
};

module.exports = { isConfigured, buildAuthUrl, exchangeCode, randomToken, redirectUri };
