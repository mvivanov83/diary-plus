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
  initials,
  percent,
} = require('../ui');
const { ensureLessonsForRange } = require('../lessons');
const { notifyGrades, notifyHomework, notifyComment, notifyTokens } = require('../notify');

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
    const current = attendanceMap.get(student.id) || 'present';
    const studentGrades = (gradesMap.get(student.id) || []).map((grade) => Number(grade.value));
    return `
      <div class="attendance-row">
        <div class="student-cell">
          <a class="student-name" href="/teacher/students/${Number(student.id)}">${escapeHtml(student.full_name)}</a>
          ${attendanceMap.get(student.id) ? attendanceBadge(attendanceMap.get(student.id)) : '<span class="badge badge--muted">по умолчанию: был</span>'}
        </div>
        <div class="attendance-options" role="radiogroup" aria-label="Посещаемость: ${escapeHtml(student.full_name)}">
          ${[
            ['present', 'Б', 'Был'],
            ['absent', 'Н', 'Отсутствовал'],
            ['late', 'О', 'Опоздал'],
            ['excused', 'У', 'Уважительная'],
          ].map(([value, short, label]) => `
            <label class="att-option att-option--${value}" title="${escapeHtml(label)}">
              <input type="radio" name="att_${Number(student.id)}" value="${value}"${current === value ? ' checked' : ''}>
              <span class="att-btn">
                <span class="att-full">${escapeHtml(label)}</span>
                <span class="att-short" aria-hidden="true">${escapeHtml(short)}</span>
              </span>
            </label>`).join('')}
        </div>
        <div class="grade-editor" data-grade-editor>
          <span class="field-label">Оценки</span>
          <div class="grade-buttons" role="group" aria-label="Добавить оценку: ${escapeHtml(student.full_name)}">
            ${[5, 4, 3, 2].map((value) => `<button type="button" class="grade-btn grade-btn--${value}" data-grade-add="${value}" title="Добавить оценку ${value}" aria-label="Добавить оценку ${value}">${value}</button>`).join('')}
          </div>
          <div class="grade-picked" data-grade-list aria-live="polite"></div>
          <input type="hidden" name="grades_${Number(student.id)}" value="${escapeHtml(studentGrades.join(' '))}" data-grade-input>
        </div>
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
        <div class="attendance-legend" aria-label="Обозначения посещаемости">
          <span><span class="legend-mark legend-mark--present">Б</span> Был (по умолчанию)</span>
          <span><span class="legend-mark legend-mark--absent">Н</span> Отсутствовал</span>
          <span><span class="legend-mark legend-mark--late">О</span> Опоздал</span>
          <span><span class="legend-mark legend-mark--excused">У</span> Уважительная</span>
        </div>
        <p class="field-hint">Оценки: нажимайте 2 / 3 / 4 / 5 — можно поставить несколько. Крестик удаляет оценку. У контрольной автоматически вес 2.</p>
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
    const rawStatus = req.body[`att_${student.id}`];
    attendance.push({ studentId: student.id, status: validAttendance(rawStatus) ? rawStatus : 'present' });
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

  const oldGrades = db.prepare('SELECT student_id, value FROM grades WHERE lesson_id = ?').all(lesson.id);
  const oldGradesMap = new Map();
  for (const row of oldGrades) {
    if (!oldGradesMap.has(row.student_id)) oldGradesMap.set(row.student_id, []);
    oldGradesMap.get(row.student_id).push(Number(row.value));
  }
  const oldHomework = lesson.homework_text;
  const oldComment = lesson.parent_comment;

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

  /* Уведомления родителям — только при реальном изменении данных. */
  for (const student of students) {
    const before = (oldGradesMap.get(student.id) || []).slice().sort().join(' ');
    const after = (gradesByStudent.get(student.id) || []).slice().sort().join(' ');
    if (after && before !== after) {
      notifyGrades({
        studentId: student.id,
        subjectName: lesson.subject_name,
        className: lesson.class_name,
        date: lesson.date,
        grades: gradesByStudent.get(student.id),
      });
    }
  }
  if (homeworkText && homeworkText !== oldHomework) {
    notifyHomework({
      classId: lesson.class_id,
      subjectName: lesson.subject_name,
      className: lesson.class_name,
      date: lesson.date,
      homeworkText,
    });
  }
  if (parentComment && parentComment !== oldComment) {
    notifyComment({
      classId: lesson.class_id,
      subjectName: lesson.subject_name,
      className: lesson.class_name,
      date: lesson.date,
      comment: parentComment,
    });
  }

  return res.redirect(`/teacher/lessons/${lesson.id}?msg=${
    complete ? (fillStatus === 'late' ? 'saved-late' : 'saved-on-time') : 'saved-draft'
  }`);
});

function validAttendance(status) {
  return ['present', 'absent', 'late', 'excused'].includes(status);
}

/* ─────────────────────── Ученики учителя ────────────────────── */

const teacherClassIds = (teacherId) => db.prepare(`
  SELECT class_id FROM lessons WHERE teacher_id = ?
  UNION
  SELECT class_id FROM schedule WHERE teacher_id = ?
