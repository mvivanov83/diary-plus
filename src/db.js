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

/* Мягкие миграции для баз, созданных на этапе 1: CREATE TABLE IF NOT EXISTS
   не добавляет новые столбцы в уже существующие таблицы. */
function hasColumn(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((item) => item.name === column);
}

if (!hasColumn('users', 'status')) {
  db.exec("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
  console.log('[diary+] Миграция: users.status');
}
if (!hasColumn('parent_requests', 'user_id')) {
  db.exec('ALTER TABLE parent_requests ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL');
  console.log('[diary+] Миграция: parent_requests.user_id');
}

/* Демо-заявка этапа 1 была без аккаунта. Связываем её с тестовым
   родителем, чтобы можно было проверить экран «Заявка на рассмотрении». */
(function linkLegacyDemoRequest() {
  const request = db.prepare(`
    SELECT id, email, full_name FROM parent_requests
    WHERE status = 'pending' AND user_id IS NULL AND email = 'newparent@diary.app'
    LIMIT 1
  `).get();
  if (!request) return;

  let user = db.prepare('SELECT id FROM users WHERE email = ?').get(request.email);
  if (!user) {
    const bcrypt = require('bcryptjs');
    const id = db.prepare(`
      INSERT INTO users (email, password_hash, role, full_name, status)
      VALUES (?, ?, 'parent', ?, 'pending')
    `).run(request.email, bcrypt.hashSync('parent123', 10), request.full_name).lastInsertRowid;
    user = { id: Number(id) };
    console.log('[diary+] Миграция: создан демо-родитель на модерации newparent@diary.app');
  }
  db.prepare('UPDATE parent_requests SET user_id = ? WHERE id = ?').run(user.id, request.id);
})();

/* Для баз этапа 1 добавляем демо-уведомления и заметку, чтобы новые экраны
   можно было проверить без пересоздания базы. */
(function seedStageTwoDemo() {
  const parent = db.prepare("SELECT id FROM users WHERE email = 'parent1@diary.app'").get();
  if (!parent) return;
  const children = db.prepare(`
    SELECT st.id, st.full_name, st.class_id FROM parent_students ps
    JOIN students st ON st.id = ps.student_id WHERE ps.parent_id = ?
    ORDER BY st.id
  `).all(parent.id);
  if (!children.length) return;

  if (db.prepare('SELECT COUNT(*) AS c FROM notifications').get().c === 0) {
    const insert = db.prepare(`
      INSERT INTO notifications (parent_id, student_id, kind, title, body, link, created_at, read_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const now = Date.now();
    const hoursAgo = (hours) => new Date(now - hours * 60 * 60 * 1000).toISOString();
    const first = children[0];
    const second = children[1] || children[0];
    insert.run(parent.id, first.id, 'grade', 'Новая оценка: Математика',
      `${first.full_name}: 5 за контрольную работу.`, `/parent/performance?child=${first.id}`, hoursAgo(2), null);
    insert.run(parent.id, first.id, 'homework', 'Домашнее задание: Математика',
      `${first.full_name}: № 145–148, повторить правила сложения дробей.`, `/parent/children/${first.id}/diary`, hoursAgo(5), null);
    insert.run(parent.id, second.id, 'token', 'Начислено 2 токен(ов)',
      `${second.full_name}: активность на уроке.`, `/parent/tokens?child=${second.id}`, hoursAgo(26), null);
    insert.run(parent.id, second.id, 'schedule', 'Расписание: 7В',
      `${second.full_name}: изменение в расписании на текущую неделю.`, `/parent/children/${second.id}/diary`, hoursAgo(50), hoursAgo(48));
    console.log('[diary+] Миграция: демо-уведомления для parent1@diary.app');
  }

  if (db.prepare('SELECT COUNT(*) AS c FROM student_notes').get().c === 0) {
    const teacher = db.prepare("SELECT id FROM users WHERE email = 'teacher1@diary.app'").get();
    if (teacher) {
      db.prepare('INSERT INTO student_notes (student_id, teacher_id, body, created_at) VALUES (?, ?, ?, ?)')
        .run(children[0].id, teacher.id,
          'Сильный ученик, стоит предложить задания повышенной сложности. Родителю не показывать.',
          new Date().toISOString());
      console.log('[diary+] Миграция: демо-заметка учителя');
    }
  }
})();

const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
if (userCount === 0) {
  require('./seed')(db);
  console.log('[diary+] База была пустой — демо-данные созданы.');
}

module.exports = db;
