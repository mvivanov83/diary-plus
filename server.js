'use strict';

const express = require('express');
const path = require('path');
const multer = require('multer');
const config = require('./src/config');
const db = require('./src/db');
const { sessionMiddleware } = require('./src/auth');
const { sendError } = require('./src/layout');

const app = express();

app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
}));
app.use(sessionMiddleware);

app.use('/', require('./src/routes/auth'));
app.use('/admin', require('./src/routes/admin'));
app.use('/teacher', require('./src/routes/teacher'));
app.use('/parent', require('./src/routes/parent'));
app.use('/', require('./src/routes/files'));

app.get('/healthz', (req, res) => {
  try {
    const ok = db.prepare('SELECT 1 AS ok').get().ok === 1;
    res.json({ ok, service: 'diary-plus', time: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ ok: false });
  }
});

app.use((req, res) => {
  sendError(res, 404, 'Страница не найдена', 'Проверьте адрес или вернитесь на главную.', req.user);
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);

  if (error instanceof multer.MulterError) {
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? 'Файл больше 10 МБ.'
      : 'Не удалось загрузить файл.';
    return sendError(res, 400, 'Ошибка загрузки', message, req.user);
  }

  if (error && error.code === 'LIMIT_FILE_TYPE') {
    return sendError(res, 400, 'Ошибка загрузки', error.message, req.user);
  }

  console.error('[diary+] Ошибка:', error);
  return sendError(res, 500, 'Внутренняя ошибка', 'Что-то пошло не так. Попробуйте обновить страницу.', req.user);
});

const server = app.listen(config.PORT, '0.0.0.0', () => {
  console.log(`[diary+] Сервер запущен: http://localhost:${config.PORT}`);
  console.log(`[diary+] База данных: ${config.DATABASE_FILE}`);
  console.log(`[diary+] Файлы ДЗ: ${config.UPLOADS_DIR}`);
});

function shutdown(signal) {
  console.log(`[diary+] ${signal}: завершаю работу`);
  server.close(() => {
    try {
      db.close();
    } catch {
      /* noop */
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = app;
