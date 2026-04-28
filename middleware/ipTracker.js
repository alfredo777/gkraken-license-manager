const geoip = require('geoip-lite');

const getClientIp = (req) => {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.connection?.remoteAddress || req.socket?.remoteAddress || req.ip || '127.0.0.1';
};

const getGeoData = (ip) => {
  const cleanIp = ip.replace('::ffff:', '');
  const geo = geoip.lookup(cleanIp);
  return {
    ip: cleanIp,
    country: geo?.country || 'Unknown',
    region: geo?.region || 'Unknown',
    city: geo?.city || 'Unknown',
    timezone: geo?.timezone || 'Unknown',
    latitude: geo?.ll?.[0] || null,
    longitude: geo?.ll?.[1] || null
  };
};

const ipTrackerMiddleware = (req, res, next) => {
  const ip = getClientIp(req);
  const geo = getGeoData(ip);
  req.clientIp = ip;
  req.clientGeo = geo;
  next();
};

module.exports = { ipTrackerMiddleware, getClientIp, getGeoData };
