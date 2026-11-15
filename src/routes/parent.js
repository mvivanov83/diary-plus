'use strict';

const express = require('express');
const db = require('../db');
const { requireRole } = require('../auth');
const { layout, sendError } = require('../layout');
const {
  escapeHtml,
  todayMoscow,
  addDays,
  mondayOf,
  weekDays,
  formatDate,
  formatShortDate,
  formatWeekRange,
  lessonTypeLabel,
  attendanceLabel,
  satisfactoryLabel,
  isValidDateString,
} = require('../util');
const {
  getFlash,
  pageHead,
  emptyState,
  gradeChips,
  attendanceBadge,
  initials,
  percent,
} = require('../ui');

const router = express.Router();
router.use(requireRole('parent'));

const DAY_NAMES = {
  1: 'Понедельник',
  2: 'Вторник',
  3: 'Среда',
  4: 'Четверг',
  5: 'Пятница',
};

function toId(value) {
  const id = Number.parseInt(value, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function render(req, res, title, active, body) {
  return res.send(layout({
    title,
    user: req.user,
    active,
    body,
    flash: getFlash(req.query),
  }));
}

function getChildren(parentId) {
  return db.prepare(`
    SELECT st.id, st.full_name, st.class_id, c.name AS class_name
    FROM parent_students ps
    JOIN students st ON st.id = ps.student_id
    JOIN classes c ON c.id = st.class_id
    WHERE ps.parent_id = ?
    ORDER BY c.name, st.full_name
  `).all(parentId);
}

function childStats(studentId) {
  const gradeRow = db.prepare(`
    SELECT SUM(value * weight) AS weight_sum, SUM(weight) AS weight_total
    FROM grades WHERE student_id = ?
  `).get(studentId);
  const attendanceRow = db.prepare(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN status IN ('absent', 'excused') THEN 1 ELSE 0 END) AS missed
    FROM attendance WHERE student_id = ?
  `).get(studentId);
  const tokens = db.prepare('SELECT COALESCE(SUM(amount), 0) AS balance FROM tokens WHERE student_id = ?')
    .get(studentId).balance;

  const average = gradeRow.weight_total ? gradeRow.weight_sum / gradeRow.weight_total : null;
  const missedPercent = attendanceRow.total ? (attendanceRow.missed / attendanceRow.total) * 100 : null;
  return { average, missedPercent, tokens };
}

router.get('/', (req, res) => {
  const children = getChildren(req.user.id);

  const cards = children.map((child) => {
    const stats = childStats(child.id);
    return `
      <article class="child-card">
        <div class="child-top">
          <span class="child-avatar">${initials(child.full_name)}</span>
          <div>
            <h2>${escapeHtml(child.full_name)}</h2>
            <span class="tag">${escapeHtml(child.class_name)} класс</span>
          </div>
        </div>
        <div class="child-stats">
          <div><span>Средний балл</span><strong>${stats.average === null ? '—' : escapeHtml(satisfactoryLabel(stats.average))}</strong></div>
          <div><span>Пропуски</span><strong>${stats.missedPercent === null ? '—' : escapeHtml(percent(stats.missedPercent))}</strong></div>
          <div><span>Токены</span><strong class="${stats.tokens < 0 ? 'text-danger' : ''}">${stats.tokens > 0 ? '+' : ''}${Number(stats.tokens)}</strong></div>
        </div>
        <a class="btn btn-primary btn-block" href="/parent/children/${Number(child.id)}/diary">Открыть дневник</a>
      </article>`;
  }).join('');

  const body = `
    ${pageHead('Мои дети', 'Дневник, оценки и домашние задания')}
    ${children.length ? `<div class="child-grid">${cards}</div>` : emptyState('Дети пока не привязаны', 'Администратор школы должен привязать вашего ребёнка к аккаунту.')}
    <section class="card card--soft">
      <div class="card-head"><h2>Что видно в дневнике</h2></div>
      <p class="muted">Расписание на неделю, темы уроков, оценки, домашние задания с файлами и комментарии учителя. Внутренние заметки учителей родителю не показываются.</p>
    </section>`;
  return render(req, res, 'Мои дети', '/parent', body);
});

router.get('/children/:id/diary', (req, res) => {
  const childId = toId(req.params.id);
  const child = childId ? db.prepare(`
    SELECT st.id, st.full_name, st.class_id, c.name AS class_name
    FROM parent_students ps
    JOIN students st ON st.id = ps.student_id
    JOIN classes c ON c.id = st.class_id
    WHERE ps.parent_id = ? AND st.id = ?
  `).get(req.user.id, childId) : null;

  if (!child) {
    return sendError(res, 404, 'Ребёнок не найден', 'Этот ученик не привязан к вашему аккаунту.', req.user);
  }

  const today = todayMoscow();
  const currentMonday = mondayOf(today);
  const minWeek = addDays(currentMonday, -35);
  const maxWeek = addDays(currentMonday, 35);

  let weekStart = mondayOf(isValidDateString(req.query.week) ? req.query.week : today);
  if (weekStart < minWeek) weekStart = minWeek;
  if (weekStart > maxWeek) weekStart = maxWeek;

  const weekEnd = addDays(weekStart, 6);
  const prevWeek = addDays(weekStart, -7);
  const nextWeek = addDays(weekStart, 7);

  const scheduleRows = db.prepare(`
    SELECT sc.day_of_week, sc.lesson_no, sc.room, sc.time_start, sc.time_end,
           sub.name AS subject_name, u.full_name AS teacher_name
    FROM schedule sc
    JOIN subjects sub ON sub.id = sc.subject_id
    JOIN users u ON u.id = sc.teacher_id
    WHERE sc.class_id = ? AND sc.week_start = ?
    ORDER BY sc.day_of_week, sc.lesson_no
  `).all(child.class_id, weekStart);

  const lessonRows = db.prepare(`
    SELECT l.*, sub.name AS subject_name, u.full_name AS teacher_name
    FROM lessons l
    JOIN subjects sub ON sub.id = l.subject_id
    JOIN users u ON u.id = l.teacher_id
    WHERE l.class_id = ? AND l.date BETWEEN ? AND ?
  `).all(child.class_id, weekStart, weekEnd);
  const lessonBySlot = new Map(lessonRows.map((lesson) => [`${lesson.date}:${lesson.lesson_no}`, lesson]));

  const gradeRows = db.prepare(`
    SELECT g.lesson_id, g.value, g.weight
    FROM grades g
    JOIN lessons l ON l.id = g.lesson_id
    WHERE g.student_id = ? AND l.date BETWEEN ? AND ?
    ORDER BY g.id
  `).all(child.id, weekStart, weekEnd);
  const gradesByLesson = new Map();
  for (const grade of gradeRows) {
    if (!gradesByLesson.has(grade.lesson_id)) gradesByLesson.set(grade.lesson_id, []);
    gradesByLesson.get(grade.lesson_id).push(grade);
  }

  const attendanceRows = db.prepare(`
    SELECT a.lesson_id, a.status
    FROM attendance a
    JOIN lessons l ON l.id = a.lesson_id
    WHERE a.student_id = ? AND l.date BETWEEN ? AND ?
  `).all(child.id, weekStart, weekEnd);
  const attendanceByLesson = new Map(attendanceRows.map((row) => [row.lesson_id, row.status]));

  const days = weekDays(weekStart).map((dayInfo) => {
    const entries = scheduleRows.filter((row) => row.day_of_week === dayInfo.day);
    const lessonsHtml = entries.length ? entries.map((entry) => {
      const lesson = lessonBySlot.get(`${dayInfo.date}:${entry.lesson_no}`);
      const grades = lesson ? gradesByLesson.get(lesson.id) || [] : [];
      const attendance = lesson ? attendanceByLesson.get(lesson.id) : null;
      const topic = lesson && lesson.topic ? lesson.topic : null;
      return `
        <article class="diary-lesson">
          <div class="diary-time">
            <strong>${escapeHtml(entry.time_start || '—')}</strong>
            <span>${escapeHtml(entry.time_end || '')}</span>
            <small>№${Number(entry.lesson_no)}</small>
          </div>
          <div class="diary-body">
            <div class="diary-topline">
              <h3>${escapeHtml(entry.subject_name)}</h3>
              ${lesson ? `<span class="tag tag--soft">${escapeHtml(lessonTypeLabel(lesson.lesson_type))}</span>` : ''}
              ${attendance && attendance !== 'present' ? attendanceBadge(attendance) : ''}
              ${gradeChips(grades)}
            </div>
            <p class="diary-teacher">${escapeHtml(entry.teacher_name)}${entry.room ? ` · каб. ${escapeHtml(entry.room)}` : ''}</p>
            <p class="${topic ? 'diary-topic' : 'diary-topic diary-topic--empty'}">${topic ? escapeHtml(topic) : (dayInfo.date > today ? 'Урок по расписанию' : 'Тема урока пока не заполнена')}</p>
            ${lesson && lesson.homework_text ? `<div class="diary-homework"><span>Домашнее задание</span><p>${escapeHtml(lesson.homework_text)}</p>${lesson.homework_file ? `<a class="file-link" href="/files/homework/${Number(lesson.id)}">${escapeHtml(lesson.homework_original_name || 'Скачать файл')}</a>` : ''}</div>` : ''}
            ${lesson && lesson.parent_comment ? `<div class="diary-comment"><span>Комментарий учителя</span><p>${escapeHtml(lesson.parent_comment)}</p></div>` : ''}
          </div>
        </article>`;
    }).join('') : '<p class="muted diary-empty">В этот день уроков нет.</p>';

    return `
      <section class="day-card">
        <header class="day-head-row">
          <h2>${escapeHtml(DAY_NAMES[dayInfo.day])}</h2>
          <span>${escapeHtml(formatDate(dayInfo.date))}</span>
        </header>
        <div class="diary-list">${lessonsHtml}</div>
      </section>`;
  }).join('');

  const childTabs = getChildren(req.user.id).map((item) => `
    <a class="child-tab${item.id === child.id ? ' is-active' : ''}" href="/parent/children/${Number(item.id)}/diary?week=${encodeURIComponent(weekStart)}">
      ${escapeHtml(item.full_name)} <small>${escapeHtml(item.class_name)}</small>
    </a>`).join('');

  const body = `
    <a class="back-link" href="/parent">← Мои дети</a>
    <div class="diary-head">
      <div>
        <div class="eyebrow">Дневник</div>
        <h1 class="page-title">${escapeHtml(child.full_name)}</h1>
        <p class="page-subtitle">${escapeHtml(child.class_name)} класс</p>
      </div>
      <div class="week-nav">
        ${prevWeek >= minWeek ? `<a class="btn btn-ghost btn-sm" href="/parent/children/${Number(child.id)}/diary?week=${encodeURIComponent(prevWeek)}">←</a>` : '<span class="btn btn-ghost btn-sm is-disabled">←</span>'}
        <div class="week-label"><strong>${escapeHtml(formatWeekRange(weekStart))}</strong><span>${weekStart === currentMonday ? 'текущая неделя' : 'неделя ' + escapeHtml(formatShortDate(weekStart))}</span></div>
        ${nextWeek <= maxWeek ? `<a class="btn btn-ghost btn-sm" href="/parent/children/${Number(child.id)}/diary?week=${encodeURIComponent(nextWeek)}">→</a>` : '<span class="btn btn-ghost btn-sm is-disabled">→</span>'}
      </div>
    </div>
    <div class="child-tabs">${childTabs}</div>
    <div class="diary-days">${days}</div>
    <p class="page-note">Оценки видны сразу после сохранения учителем. Файлы домашних заданий доступны только участникам класса.</p>`;
  return render(req, res, 'Дневник', '/parent', body);
});

module.exports = router;