`).all(teacherId, teacherId).map((row) => row.class_id);

function loadTeacherStudent(req, res, next) {
  const id = toId(req.params.id);
  const student = id ? db.prepare(`
    SELECT st.id, st.full_name, st.class_id, c.name AS class_name
    FROM students st
    JOIN classes c ON c.id = st.class_id
    WHERE st.id = ?
  `).get(id) : null;

  const allowed = student && teacherClassIds(req.user.id).includes(student.class_id);
  if (!allowed) {
    return sendError(res, 404, 'Ученик не найден', 'Ученик не существует или учится в классе, который вы не преподаёте.', req.user);
  }
  req.student = student;
  return next();
}

router.get('/students', (req, res) => {
  const rows = db.prepare(`
    SELECT st.id, st.full_name, c.name AS class_name,
           (SELECT SUM(g.value * g.weight) FROM grades g WHERE g.student_id = st.id) AS weight_sum,
           (SELECT SUM(g.weight) FROM grades g WHERE g.student_id = st.id) AS weight_total,
           (SELECT COUNT(*) FROM attendance a WHERE a.student_id = st.id) AS att_total,
           (SELECT COUNT(*) FROM attendance a WHERE a.student_id = st.id AND a.status IN ('absent', 'excused')) AS att_missed,
           (SELECT COALESCE(SUM(t.amount), 0) FROM tokens t WHERE t.student_id = st.id) AS token_balance
    FROM students st
    JOIN classes c ON c.id = st.class_id
    WHERE st.class_id IN (
      SELECT class_id FROM lessons WHERE teacher_id = ?
      UNION
      SELECT class_id FROM schedule WHERE teacher_id = ?
    )
    ORDER BY c.name, st.full_name
  `).all(req.user.id, req.user.id);

  const byClass = new Map();
  for (const row of rows) {
    if (!byClass.has(row.class_name)) byClass.set(row.class_name, []);
    byClass.get(row.class_name).push(row);
  }

  const blocks = [...byClass.entries()].map(([className, list]) => `
    <section class="card">
      <div class="card-head">
        <h2>${escapeHtml(className)}</h2>
        <span class="card-hint">${list.length} учеников</span>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Ученик</th><th>Средний</th><th>Пропуски</th><th>Токены</th><th></th></tr></thead>
          <tbody>
            ${list.map((student) => {
              const average = student.weight_total ? student.weight_sum / student.weight_total : null;
              const missed = student.att_total ? (student.att_missed / student.att_total) * 100 : null;
              return `<tr>
                <td><strong><a href="/teacher/students/${Number(student.id)}">${escapeHtml(student.full_name)}</a></strong></td>
                <td>${average === null ? '—' : escapeHtml(satisfactoryLabel(average))}</td>
                <td>${missed === null ? '—' : escapeHtml(percent(missed))}</td>
                <td class="${student.token_balance < 0 ? 'text-danger' : ''}">${student.token_balance > 0 ? '+' : ''}${Number(student.token_balance)}</td>
                <td class="row-actions"><a class="btn btn-ghost btn-sm" href="/teacher/students/${Number(student.id)}">Карточка</a></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </section>`).join('');

  return render(req, res, 'Ученики', '/teacher/students', `
    ${pageHead('Ученики', 'Карточки учеников ваших классов: оценки, посещаемость, токены и заметки')}
    ${rows.length ? blocks : emptyState('Учеников нет', 'Администратор должен назначить вам уроки в расписании.')}`);
});

