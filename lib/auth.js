'use strict';

const jwt = require('jsonwebtoken');

function makeToken(user, secret, expiresIn = '30d') {
  return jwt.sign(
    { id: user.id, email: user.email, slug: user.slug, is_creator: true },
    secret,
    { expiresIn }
  );
}

function verifyToken(token, secret) {
  return jwt.verify(token, secret);
}

function requireAuth(jwtSecret) {
  return function (req, res, next) {
    const auth = req.headers.authorization;
    const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Auth required' });
    try {
      const payload = jwt.verify(token, jwtSecret);
      req.userId = payload.id;
      req.user = { id: payload.id };
      next();
    } catch (e) {
      return res.status(401).json({ error: 'Invalid token' });
    }
  };
}

function optionalAuth(jwtSecret) {
  return function (req, res, next) {
    const auth = req.headers.authorization;
    const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (token) {
      try {
        const payload = jwt.verify(token, jwtSecret);
        req.userId = payload.id;
        req.user = { id: payload.id };
      } catch {}
    }
    next();
  };
}

function requireCreator(jwtSecret) {
  return function (req, res, next) {
    const auth = req.headers.authorization || '';
    const token = auth.replace('Bearer ', '').trim();
    if (!token) return res.status(401).json({ error: 'No token provided' });
    try {
      const decoded = jwt.verify(token, jwtSecret);
      req.creator = decoded;
      next();
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  };
}

function requireAdmin(adminSecret) {
  return function (req, res, next) {
    if (!adminSecret) return res.status(503).json({ error: 'Admin not configured (set ADMIN_SECRET)' });
    const provided = req.query.secret || (req.headers.authorization || '').replace('Bearer ', '').trim() || (req.body && req.body.secret) || '';
    if (provided !== adminSecret) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

module.exports = {
  makeToken,
  verifyToken,
  requireAuth,
  optionalAuth,
  requireCreator,
  requireAdmin,
};
