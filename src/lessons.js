'use strict';

const { mondayOf, parseDate, addDays } = require('./util');

/* Создаёт строки уроков из расписания на конкретную дату.
   Нужно, чтобы учитель видел новый день без отдельного планировщика. */
function ensureLessonsForDate(db, date) {
  const weekStart = mondayOf(date);
  const dayOfWeek = parseDate(date).getUTCDay();
  if (dayOfWeek < 1 || dayOfWeek > 5) return 0;

  const entries = db.prepare(`
    SELECT * FROM schedule
    WHERE week_start = ? AND day_of_week = ?
  `).all(weekStart, dayOfWeek);

  if (!entries.length) return 0;

  const insert = db.prepare(`
    INSERT OR IGNORE INTO lessons
      (schedule_id, class_id, subject_id, teacher_id, date, lesson_no, lesson_type)
    VALUES (?, ?, ?, ?, ?, ?, 'regular')
  `);

  const run = db.transaction(() => {
    let created = 0;
    for (const entry of entries) {
      created += insert.run(
        entry.id,
        entry.class_id,
        entry.subject_id,
        entry.teacher_id,
        date,
        entry.lesson_no
      ).changes;
    }
    return created;
  });

  return run();
}

function ensureLessonsForRange(db, fromDate, toDate) {
  let date = fromDate;
  let total = 0;
  while (date <= toDate) {
    total += ensureLessonsForDate(db, date);
    date = addDays(date, 1);
  }
  return total;
}

module.exports = { ensureLessonsForDate, ensureLessonsForRange };
