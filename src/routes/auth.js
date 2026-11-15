'use strict';

const express = require('express');
const db = require('../db');
const {
  verifyPassword,
  createSession,
  destroySession,
  requireAuth,
  homeForRole,
} = require('../auth');
const { authPage } = require('../layout');
const { todayMoscow } = require('../util');

const router = express.Router();

/* Простое ограничение перебора паролей (в памяти процесса). */
const failedAttempts = new Map();
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const ATTEMPT_LIMIT = 10;

function attemptKey(req, email) {
  return `${req.ip}:${String(email).toLowerCase()}`;
}

router.get('/login', (req, res) => {
  if (req.user) return res.redirect(homeForRole(req.user.role));
  return res.send(authPage({
    title: 'Вход',
    body: '',
    error: req.query.error === 'session' ? 'Сессия истекла, войдите снова.' : '',
  }));
});

router.post('/login', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const key = attemptKey(req, email);
  const now = Date.now();
  const attempts = (failedAttempts.get(key) || []).filter((time) => now - time < ATTEMPT_WINDOW_MS);

  if (attempts.length >= ATTEMPT_LIMIT) {
    return res.status(429).send(authPage({
      title: 'Вход',
      body: '',
      error: 'Слишком много попыток. Попробуйте через 10 минут.',
    }));
  }

  const user = db.prepare(
    'SELECT id, email, role, full_name, password_hash FROM users WHERE email = ?'
  ).get(email);

  if (!user || !verifyPassword(password, user.password_hash)) {
    attempts.push(now);
    failedAttempts.set(key, attempts);
    return res.status(401).send(authPage({
      title: 'Вход',
      body: '',
      error: 'Неверный e-mail или пароль.',
    }));
  }

  failedAttempts.delete(key);
  createSession(req, res, user.id);
  return res.redirect(homeForRole(user.role));
});

router.post('/logout', (req, res) => {
  destroySession(req, res);
  res.redirect('/login');
});

router.get('/api/me', requireAuth, (req, res) => {
  res.json({
    id: req.user.id,
    email: req.user.email,
    role: req.user.role,
    fullName: req.user.full_name,
    moscowToday: todayMoscow(),
  });
});

router.get('/api/health', (req, res) => {
  const dbOk = db.prepare('SELECT 1 AS ok').get().ok === 1;
  res.json({ ok: true, db: dbOk, time: new Date().toISOString() });
});

router.get('/', (req, res) => {
  if (!req.user) return res.redirect('/login');
  return res.redirect(homeForRole(req.user.role));
});

module.exports = router;