router.get('/students/:id', loadTeacherStudent, (req, res) => {
  const student = req.student;

  const gradeRows = db.prepare(`
    SELECT s.name AS subject_name, g.value, g.weight
    FROM grades g
    JOIN lessons l ON l.id = g.lesson_id
    JOIN subjects s ON s.id = l.subject_id
    WHERE g.student_id = ?
    ORDER BY s.name, g.id
  `).all(student.id);

  const attendanceRows = db.prepare(`
    SELECT s.name AS subject_name, a.status
    FROM attendance a
    JOIN lessons l ON l.id = a.lesson_id
    JOIN subjects s ON s.id = l.subject_id
    WHERE a.student_id = ?
  `).all(student.id);

  const subjectMap = new Map();
  const ensureSubject = (name) => {
    if (!subjectMap.has(name)) subjectMap.set(name, { grades: [], attendance: [] });
    return subjectMap.get(name);
  };
  for (const row of gradeRows) ensureSubject(row.subject_name).grades.push(row);
  for (const row of attendanceRows) ensureSubject(row.subject_name).attendance.push(row);

  const subjectRows = [...subjectMap.entries()].map(([subjectName, data]) => {
    const weightSum = data.grades.reduce((sum, row) => sum + row.value * row.weight, 0);
    const weightTotal = data.grades.reduce((sum, row) => sum + row.weight, 0);
    const missed = data.attendance.filter((row) => row.status === 'absent' || row.status === 'excused').length;
    return {
      subjectName,
      grades: data.grades,
      average: weightTotal ? weightSum / weightTotal : null,
      final: weightTotal ? Math.round(weightSum / weightTotal) : null,
      missed,
      total: data.attendance.length,
    };
  });

  const weightSum = gradeRows.reduce((sum, row) => sum + row.value * row.weight, 0);
  const weightTotal = gradeRows.reduce((sum, row) => sum + row.weight, 0);
  const average = weightTotal ? weightSum / weightTotal : null;
  const missed = attendanceRows.filter((row) => row.status === 'absent' || row.status === 'excused').length;
  const missedPercent = attendanceRows.length ? (missed / attendanceRows.length) * 100 : null;

  const tokens = db.prepare(`
    SELECT t.id, t.amount, t.reason, t.created_at, u.full_name AS teacher_name
    FROM tokens t
    LEFT JOIN users u ON u.id = t.teacher_id
    WHERE t.student_id = ?
    ORDER BY t.created_at DESC, t.id DESC
  `).all(student.id);
  const balance = tokens.reduce((sum, row) => sum + row.amount, 0);

  const notes = db.prepare(`
    SELECT n.id, n.body, n.created_at, u.full_name AS teacher_name
    FROM student_notes n
    LEFT JOIN users u ON u.id = n.teacher_id
    WHERE n.student_id = ?
    ORDER BY n.created_at DESC, n.id DESC
  `).all(student.id);

  const gradesTable = subjectRows.length ? `
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th>Предмет</th><th>Оценки</th><th>Средний</th><th>Итог</th><th>Пропуски</th></tr></thead>
        <tbody>
          ${subjectRows.map((row) => `
            <tr>
              <td><strong>${escapeHtml(row.subjectName)}</strong></td>
              <td>${gradeChips(row.grades)}</td>
              <td>${row.average === null ? '—' : escapeHtml(satisfactoryLabel(row.average))}</td>
              <td>${row.final === null ? '—' : `<span class="grade grade--${Math.min(5, Math.max(2, row.final))}">${row.final}</span>`}</td>
              <td>${row.total ? escapeHtml(percent((row.missed / row.total) * 100)) : '—'}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>` : emptyState('Оценок пока нет', 'Оценки появятся после заполнения журнала.');

  return render(req, res, 'Карточка ученика', '/teacher/students', `
    <a class="back-link" href="/teacher/students">← Ученики</a>
    <section class="student-hero">
      <div class="student-hero-main">
        <span class="child-avatar">${initials(student.full_name)}</span>
        <div>
          <div class="eyebrow">Карточка ученика</div>
          <h1 class="page-title">${escapeHtml(student.full_name)}</h1>
          <p class="page-subtitle">${escapeHtml(student.class_name)} класс</p>
        </div>
      </div>
      <div class="student-stats">
        <div><span>Средний балл</span><strong>${average === null ? '—' : escapeHtml(satisfactoryLabel(average))}</strong></div>
        <div><span>Пропуски</span><strong>${missedPercent === null ? '—' : escapeHtml(percent(missedPercent))}</strong></div>
        <div><span>Токены</span><strong class="${balance < 0 ? 'text-danger' : ''}">${balance > 0 ? '+' : ''}${balance}</strong></div>
      </div>
    </section>
    <div class="split">
      <div>
        <section class="card">
          <div class="card-head"><h2>Оценки по предметам</h2><span class="card-hint">все предметы</span></div>
          ${gradesTable}
        </section>
        <section class="card">
          <div class="card-head"><h2>История токенов</h2><span class="card-hint">баланс ${balance > 0 ? '+' : ''}${balance}</span></div>
          ${tokens.length ? `
            <div class="table-wrap">
              <table class="table">
                <thead><tr><th>Дата</th><th>Начисление</th><th>Причина</th><th>Учитель</th></tr></thead>
                <tbody>
                  ${tokens.slice(0, 50).map((token) => `
                    <tr>
                      <td>${escapeHtml(formatDateTimeMoscow(token.created_at))}</td>
                      <td><strong class="${token.amount < 0 ? 'text-danger' : 'text-success'}">${token.amount > 0 ? '+' : ''}${Number(token.amount)}</strong></td>
                      <td>${escapeHtml(token.reason)}</td>
                      <td>${escapeHtml(token.teacher_name || '—')}</td>
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>` : emptyState('Токенов пока нет', 'Начислите первый токен в форме справа.')}
        </section>
      </div>
      <aside>
        <section class="card">
          <div class="card-head"><h2>Токены</h2></div>
          <form method="post" action="/teacher/students/${Number(student.id)}/tokens" class="form">
            <label class="field">
              <span class="field-label">Действие</span>
              <select name="direction">
                <option value="add">Начислить</option>
                <option value="subtract">Списать</option>
              </select>
            </label>
            <label class="field">
              <span class="field-label">Количество</span>
              <input type="number" name="amount" min="1" max="100" step="1" value="1" required>
            </label>
            <label class="field">
              <span class="field-label">Причина</span>
              <input type="text" name="reason" maxlength="200" required placeholder="Активность на уроке">
            </label>
            <button type="submit" class="btn btn-primary btn-block">Сохранить токены</button>
          </form>
        </section>
        <section class="card">
          <div class="card-head"><h2>Внутренние заметки</h2><span class="badge">${notes.length}</span></div>
          <p class="field-hint">Видны только учителям и администратору. Родитель их не видит.</p>
          <form method="post" action="/teacher/students/${Number(student.id)}/notes" class="form">
            <label class="field">
              <span class="field-label">Новая заметка</span>
              <textarea name="body" rows="3" maxlength="2000" required placeholder="Наблюдения, договорённости с родителями, план поддержки"></textarea>
            </label>
            <button type="submit" class="btn btn-secondary btn-block">Добавить заметку</button>
          </form>
          <div class="note-list">
            ${notes.length ? notes.map((note) => `
              <article class="note-card">
                <p>${escapeHtml(note.body)}</p>
                <span>${escapeHtml(note.teacher_name || 'Учитель')} · ${escapeHtml(formatDateTimeMoscow(note.created_at))}</span>
              </article>`).join('') : '<p class="muted">Заметок пока нет.</p>'}
          </div>
        </section>
      </aside>
    </div>`);
});

