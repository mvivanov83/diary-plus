'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const db = require('../db');
const config = require('../config');
const { requireRole } = require('../auth');
const { layout, sendError } = require('../layout');
const {
  escapeHtml,
  todayMoscow,
  addDays,
  mondayOf,
  formatDate,
  formatShortDate,
  formatWeekRange,
  formatDateTimeMoscow,
  lessonFillState,
  lessonTypeLabel,
  lessonWeight,
  attendanceLabel,
  attendanceShort,
  satisfactoryLabel,
  parseGradeList,
  trimOrNull,
  moscowDeadline,
  moscowTime,
  LESSON_TYPE_LABELS,
} = require('../util');
const {
  getFlash,
  pageHead,
  emptyState,
  statusBadge,
  gradeChips,
  attendanceBadge,
  percent,
} = require('../ui');
const { ensureLessonsForRange } = require('../lessons');

const router = express.Router();
router.use(requireRole('teacher'));

const LESSON_TIMES = {
  1: ['09:00', '09:45'],
  2: ['09:55', '10:40'],
  3: ['11:00', '11:45'],
  4: ['12:00', '12:45'],
  5: ['13:00', '13:45'],
  6: ['14:00', '14:45'],
  7: ['15:00', '15:45'],
  8: ['16:00', '16:45'],
};

const DAY_NAMES = {
  1: 'Понедельник',
  2: 'Вторник',
  3: 'Среда',
  4: 'Четверг',
  5: 'Пятница',
};

const ALLOWED_EXTENSIONS = new Set(['.pdf', '.doc', '.docx', '.txt', '.png', '.jpg', '.jpeg', '.zip']);

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

function loadOwnLesson(req, res, next) {
  const id = toId(req.params.id);
  const lesson = id ? db.prepare(`
    SELECT l.*, c.name AS class_name, s.name AS subject_name,
           sc.time_start, sc.time_end, sc.room
    FROM lessons l
    JOIN classes c ON c.id = l.class_id
    JOIN subjects s ON s.id = l.subject_id
    LEFT JOIN schedule sc ON sc.id = l.schedule_id
    WHERE l.id = ? AND l.teacher_id = ?
  `).get(id, req.user.id) : null;

  if (!lesson) {
    return sendError(res, 404, 'Урок не найден', 'Урок не существует или принадлежит другому учителю.', req.user);
  }
  req.lesson = lesson;
  return next();
}

function decodeOriginalName(name) {
  const raw = String(name || 'homework');
  try {
    const decoded = Buffer.from(raw, 'latin1').toString('utf8');
    return decoded.includes('\uFFFD') ? raw : decoded;
  } catch {
    return raw;
  }
}

const storage = multer.diskStorage({
  destination: (req, file, callback) => callback(null, config.UPLOADS_DIR),
  filename: (req, file, callback) => {
    const extension = path.extname(file.originalname || '').toLowerCase();
    callback(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${extension}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    const extension = path.extname(file.originalname || '').toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      const error = new Error('Можно загрузить PDF, DOC, DOCX, TXT, PNG, JPG или ZIP до 10 МБ.');
      error.code = 'LIMIT_FILE_TYPE';
      return callback(error);
    }
    return callback(null, true);
  },
});

function removeUploaded(filename) {
  if (!filename) return;
  const fullPath = path.join(config.UPLOADS_DIR, path.basename(filename));
  fs.unlink(fullPath, () => {});
}

function timeForLesson(lesson) {
  if (lesson.time_start) return [lesson.time_start, lesson.time_end].filter(Boolean);
  return LESSON_TIMES[lesson.lesson_no] || [];
}

function timerText(deadline) {
  const diff = deadline.getTime() - Date.now();
  if (diff <= 0) return 'Дедлайн 18:00 прошёл';
  const totalMinutes = Math.ceil(diff / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) return `${hours} ч ${minutes} мин`;
  if (hours > 0) return `${hours} ч`;
  return `${minutes} мин`;
}

