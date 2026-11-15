'use strict';

const express = require('express');
const db = require('../db');
const {
  verifyPassword,
  hashPassword,
  createSession,
  destroySession,
  requireAuth,
  homeForRole,
} = require('../auth');
const { authPage, registerPage } = require('../layout');
const { todayMoscow, isValidEmail } = require('../util');

const router = express.Router();

/* Простое ограничение перебора паролей (в памяти процесса). */
const failedAttempts = new Map();
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const ATTEMPT_LIMIT = 10;

function attemptKey(req, email) {
  return `${req.ip}:${String(email).toLowerCase()}`;
}

function homeAfterLogin(user) {
  if (user.role === 'parent' && user.status === 'pending') return '/parent/pending';
  return homeForRole(user.role);
}

router.get('/login', (req, res) => {
  if (req.user) return res.redirect(homeAfterLogin(req.user));
  return res.send(authPage({
    title: 'Вход',
    body: '',
    error: req.query.error === 'session' ? 'Сессия истекла, войдите снова.' : '',
  }));
});

router.get('/register', (req, res) => {
  if (req.user) return res.redirect(homeAfterLogin(req.user));
  const classes = db.prepare('SELECT name FROM classes ORDER BY name').all();
  return res.send(registerPage({ title: 'Регистрация родителя', classes }));
});

router.post('/register', (req, res) => {
  const fullName = String(req.body.full_name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const childName = String(req.body.child_name || '').trim();
  const childClass = String(req.body.child_class || '').trim();
  const classes = db.prepare('SELECT name FROM classes ORDER BY name').all();
  const fail = (error) => res.status(400).send(registerPage({
    title: 'Регистрация родителя',
    classes,
    error,
    values: { full_name: fullName, email, child_name: childName, child_class: childClass },
  }));

  if (!fullName || !childName || !childClass) return fail('Заполните ФИО, данные ребёнка и класс.');
  if (!isValidEmail(email)) return fail('Укажите корректный e-mail.');
  if (password.length < 6) return fail('Пароль должен быть не короче 6 символов.');
  if (!classes.some((item) => item.name === childClass)) return fail('Выберите класс из списка.');

  const existing = db.prepare('SELECT id, role, status FROM users WHERE email = ?').get(email);
  if (existing) {
    return fail(existing.status === 'pending'
      ? 'Заявка с этим e-mail уже находится на модерации.'
      : 'Этот e-mail уже используется. Войдите или восстановите доступ у администратора.');
  }

  let userId;
  try {
    const register = db.transaction(() => {
      userId = Number(db.prepare(`
        INSERT INTO users (email, password_hash, role, full_name, status)
        VALUES (?, ?, 'parent', ?, 'pending')
      `).run(email, hashPassword(password), fullName).lastInsertRowid);
      db.prepare(`
        INSERT INTO parent_requests (email, full_name, child_name, child_class, status, user_id)
        VALUES (?, ?, ?, ?, 'pending', ?)
      `).run(email, fullName, childName, childClass, userId);
    });
    register();
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return fail('Этот e-mail уже используется.');
    throw error;
  }

  console.log(`[diary+] Письмо-подтверждение (MVP, лог): ${email} — заявка на регистрацию родителя принята, ребёнок ${childName}, класс ${childClass}.`);

  const user = db.prepare('SELECT id, email, role, full_name, status FROM users WHERE id = ?').get(userId);
  createSession(req, res, user.id);
  return res.redirect('/parent/pending?msg=request-created');
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
    'SELECT id, email, role, full_name, password_hash, status FROM users WHERE email = ?'
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
  if (user.status === 'rejected') {
    return res.status(403).send(authPage({
      title: 'Вход',
      body: '',
      error: 'Заявка на регистрацию отклонена администратором школы.',
    }));
  }

  createSession(req, res, user.id);
  return res.redirect(homeAfterLogin(user));
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