router.post('/students/:id/tokens', loadTeacherStudent, (req, res) => {
  const student = req.student;
  const direction = req.body.direction === 'subtract' ? 'subtract' : 'add';
  const amount = Math.min(100, Math.max(1, Number.parseInt(req.body.amount, 10) || 0));
  const reason = trimOrNull(req.body.reason);
  const back = `/teacher/students/${student.id}`;

  if (!amount || !reason) return res.redirect(`${back}?msg=invalid`);

  const signed = direction === 'subtract' ? -amount : amount;
  db.prepare('INSERT INTO tokens (student_id, teacher_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(student.id, req.user.id, signed, reason, new Date().toISOString());
  notifyTokens({ studentId: student.id, amount: signed, reason });
  return res.redirect(`${back}?msg=tokens-saved`);
});

router.post('/students/:id/notes', loadTeacherStudent, (req, res) => {
  const student = req.student;
  const body = trimOrNull(req.body.body);
  const back = `/teacher/students/${student.id}`;
  if (!body) return res.redirect(`${back}?msg=invalid`);

  db.prepare('INSERT INTO student_notes (student_id, teacher_id, body, created_at) VALUES (?, ?, ?, ?)')
    .run(student.id, req.user.id, body.slice(0, 2000), new Date().toISOString());
  return res.redirect(`${back}?msg=note-saved`);
});

/* ─────────────────────── Журнал класса ──────────────────────── */

router.get('/journal', (req, res) => {
  const today = todayMoscow();
  const periods = { week: 1, month: 4, quarter: 12 };
  const period = Object.prototype.hasOwnProperty.call(periods, req.query.period) ? req.query.period : 'month';
  const weeks = periods[period];
  const periodLabel = { week: 'Неделя', month: 'Месяц', quarter: 'Четверть' }[period];

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

  const averageHint = 'Средневзвешенная оценка за выбранный период: сумма(оценка × вес) / сумма весов. Контрольная работа — вес 2, остальные — вес 1.';

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
        <th scope="row" class="student-col"><a href="/teacher/students/${Number(student.id)}">${escapeHtml(student.full_name)}</a></th>
        ${cells}
        <td class="journal-result journal-avg-cell" title="${escapeHtml(averageHint)}"><strong>${stats.average === null ? '—' : escapeHtml(satisfactoryLabel(stats.average))}</strong></td>
        <td class="journal-result">${stats.final === null ? '—' : `<span class="grade grade--${Math.min(5, Math.max(2, stats.final))}">${stats.final}</span>`}</td>
        <td class="journal-result">${stats.missedPercent === null ? '—' : escapeHtml(percent(stats.missedPercent))}</td>
      </tr>`;
  }).join('');

  const classWeightSum = gradeRows.reduce((sum, row) => sum + row.value * row.weight, 0);
  const classWeightTotal = gradeRows.reduce((sum, row) => sum + row.weight, 0);
  const classAverage = classWeightTotal ? classWeightSum / classWeightTotal : null;
  const classMissed = attendanceRows.filter((row) => row.status === 'absent' || row.status === 'excused').length;
  const classMissedPercent = attendanceRows.length ? (classMissed / attendanceRows.length) * 100 : null;

  const pairValue = `${selected.class_id}:${selected.subject_id}`;
  const periodSwitch = `
    <div class="period-switch" role="group" aria-label="Период журнала">
      ${Object.keys(periods).map((key) => `
        <a class="period-btn${period === key ? ' is-active' : ''}" href="/teacher/journal?pair=${encodeURIComponent(pairValue)}&period=${key}"${period === key ? ' aria-current="page"' : ''}>${escapeHtml({ week: 'Неделя', month: 'Месяц', quarter: 'Четверть' }[key])}</a>
      `).join('')}
    </div>`;

  const content = lessons.length ? `
    <div class="table-wrap journal-scroll">
      <table class="journal-table">
        <thead>
          <tr>
            <th scope="col" class="student-col">Ученик</th>
            ${headerCells}
            <th scope="col" class="journal-result journal-avg-head" title="${escapeHtml(averageHint)}">Средний<small>(взвешенный)</small></th>
            <th scope="col" class="journal-result">Итог</th>
            <th scope="col" class="journal-result">% пропусков</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
        <tfoot>
          <tr>
            <th scope="row" class="student-col">Средний по классу</th>
            <td colspan="${lessons.length}" class="journal-class-average">Взвешенное среднее по всем оценкам за период</td>
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
        <input type="hidden" name="period" value="${escapeHtml(period)}">
        <select name="pair" onchange="this.form.submit()" aria-label="Класс и предмет">${pairOptions}</select>
        <noscript><button class="btn btn-secondary btn-sm" type="submit">Показать</button></noscript>
      </form>
      ${periodSwitch}
    `)}
    <section class="card">
      <div class="journal-head">
        <div>
          <span class="tag tag--strong">${escapeHtml(selected.class_name)}</span>
          <span class="tag">${escapeHtml(selected.subject_name)}</span>
        </div>
        <div class="journal-period"><strong>${escapeHtml(periodLabel)}</strong> · ${escapeHtml(formatWeekRange(mondayOf(fromDate)))} — ${escapeHtml(formatWeekRange(currentMonday))}</div>
      </div>
      ${content}
    </section>
    <div class="legend">
      <span><span class="grade grade--5">5</span> отлично</span>
      <span><span class="grade grade--4">4</span> хорошо</span>
      <span><span class="grade grade--3">3</span> удовлетворительно</span>
      <span><span class="grade grade--2">2</span> плохо</span>
      <span><span class="grade grade--5">5<span class="grade-weight">×2</span></span> контрольная, вес 2</span>
      <span>Б — был, Н — отсутствовал, О — опоздал, У — уважительная</span>
    </div>
    <p class="page-note">Средний (взвешенный) пересчитывается за выбранный период: сумма(оценка × вес) / сумма весов. «Месяц» — 4 учебные недели, «Четверть» — 12 недель. «Итог» — округление среднего до целой оценки, «% пропусков» — доля отсутствий и уважительных пропусков.</p>`;
  return render(req, res, 'Журнал класса', '/teacher/journal', body);
});

module.exports = router;