/* ─────────────────────────── Мой день ───────────────────────── */

router.get('/', (req, res) => {
  const today = todayMoscow();
  ensureLessonsForRange(db, addDays(today, -14), today);

  const todayLessons = db.prepare(`
    SELECT l.*, c.name AS class_name, s.name AS subject_name,
           sc.time_start, sc.time_end, sc.room,
           (SELECT COUNT(*) FROM grades g WHERE g.lesson_id = l.id) AS grade_count
    FROM lessons l
    JOIN classes c ON c.id = l.class_id
    JOIN subjects s ON s.id = l.subject_id
    LEFT JOIN schedule sc ON sc.id = l.schedule_id
    WHERE l.teacher_id = ? AND l.date = ?
    ORDER BY l.lesson_no
  `).all(req.user.id, today);

  const recentUnfilled = db.prepare(`
    SELECT l.*, c.name AS class_name, s.name AS subject_name,
           sc.time_start, sc.time_end
    FROM lessons l
    JOIN classes c ON c.id = l.class_id
    JOIN subjects s ON s.id = l.subject_id
    LEFT JOIN schedule sc ON sc.id = l.schedule_id
    WHERE l.teacher_id = ? AND l.filled_at IS NULL AND l.date <= ? AND l.date >= ?
    ORDER BY l.date DESC, l.lesson_no
  `).all(req.user.id, today, addDays(today, -30));

  const missingLessons = recentUnfilled.filter((lesson) => lessonFillState(lesson) === 'missing');
  const todayUnfilled = todayLessons.filter((lesson) => {
    const state = lessonFillState(lesson);
    return state === 'missing' || state === 'pending';
  });
  const filledToday = todayLessons.length - todayUnfilled.length;
  const deadline = moscowDeadline(today);
  const nowTime = moscowTime();
  const showReminder = nowTime.hour >= 17 && todayUnfilled.length > 0;

  const lessonsHtml = todayLessons.length ? todayLessons.map((lesson) => {
    const state = lessonFillState(lesson);
    const times = timeForLesson(lesson);
    return `
      <a class="lesson-card" href="/teacher/lessons/${Number(lesson.id)}">
        <div class="lesson-time">
          <strong>${escapeHtml(times[0] || '—')}</strong>
          <span>${escapeHtml(times[1] || '')}</span>
          <small>урок ${Number(lesson.lesson_no)}</small>
        </div>
        <div class="lesson-main">
          <div class="lesson-topline">
            <span class="tag">${escapeHtml(lesson.class_name)}</span>
            <h3>${escapeHtml(lesson.subject_name)}</h3>
            ${statusBadge(state)}
          </div>
          <p class="${lesson.topic ? 'lesson-topic' : 'lesson-topic lesson-topic--empty'}">${lesson.topic ? escapeHtml(lesson.topic) : 'Тема и посещаемость ещё не заполнены'}</p>
          <div class="lesson-meta">
            ${lesson.room ? `<span>Каб. ${escapeHtml(lesson.room)}</span>` : ''}
            <span>${lesson.grade_count ? `Оценок: ${Number(lesson.grade_count)}` : 'Оценок нет'}</span>
            ${lesson.filled_at ? `<span>Заполнен ${escapeHtml(formatDateTimeMoscow(lesson.filled_at))}</span>` : ''}
          </div>
        </div>
        <span class="lesson-arrow" aria-hidden="true">→</span>
      </a>`;
  }).join('') : emptyState('На сегодня уроков нет', 'Расписание на сегодня не задано. Проверьте расписание у администратора.');

  const missingHtml = missingLessons.length ? `
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th>Дата</th><th>Урок</th><th>Класс</th><th>Предмет</th><th>Статус</th><th></th></tr></thead>
        <tbody>
          ${missingLessons.map((lesson) => `
            <tr>
              <td>${escapeHtml(formatShortDate(lesson.date))}</td>
              <td>${Number(lesson.lesson_no)}</td>
              <td>${escapeHtml(lesson.class_name)}</td>
              <td>${escapeHtml(lesson.subject_name)}</td>
              <td>${statusBadge('missing')}</td>
              <td><a class="btn btn-ghost btn-sm" href="/teacher/lessons/${Number(lesson.id)}">Заполнить</a></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>` : emptyState('Незаполненных прошлых уроков нет', 'Все уроки за последние 30 дней заполнены.');

  const body = `
    <div class="day-head">
      <div>
        <div class="eyebrow">${escapeHtml(formatDate(today, { weekday: 'long' }))}</div>
        <h1 class="page-title">Мой день</h1>
        <p class="page-subtitle">${todayLessons.length} уроков · заполнено ${filledToday} · без заполнения ${todayUnfilled.length}</p>
      </div>
      <div class="timer-card${deadline.getTime() <= Date.now() ? ' timer-card--over' : ''}" data-deadline="${escapeHtml(deadline.toISOString())}">
        <span class="timer-label">До 18:00 по Москве</span>
        <strong class="timer-value" data-timer>${escapeHtml(timerText(deadline))}</strong>
        <small>Правило заполнения журнала</small>
      </div>
    </div>
    ${showReminder ? `<div class="flash flash--warning">Напоминание: после 17:00 остаются незаполненные уроки. До 18:00 их нужно отметить.</div>` : ''}
    <section class="card">
      <div class="card-head">
        <h2>Уроки сегодня</h2>
        <span class="card-hint">${escapeHtml(formatShortDate(today))}</span>
      </div>
      <div class="lesson-list">${lessonsHtml}</div>
    </section>
    <section class="card">
      <div class="card-head">
        <h2>Незаполненные уроки</h2>
        <span class="badge badge--danger">${missingLessons.length}</span>
      </div>
      ${missingHtml}
    </section>
    <p class="page-note">Урок считается заполненным, если указаны тема и посещаемость всех учеников. До 18:00 — «вовремя», позже — «с опозданием».</p>`;
  return render(req, res, 'Мой день', '/teacher', body);
});

/* ─────────────────────────── Журнал урока ───────────────────── */

router.get('/lessons/:id', loadOwnLesson, (req, res) => {
  const lesson = req.lesson;
  const students = db.prepare(`
    SELECT id, full_name FROM students WHERE class_id = ? ORDER BY full_name
  `).all(lesson.class_id);
  const attendanceRows = db.prepare('SELECT * FROM attendance WHERE lesson_id = ?').all(lesson.id);
  const attendanceMap = new Map(attendanceRows.map((row) => [row.student_id, row.status]));
  const gradeRows = db.prepare('SELECT * FROM grades WHERE lesson_id = ? ORDER BY id').all(lesson.id);
  const gradesMap = new Map();
  for (const row of gradeRows) {
    if (!gradesMap.has(row.student_id)) gradesMap.set(row.student_id, []);
    gradesMap.get(row.student_id).push(row);
  }

  const state = lessonFillState(lesson);
  const times = timeForLesson(lesson);
  const weight = lessonWeight(lesson.lesson_type);

  const attendanceOptions = students.map((student) => {
    const current = attendanceMap.get(student.id);
    return `
      <div class="attendance-row">
        <div class="student-cell">
          <span class="student-name">${escapeHtml(student.full_name)}</span>
          ${current ? attendanceBadge(current) : '<span class="badge badge--muted">не отмечен</span>'}
        </div>
        <div class="attendance-options" role="radiogroup" aria-label="Посещаемость: ${escapeHtml(student.full_name)}">
          ${[
            ['present', 'Н', 'Присутствовал'],
            ['absent', 'О', 'Отсутствовал'],
            ['late', 'ОП', 'Опоздал'],
            ['excused', 'У', 'Уважительная причина'],
          ].map(([value, short, label]) => `
            <label class="att-option att-option--${value}" title="${escapeHtml(label)}">
              <input type="radio" name="att_${Number(student.id)}" value="${value}"${current === value ? ' checked' : ''}>
              <span>${escapeHtml(short)}</span>
            </label>`).join('')}
        </div>
        <label class="grade-field">
          <span class="field-label">Оценки</span>
          <input class="grade-input" type="text" name="grades_${Number(student.id)}" value="${escapeHtml((gradesMap.get(student.id) || []).map((grade) => grade.value).join(' '))}" inputmode="numeric" placeholder="5 4" autocomplete="off">
        </label>
      </div>`;
  }).join('');

  const homeworkBlock = lesson.homework_file ? `
    <div class="file-card">
      <div>
        <strong>${escapeHtml(lesson.homework_original_name || 'Файл домашнего задания')}</strong>
        <span>Прикреплён к уроку</span>
      </div>
      <a class="btn btn-secondary btn-sm" href="/files/homework/${Number(lesson.id)}">Скачать</a>
    </div>
    <label class="check check--danger">
      <input type="checkbox" name="remove_homework" value="1">
      <span>Удалить текущий файл</span>
    </label>` : '<p class="muted">Файл не прикреплён.</p>';

  const body = `
    <a class="back-link" href="/teacher">← Мой день</a>
    <section class="lesson-hero">
      <div>
        <div class="hero-tags">
          <span class="tag tag--strong">${escapeHtml(lesson.class_name)}</span>
          <span class="tag">${escapeHtml(lesson.subject_name)}</span>
          <span class="tag">${escapeHtml(lessonTypeLabel(lesson.lesson_type))}</span>
        </div>
        <h1 class="page-title">${escapeHtml(formatDate(lesson.date, { weekday: 'long' }))}, урок ${Number(lesson.lesson_no)}</h1>
        <p class="page-subtitle">${escapeHtml(times.join('–'))}${lesson.room ? ` · кабинет ${escapeHtml(lesson.room)}` : ''}</p>
      </div>
      <div class="lesson-status">
        ${statusBadge(state)}
        ${lesson.filled_at ? `<span class="status-note">Заполнен ${escapeHtml(formatDateTimeMoscow(lesson.filled_at))}</span>` : '<span class="status-note">Тема и посещаемость обязательны</span>'}
      </div>
    </section>
    <form method="post" action="/teacher/lessons/${Number(lesson.id)}" enctype="multipart/form-data" class="form lesson-form">
      <section class="card">
        <div class="card-head"><h2>Урок</h2><span class="card-hint" data-weight-hint>Вес оценок: ${weight}</span></div>
        <div class="form-grid">
          <label class="field field--wide">
            <span class="field-label">Тема урока</span>
            <input type="text" name="topic" value="${escapeHtml(lesson.topic || '')}" placeholder="Например, Сложение дробей с разными знаменателями" maxlength="200" autocomplete="off">
          </label>
          <label class="field">
            <span class="field-label">Тип урока</span>
            <select name="lesson_type" data-lesson-type>
              ${Object.entries(LESSON_TYPE_LABELS).map(([value, label]) => `<option value="${value}"${lesson.lesson_type === value ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('')}
            </select>
          </label>
          <label class="field field--wide">
            <span class="field-label">Домашнее задание</span>
            <textarea name="homework_text" rows="3" maxlength="2000" placeholder="Что задано на дом">${escapeHtml(lesson.homework_text || '')}</textarea>
          </label>
          <label class="field field--wide">
            <span class="field-label">Комментарий для родителей</span>
            <textarea name="parent_comment" rows="2" maxlength="1000" placeholder="Виден родителю в дневнике">${escapeHtml(lesson.parent_comment || '')}</textarea>
          </label>
          <div class="field field--wide">
            <span class="field-label">Файл домашнего задания</span>
            ${homeworkBlock}
            <input class="file-input" type="file" name="homework_file" accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.zip">
            <span class="field-hint">PDF, DOC, DOCX, TXT, PNG, JPG, ZIP · до 10 МБ</span>
          </div>
        </div>
      </section>
      <section class="card">
        <div class="card-head">
          <h2>Посещаемость и оценки</h2>
          <button type="button" class="btn btn-secondary btn-sm" data-mark-all>Все присутствуют</button>
        </div>
        <p class="field-hint">Оценки: 2–5, можно несколько через пробел. У контрольной автоматически вес 2.</p>
        <div class="attendance-list">${attendanceOptions || emptyState('В классе нет учеников')}</div>
      </section>
      <div class="form-sticky">
        <div class="form-sticky-inner">
          <span class="muted">${escapeHtml(lesson.class_name)} · ${escapeHtml(lesson.subject_name)} · ${escapeHtml(formatShortDate(lesson.date))}</span>
          <button type="submit" class="btn btn-primary">Сохранить урок</button>
        </div>
      </div>
    </form>`;
  return render(req, res, 'Журнал урока', '/teacher', body);
});

router.post('/lessons/:id', loadOwnLesson, upload.single('homework_file'), (req, res) => {
  const lesson = req.lesson;
  const students = db.prepare('SELECT id, full_name FROM students WHERE class_id = ? ORDER BY full_name').all(lesson.class_id);
  const studentIds = new Set(students.map((student) => student.id));
  const type = Object.prototype.hasOwnProperty.call(LESSON_TYPE_LABELS, req.body.lesson_type)
    ? req.body.lesson_type
    : 'regular';
  const topic = trimOrNull(req.body.topic);
  const homeworkText = trimOrNull(req.body.homework_text);
  const parentComment = trimOrNull(req.body.parent_comment);
  const removeHomework = req.body.remove_homework === '1';

  const attendance = [];
  for (const student of students) {
    const status = req.body[`att_${student.id}`];
    if (validAttendance(status)) {
      attendance.push({ studentId: student.id, status });
    }
  }

  let gradesByStudent;
  try {
    gradesByStudent = new Map();
    for (const student of students) {
      const grades = parseGradeList(req.body[`grades_${student.id}`]);
      if (grades.length) gradesByStudent.set(student.id, grades);
    }
  } catch (error) {
    removeUploaded(req.file && req.file.filename);
    return res.redirect(`/teacher/lessons/${lesson.id}?msg=invalid`);
  }

  const newFile = req.file ? req.file.filename : null;
  const originalName = req.file ? decodeOriginalName(req.file.originalname).slice(0, 255) : null;
  const homeworkFile = newFile || (removeHomework ? null : lesson.homework_file);
  const homeworkOriginalName = newFile
    ? originalName
    : removeHomework ? null : lesson.homework_original_name;

  const complete = Boolean(topic) && attendance.length === students.length;
  const now = new Date();
  let filledAt = lesson.filled_at;
  let fillStatus = lesson.fill_status;

  if (complete) {
    if (!filledAt) {
      filledAt = now.toISOString();
      fillStatus = now <= moscowDeadline(lesson.date) ? 'on_time' : 'late';
    }
  } else {
    filledAt = null;
    fillStatus = null;
  }

  const weight = lessonWeight(type);

  try {
    const save = db.transaction(() => {
      db.prepare(`
        UPDATE lessons
        SET topic = ?, lesson_type = ?, homework_text = ?, homework_file = ?,
            homework_original_name = ?, parent_comment = ?, filled_at = ?, fill_status = ?
        WHERE id = ? AND teacher_id = ?
      `).run(
        topic,
        type,
        homeworkText,
        homeworkFile,
        homeworkOriginalName,
        parentComment,
        filledAt,
        fillStatus,
        lesson.id,
        req.user.id
      );

      db.prepare('DELETE FROM attendance WHERE lesson_id = ?').run(lesson.id);
      for (const item of attendance) {
        db.prepare('INSERT INTO attendance (lesson_id, student_id, status) VALUES (?, ?, ?)')
          .run(lesson.id, item.studentId, item.status);
      }

      db.prepare('DELETE FROM grades WHERE lesson_id = ?').run(lesson.id);
      for (const [studentId, grades] of gradesByStudent.entries()) {
        if (!studentIds.has(studentId)) continue;
        for (const value of grades) {
          db.prepare('INSERT INTO grades (lesson_id, student_id, value, weight) VALUES (?, ?, ?, ?)')
            .run(lesson.id, studentId, value, weight);
        }
      }
    });
    save();
  } catch (error) {
    removeUploaded(newFile);
    console.error('[diary+] Не удалось сохранить урок:', error);
    return res.redirect(`/teacher/lessons/${lesson.id}?msg=invalid`);
  }

  if (lesson.homework_file && lesson.homework_file !== homeworkFile) {
    removeUploaded(lesson.homework_file);
  }

  return res.redirect(`/teacher/lessons/${lesson.id}?msg=${complete ? 'saved' : 'saved-draft'}`);
});

function validAttendance(status) {
  return ['present', 'absent', 'late', 'excused'].includes(status);
}

/* ─────────────────────── Журнал класса ──────────────────────── */

router.get('/journal', (req, res) => {
  const today = todayMoscow();
  const weeks = [4, 8, 12].includes(Number(req.query.weeks)) ? Number(req.query.weeks) : 8;

  const pairs = db.prepare(`
    SELECT class_id, subject_id, class_name, subject_name
    FROM (
      SELECT l.class_id AS class_id, l.subject_id AS subject_id,
             c.name AS class_name, s.name AS subject_name
      FROM lessons l
      JOIN classes c ON c.id = l.class_id
      JOIN subjects s ON s.id = l.subject_id
      WHERE l.teacher_id = ?
      UNION
      SELECT sc.class_id, sc.subject_id, c.name, s.name
      FROM schedule sc
      JOIN classes c ON c.id = sc.class_id
      JOIN subjects s ON s.id = sc.subject_id
      WHERE sc.teacher_id = ?
    )
    GROUP BY class_id, subject_id
    ORDER BY class_name, subject_name
  `).all(req.user.id, req.user.id);

  if (!pairs.length) {
    return render(req, res, 'Журнал класса', '/teacher/journal', `
      ${pageHead('Журнал класса', 'Сетка ученики × даты')}
      ${emptyState('Пока нет классов и предметов', 'Администратор должен назначить вам уроки в расписании.')}`);
  }

  let selected = null;
  if (typeof req.query.pair === 'string' && req.query.pair.includes(':')) {
    const [classRaw, subjectRaw] = req.query.pair.split(':');
    const classId = toId(classRaw);
    const subjectId = toId(subjectRaw);
    selected = pairs.find((pair) => pair.class_id === classId && pair.subject_id === subjectId) || null;
  }
  if (!selected) {
    const classId = toId(req.query.class_id);
    const subjectId = toId(req.query.subject_id);
    selected = pairs.find((pair) => pair.class_id === classId && pair.subject_id === subjectId) || null;
  }
  if (!selected) selected = pairs[0];

  const currentMonday = mondayOf(today);
  const fromDate = addDays(currentMonday, -(weeks - 1) * 7);

  const lessons = db.prepare(`
    SELECT l.*, c.name AS class_name, s.name AS subject_name
    FROM lessons l
    JOIN classes c ON c.id = l.class_id
    JOIN subjects s ON s.id = l.subject_id
    WHERE l.teacher_id = ? AND l.class_id = ? AND l.subject_id = ?
      AND l.date >= ? AND l.date <= ?
    ORDER BY l.date, l.lesson_no
  `).all(req.user.id, selected.class_id, selected.subject_id, fromDate, today);

  const students = db.prepare('SELECT id, full_name FROM students WHERE class_id = ? ORDER BY full_name')
    .all(selected.class_id);

  const gradeRows = db.prepare(`
    SELECT g.* FROM grades g
    JOIN lessons l ON l.id = g.lesson_id
    WHERE l.teacher_id = ? AND l.class_id = ? AND l.subject_id = ?
      AND l.date >= ? AND l.date <= ?
    ORDER BY g.id
  `).all(req.user.id, selected.class_id, selected.subject_id, fromDate, today);

  const attendanceRows = db.prepare(`
    SELECT a.* FROM attendance a
    JOIN lessons l ON l.id = a.lesson_id
    WHERE l.teacher_id = ? AND l.class_id = ? AND l.subject_id = ?
      AND l.date >= ? AND l.date <= ?
  `).all(req.user.id, selected.class_id, selected.subject_id, fromDate, today);

  const gradesMap = new Map();
  for (const row of gradeRows) {
    const key = `${row.lesson_id}:${row.student_id}`;
    if (!gradesMap.has(key)) gradesMap.set(key, []);
    gradesMap.get(key).push(row);
  }
  const attendanceMap = new Map();
  for (const row of attendanceRows) {
    attendanceMap.set(`${row.lesson_id}:${row.student_id}`, row.status);
  }

  const studentStats = new Map();
  for (const student of students) {
    const grades = gradeRows.filter((row) => row.student_id === student.id);
    const weightSum = grades.reduce((sum, row) => sum + row.value * row.weight, 0);
    const weightTotal = grades.reduce((sum, row) => sum + row.weight, 0);
    const attendance = attendanceRows.filter((row) => row.student_id === student.id);
    const missed = attendance.filter((row) => row.status === 'absent' || row.status === 'excused').length;
    studentStats.set(student.id, {
      average: weightTotal ? weightSum / weightTotal : null,
      final: weightTotal ? Math.round(weightSum / weightTotal) : null,
      missed,
      attendanceTotal: attendance.length,
      missedPercent: attendance.length ? (missed / attendance.length) * 100 : null,
    });
  }

  const pairOptions = pairs.map((pair) => {
    const value = `${pair.class_id}:${pair.subject_id}`;
    const isSelected = pair.class_id === selected.class_id && pair.subject_id === selected.subject_id;
    return `<option value="${value}"${isSelected ? ' selected' : ''}>${escapeHtml(pair.class_name)} · ${escapeHtml(pair.subject_name)}</option>`;
  }).join('');

  const headerCells = lessons.map((lesson) => `
    <th>
      <a class="journal-date" href="/teacher/lessons/${Number(lesson.id)}">
        <span>${escapeHtml(formatShortDate(lesson.date))}</span>
        <small>№${Number(lesson.lesson_no)}${lesson.lesson_type === 'test' ? ' · К' : lesson.lesson_type === 'independent' ? ' · С' : ''}</small>
      </a>
    </th>`).join('');

  const tableRows = students.map((student) => {
    const stats = studentStats.get(student.id);
    const cells = lessons.map((lesson) => {
      const key = `${lesson.id}:${student.id}`;
      const grades = gradesMap.get(key) || [];
      const attendance = attendanceMap.get(key);
      return `<td class="journal-cell">
        <div class="journal-grades">${gradeChips(grades)}</div>
        ${attendance && attendance !== 'present' ? attendanceBadge(attendance) : ''}
      </td>`;
    }).join('');
    return `
      <tr>
        <th scope="row" class="student-col">${escapeHtml(student.full_name)}</th>
        ${cells}
        <td class="journal-result"><strong>${stats.average === null ? '—' : escapeHtml(satisfactoryLabel(stats.average))}</strong></td>
        <td class="journal-result">${stats.final === null ? '—' : `<span class="grade grade--${Math.min(5, Math.max(2, stats.final))}">${stats.final}</span>`}</td>
        <td class="journal-result">${stats.missedPercent === null ? '—' : escapeHtml(percent(stats.missedPercent))}</td>
      </tr>`;
  }).join('');

  const classWeightSum = gradeRows.reduce((sum, row) => sum + row.value * row.weight, 0);
  const classWeightTotal = gradeRows.reduce((sum, row) => sum + row.weight, 0);
  const classAverage = classWeightTotal ? classWeightSum / classWeightTotal : null;
  const classMissed = attendanceRows.filter((row) => row.status === 'absent' || row.status === 'excused').length;
  const classMissedPercent = attendanceRows.length ? (classMissed / attendanceRows.length) * 100 : null;

  const content = lessons.length ? `
    <div class="table-wrap journal-scroll">
      <table class="journal-table">
        <thead>
          <tr>
            <th scope="col" class="student-col">Ученик</th>
            ${headerCells}
            <th class="journal-result">Средний</th>
            <th class="journal-result">Итог</th>
            <th class="journal-result">Пропуски</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
        <tfoot>
          <tr>
            <th scope="row" class="student-col">Средний по классу</th>
            <td colspan="${lessons.length}" class="journal-class-average">Взвешенное среднее по всем оценкам</td>
            <td class="journal-result"><strong>${classAverage === null ? '—' : escapeHtml(satisfactoryLabel(classAverage))}</strong></td>
            <td class="journal-result">${classAverage === null ? '—' : `<span class="grade grade--${Math.min(5, Math.max(2, Math.round(classAverage)))}">${Math.round(classAverage)}</span>`}</td>
            <td class="journal-result">${classMissedPercent === null ? '—' : escapeHtml(percent(classMissedPercent))}</td>
          </tr>
        </tfoot>
      </table>
    </div>` : emptyState('В выбранном периоде уроков нет', 'Измените период или выберите другой класс и предмет.');

  const body = `
    ${pageHead('Журнал класса', 'Сетка ученики × даты · взвешенный средний балл', `
      <form method="get" action="/teacher/journal" class="inline-form">
        <select name="pair" onchange="this.form.submit()" aria-label="Класс и предмет">${pairOptions}</select>
        <select name="weeks" onchange="this.form.submit()" aria-label="Период">
          ${[4, 8, 12].map((value) => `<option value="${value}"${weeks === value ? ' selected' : ''}>${value} недель</option>`).join('')}
        </select>
        <noscript><button class="btn btn-secondary btn-sm" type="submit">Показать</button></noscript>
      </form>
    `)}
    <section class="card">
      <div class="journal-head">
        <div>
          <span class="tag tag--strong">${escapeHtml(selected.class_name)}</span>
          <span class="tag">${escapeHtml(selected.subject_name)}</span>
        </div>
        <div class="journal-period">${escapeHtml(formatWeekRange(mondayOf(fromDate)))} — ${escapeHtml(formatWeekRange(currentMonday))}</div>
      </div>
      ${content}
    </section>
    <div class="legend">
      <span><span class="grade grade--5">5</span> отлично</span>
      <span><span class="grade grade--4">4</span> хорошо</span>
      <span><span class="grade grade--3">3</span> удовлетворительно</span>
      <span><span class="grade grade--2">2</span> плохо</span>
      <span><span class="grade grade--5">5<span class="grade-weight">×2</span></span> контрольная, вес 2</span>
      <span>О — отсутствовал, У — уважительная, ОП — опоздал</span>
    </div>
    <p class="page-note">Средний балл взвешенный: контрольная работа считается с весом 2. «Итог» — округление среднего до целой оценки за выбранный период.</p>`;
  return render(req, res, 'Журнал класса', '/teacher/journal', body);
});

module.exports = router;
