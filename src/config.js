'use strict';

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');

const PORT = Number(process.env.PORT) || 3000;
const DATABASE_FILE = path.resolve(process.env.DATABASE_FILE || path.join(ROOT, 'data', 'app.db'));
const UPLOADS_DIR = path.resolve(process.env.UPLOADS_DIR || path.join(ROOT, 'data', 'uploads'));
const SESSION_SECRET = process.env.SESSION_SECRET || 'diary-plus-local-development-secret-change-me';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

fs.mkdirSync(path.dirname(DATABASE_FILE), { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

module.exports = {
  ROOT,
  PORT,
  DATABASE_FILE,
  UPLOADS_DIR,
  SESSION_SECRET,
  SESSION_TTL_MS,
};
