'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');

fs.mkdirSync(path.dirname(config.DATABASE_FILE), { recursive: true });
fs.mkdirSync(config.UPLOADS_DIR, { recursive: true });

const db = new Database(config.DATABASE_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
if (userCount === 0) {
  require('./seed')(db);
  console.log('[diary+] База была пустой — демо-данные созданы.');
}

module.exports = db;
