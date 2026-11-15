'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./db');
const config = require('./config');

const COOKIE_NAME = 'diary_sid';

function hashPassword(password) {
  return bcrypt.hashSync(String(password), 10);
}

function verifyPassword(password, hash) {
  try {
    return bcrypt.compareSync(String(password), String(hash));
  } catch {
    return false;
  }
}

function hashToken(token) {
  return crypto
    .createHmac('sha256', config.SESSION_SECRET)
    .update(String(token))
    .digest('hex');
}

function parseCookies(header) {
  const result = {};
  if (!header) return result;
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) continue;
    try {
      result[key] = decodeURIComponent(value);
    } catch {
      result[key] = value;
    }
  }
  return result;
}

function cookieOptions(req) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: Boolean(req.secure),
    path: '/',
  };
}

function createSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const expires = new Date(now.getTime() + config.SESSION_TTL_MS);

  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now.toISOString());
  db.prepare(`
    INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(hashToken(token), userId, now.toISOString(), expires.toISOString());

  res.cookie(COOKIE_NAME, token, {
    ...cookieOptions(req),
    maxAge: config.SESSION_TTL_MS,
  });
}

function destroySession(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (token) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
  }
  res.clearCookie(COOKIE_NAME, cookieOptions(req));
}

function sessionMiddleware(req, res, next) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (token) {
    const row = db.prepare(`
      SELECT u.id, u.email, u.role, u.full_name, u.status
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?
    `).get(hashToken(token), new Date().toISOString());

    if (row) {
      req.user = row;
    } else {
      res.clearCookie(COOKIE_NAME, cookieOptions(req));
    }
  }

  res.locals.user = req.user || null;
  res.locals.currentPath = req.path;
  res.locals.unread = 0;
  if (req.user && req.user.role === 'parent') {
    res.locals.unread = db.prepare(
      'SELECT COUNT(*) AS count FROM notifications WHERE parent_id = ? AND read_at IS NULL'
    ).get(req.user.id).count;
  }
  next();
}

function homeForRole(role) {
  if (role === 'admin') return '/admin';
  if (role === 'teacher') return '/teacher';
  if (role === 'parent') return '/parent';
  return '/login';
}

function requireAuth(req, res, next) {
  if (!req.user) {
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Требуется вход' });
    }
    return res.redirect('/login');
  }
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return res.redirect('/login');
    if (req.user.role !== role) {
      const { sendError } = require('./layout');
      return sendError(res, 403, 'Нет доступа', 'Этот раздел недоступен для вашей роли.', req.user);
    }
    next();
  };
}

module.exports = {
  COOKIE_NAME,
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  sessionMiddleware,
  requireAuth,
  requireRole,
  homeForRole,
};
