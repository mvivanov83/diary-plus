'use strict';

const db = require('./db');
const { formatShortDate } = require('./util');

const insertNotification = db.prepare(`
  INSERT INTO notifications
    (parent_id, student_id, kind, title, body, link, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

function createNotification({ parentId, studentId = null, kind, title, body = null, link = null }) {
  if (!parentId || !kind || !title) return;
  insertNotification.run(
    parentId,
    studentId,
    kind,
    title,
    body,
    link,
    new Date().toISOString()
  );
}

function parentsOfStudent(studentId) {
  return db.prepare(`
    SELECT ps.parent_id, ps.student_id, st.full_name AS student_name
    FROM parent_students ps
    JOIN students st ON st.id = ps.student_id
    WHERE ps.student_id = ?
  `).all(studentId);
}

function parentsOfClass(classId) {
  return db.prepare(`
    SELECT ps.parent_id, ps.student_id, st.full_name AS student_name
    FROM parent_students ps
    JOIN students st ON st.id = ps.student_id
    WHERE st.class_id = ?
  `).all(classId);
}

function toStudents(rows, build) {
  for (const row of rows) {
    const payload = build(row);
    if (payload) createNotification({ parentId: row.parent_id, studentId: row.student_id, ...payload });
  }
}

function notifyGrades({ studentId, subjectName, className, date, grades }) {
  if (!grades || !grades.length) return;
  const values = grades.join(', ');
  toStudents(parentsOfStudent(studentId), (row) => ({
    kind: 'grade',
    title: `Новая оценка: ${subjectName}`,
    body: `${row.student_name} · ${className} · ${formatShortDate(date)}: ${values}`,
    link: `/parent/performance?child=${Number(studentId)}`,
  }));
}

function notifyHomework({ classId, subjectName, className, date, homeworkText }) {
  toStudents(parentsOfClass(classId), (row) => ({
    kind: 'homework',
    title: `Домашнее задание: ${subjectName}`,
    body: `${row.student_name} · ${className} · ${formatShortDate(date)}. ${homeworkText}`.slice(0, 400),
    link: `/parent/children/${Number(row.student_id)}/diary?week=${encodeURIComponent(date)}`,
  }));
}

function notifyComment({ classId, subjectName, className, date, comment }) {
  toStudents(parentsOfClass(classId), (row) => ({
    kind: 'comment',
    title: `Комментарий учителя: ${subjectName}`,
    body: `${row.student_name} · ${className} · ${formatShortDate(date)}. ${comment}`.slice(0, 400),
    link: `/parent/children/${Number(row.student_id)}/diary?week=${encodeURIComponent(date)}`,
  }));
}

function notifyTokens({ studentId, amount, reason }) {
  const abs = Math.abs(Number(amount));
  const title = amount > 0 ? `Начислено ${abs} токен(ов)` : `Списано ${abs} токен(ов)`;
  toStudents(parentsOfStudent(studentId), (row) => ({
    kind: 'token',
    title,
    body: `${row.student_name}: ${reason}`,
    link: `/parent/tokens?child=${Number(studentId)}`,
  }));
}

function notifySchedule({ classId, className, weekStart, note = 'Изменение в расписании на неделю' }) {
  toStudents(parentsOfClass(classId), (row) => ({
    kind: 'schedule',
    title: `Расписание: ${className}`,
    body: `${row.student_name}: ${note} ${formatShortDate(weekStart)}.`,
    link: `/parent/children/${Number(row.student_id)}/diary?week=${encodeURIComponent(weekStart)}`,
  }));
}

module.exports = {
  createNotification,
  notifyGrades,
  notifyHomework,
  notifyComment,
  notifyTokens,
  notifySchedule,
};
