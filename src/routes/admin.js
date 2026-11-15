'use strict';

const express = require('express');
const db = require('../db');
const { requireRole } = require('../auth');
const { layout } = require('../layout');
const {
  escapeHtml,
  todayMoscow,
  addDays,
  mondayOf,
  isValidDateString,
  formatWeekRange,
  formatShortDate,
  lessonFillState,
  satisfactoryLabel,
} = require('../util');
const {
  getFlash,
  pageHead,
  emptyState,
  statusBadge,
} = require('../ui');

const router = express.Router();
router.use(requireRole('admin'));

const DAY_NAMES = {
  1: 'Понедельник',
  2: 'Вторник',
  3: 'Среда',
  4: 'Четверг',
  5: 'Пятница',
};

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

function render(req, res, title, active, body) {
  return res.send(layout({
    title,
    user: req.user,
    active,
    body,
    flash: getFlash(req.query),
  }));
}

function toId(value) {
  const id = Number.parseInt(value, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function redirectWith(res, path, msg) {
  res.redirect(`${path}${path.includes('?') ? '&' : '?'}msg=${encodeURIComponent(msg)}`);
}

function selectOptions(rows, selectedId, placeholder) {
  const options = rows.map((row) => {
    const selected = Number(selectedId) === Number(row.id) ? ' selected' : '';
    return `<option value="${Number(row.id)}"${selected}>${escapeHtml(row.name)}</option>`;
  });
  return `${placeholder ? `<option value="">${escapeHtml(placeholder)}</option>` : ''}${options.join('')}`;
}

function teacherOptions(teachers, selectedId) {
  return `<option value="">— не выбран —</option>${teachers.map((teacher) => {
    const selected = Number(selectedId) === Number(teacher.id) ? ' selected' : '';
    return `<option value="${Number(teacher.id)}"${selected}>${escapeHtml(teacher.full_name)}</option>`;
  }).join('')}`;
}

/* ─────────────────────────── Сводка ─────────────────────────── */

router.get('/', (req, res) => {
  const counts = {
    students: db.prepare('SELECT COUNT(*) AS c FROM students').get().c,
    classes: db.prepare('SELECT COUNT(*) AS c FROM classes').get().c,
    teachers: db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'teacher'").get().c,
    requests: db.prepare("SELECT COUNT(*) AS c FROM parent_requests WHERE status = 'pending'").get().c,
  };

  const today = todayMoscow();
  const yesterday = addDays(today, -1);
  const unfilled = db.prepare(`
    SELECT l.id, l.date, l.lesson_no, l.filled_at, l.fill_status,
           c.name AS class_name, s.name AS subject_name, u.full_name AS teacher_name
    FROM lessons l
    JOIN classes c ON c.id = l.class_id
    JOIN subjects s ON s.id = l.subject_id
    JOIN users u ON u.id = l.teacher_id
    WHERE l.date IN (?, ?) AND l.filled_at IS NULL
    ORDER BY l.date DESC, l.lesson_no
  `).all(today, yesterday);

  const classStats = db.prepare(`
    SELECT c.id, c.name,
           SUM(g.value * g.weight) AS weight_sum,
           SUM(g.weight) AS weight_total,
           COUNT(g.id) AS grade_count
    FROM classes c
    LEFT JOIN students st ON st.class_id = c.id
    LEFT JOIN grades g ON g.student_id = st.id
    GROUP BY c.id
    ORDER BY c.name
  `).all();

  const statCards = `
    <div class="stat-grid">
      <div class="stat"><span class="stat-label">Учеников</span><strong class="stat-value">${counts.students}</strong><span class="stat-note">в ${counts.classes} классах</span></div>
      <div class="stat"><span class="stat-label">Классов</span><strong class="stat-value">${counts.classes}</strong><span class="stat-note">5А · 6Б · 7В</span></div>
      <div class="stat"><span class="stat-label">Учителей</span><strong class="stat-value">${counts.teachers}</strong><span class="stat-note">активные аккаунты</span></div>
      <div class="stat stat--accent"><span class="stat-label">Заявки родителей</span><strong class="stat-value">${counts.requests}</strong><span class="stat-note">на модерации</span></div>
    </div>`;

  const unfilledBlock = unfilled.length ? `
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th>Дата</th><th>Урок</th><th>Класс</th><th>Предмет</th><th>Учитель</th><th>Статус</th></tr></thead>
        <tbody>
          ${unfilled.map((lesson) => `
            <tr>
              <td>${escapeHtml(formatShortDate(lesson.date))}</td>
              <td>${Number(lesson.lesson_no)}</td>
              <td>${escapeHtml(lesson.class_name)}</td>
              <td>${escapeHtml(lesson.subject_name)}</td>
              <td>${escapeHtml(lesson.teacher_name)}</td>
              <td>${statusBadge(lessonFillState(lesson))}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>` : emptyState('Незаполненных уроков за сегодня и вчера нет');

  const averages = classStats.length ? `
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th>Класс</th><th>Средний балл</th><th>Оценок в базе</th></tr></thead>
        <tbody>
          ${classStats.map((row) => {
            const avg = row.weight_total ? row.weight_sum / row.weight_total : null;
            return `<tr>
              <td><strong>${escapeHtml(row.name)}</strong></td>
              <td>${avg === null ? '—' : `<span class="average">${escapeHtml(satisfactoryLabel(avg))}</span>`}</td>
              <td>${Number(row.grade_count)}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>` : emptyState('Оценок пока нет');

  const body = `
    ${pageHead('Сводка школы', `Сегодня ${formatShortDate(today)} · Москва`, `
      <a class="btn btn-primary" href="/admin/schedule">Расписание</a>
    `)}
    ${statCards}
    <div class="grid grid--2">
      <section class="card">
        <div class="card-head">
          <h2>Незаполненные уроки</h2>
          <span class="card-hint">сегодня и вчера</span>
        </div>
        ${unfilledBlock}
      </section>
      <section class="card">
        <div class="card-head">
          <h2>Средний балл по классам</h2>
          <span class="card-hint">взвешенный</span>
        </div>
        ${averages}
      </section>
    </div>
    <section class="card card--soft">
      <div class="card-head"><h2>Что дальше</h2></div>
      <p class="muted">Модерация заявок родителей и отчёт «Заполнение журнала» с CSV — следующий этап. В этап 1 входят справочники, расписание и журнал учителя.</p>
      <div class="quick-links">
        <a href="/admin/classes">Классы</a>
        <a href="/admin/students">Ученики</a>
        <a href="/admin/teachers">Учителя</a>
        <a href="/admin/subjects">Предметы</a>
      </div>
    </section>`;
  return render(req, res, 'Сводка', '/admin', body);
});

/* ─────────────────────────── Классы ─────────────────────────── */

router.get('/classes', (req, res) => {
  const editId = toId(req.query.edit);
  const teachers = db.prepare("SELECT id, full_name FROM users WHERE role = 'teacher' ORDER BY full_name").all();
  const classes = db.prepare(`
    SELECT c.*, u.full_name AS teacher_name,
           (SELECT COUNT(*) FROM students st WHERE st.class_id = c.id) AS student_count
    FROM classes c
    LEFT JOIN users u ON u.id = c.class_teacher_id
    ORDER BY c.name
  `).all();
  const editing = editId ? classes.find((item) => item.id === editId) : null;

  const rows = classes.length ? `
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th>Класс</th><th>Классный руководитель</th><th>Учеников</th><th></th></tr></thead>
        <tbody>
          ${classes.map((item) => `
            <tr>
              <td><strong>${escapeHtml(item.name)}</strong></td>
              <td>${item.teacher_name ? escapeHtml(item.teacher_name) : '<span class="muted">не назначен</span>'}</td>
              <td>${Number(item.student_count)}</td>
              <td class="row-actions">
                <a class="btn btn-ghost btn-sm" href="/admin/classes?edit=${Number(item.id)}">Изменить</a>
                <form method="post" action="/admin/classes/${Number(item.id)}/delete" data-confirm="Удалить класс ${escapeHtml(item.name)}? Вместе с ним удалятся ученики и расписание.">
                  <button type="submit" class="btn btn-danger btn-sm">Удалить</button>
                </form>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>` : emptyState('Классов пока нет', 'Добавьте первый класс в форме справа.');

  const form = `
    <form method="post" action="/admin/classes/save" class="form">
      ${editing ? `<input type="hidden" name="id" value="${Number(editing.id)}">` : ''}
      <label class="field">
        <span class="field-label">Название класса</span>
        <input type="text" name="name" value="${escapeHtml(editing ? editing.name : '')}" placeholder="Например, 5А" required maxlength="20">
      </label>
      <label class="field">
        <span class="field-label">Классный руководитель</span>
        <select name="class_teacher_id">${teacherOptions(teachers, editing ? editing.class_teacher_id : null)}</select>
      </label>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">${editing ? 'Сохранить' : 'Добавить класс'}</button>
        ${editing ? '<a class="btn btn-ghost" href="/admin/classes">Отмена</a>' : ''}
      </div>
    </form>`;

  return render(req, res, 'Классы', '/admin/classes', `
    ${pageHead('Классы', 'Справочник классов и классных руководителей')}
    <div class="split">
      <section class="card">${rows}</section>
      <aside class="card">
        <div class="card-head"><h2>${editing ? 'Изменить класс' : 'Новый класс'}</h2></div>
        ${form}
      </aside>
    </div>`);
});

router.post('/classes/save', (req, res) => {
  const id = toId(req.body.id);
  const name = String(req.body.name || '').trim();
  const teacherId = toId(req.body.class_teacher_id);

  if (!name) return redirectWith(res, '/admin/classes', 'invalid');
  if (teacherId && !db.prepare("SELECT 1 FROM users WHERE id = ? AND role = 'teacher'").get(teacherId)) {
    return redirectWith(res, '/admin/classes', 'invalid');
  }

  try {
    if (id) {
      db.prepare('UPDATE classes SET name = ?, class_teacher_id = ? WHERE id = ?').run(name, teacherId, id);
    } else {
      db.prepare('INSERT INTO classes (name, class_teacher_id) VALUES (?, ?)').run(name, teacherId);
    }
  } catch (error) {
    return redirectWith(res, '/admin/classes', error.code === 'SQLITE_CONSTRAINT_UNIQUE' ? 'duplicate' : 'invalid');
  }

  return redirectWith(res, '/admin/classes', id ? 'updated' : 'created');
});

router.post('/classes/:id/delete', (req, res) => {
  const id = toId(req.params.id);
  if (id) db.prepare('DELETE FROM classes WHERE id = ?').run(id);
  return redirectWith(res, '/admin/classes', 'deleted');
});

/* ─────────────────────────── Ученики ────────────────────────── */

router.get('/students', (req, res) => {
  const editId = toId(req.query.edit);
  const filterClassId = toId(req.query.class_id);
  const classes = db.prepare('SELECT id, name FROM classes ORDER BY name').all();
  const parents = db.prepare("SELECT id, full_name, email FROM users WHERE role = 'parent' ORDER BY full_name").all();

  const students = db.prepare(`
    SELECT st.*, c.name AS class_name,
           (SELECT GROUP_CONCAT(u.full_name, ', ')
            FROM parent_students ps JOIN users u ON u.id = ps.parent_id
            WHERE ps.student_id = st.id) AS parent_names
    FROM students st
    JOIN classes c ON c.id = st.class_id
    ${filterClassId ? 'WHERE st.class_id = ?' : ''}
    ORDER BY c.name, st.full_name
  `).all(...(filterClassId ? [filterClassId] : []));

  const editing = editId ? db.prepare('SELECT * FROM students WHERE id = ?').get(editId) : null;
  const linkedParents = editing
    ? db.prepare('SELECT parent_id FROM parent_students WHERE student_id = ?').all(editing.id).map((row) => row.parent_id)
    : [];

  const rows = students.length ? `
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th>ФИО</th><th>Класс</th><th>Родители</th><th></th></tr></thead>
        <tbody>
          ${students.map((student) => `
            <tr>
              <td><strong>${escapeHtml(student.full_name)}</strong></td>
              <td><span class="tag">${escapeHtml(student.class_name)}</span></td>
              <td>${student.parent_names ? escapeHtml(student.parent_names) : '<span class="muted">не привязаны</span>'}</td>
              <td class="row-actions">
                <a class="btn btn-ghost btn-sm" href="/admin/students?edit=${Number(student.id)}${filterClassId ? `&class_id=${Number(filterClassId)}` : ''}">Изменить</a>
                <form method="post" action="/admin/students/${Number(student.id)}/delete" data-confirm="Удалить ученика ${escapeHtml(student.full_name)}?">
                  <button type="submit" class="btn btn-danger btn-sm">Удалить</button>
                </form>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>` : emptyState('Учеников не найдено', 'Добавьте ученика или измените фильтр.');

  const classFilter = `
    <form method="get" action="/admin/students" class="inline-form">
      <label class="field field--inline">
        <span class="field-label">Класс</span>
        <select name="class_id" onchange="this.form.submit()">
          <option value="">Все классы</option>
          ${classes.map((item) => `<option value="${Number(item.id)}"${filterClassId === item.id ? ' selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}
        </select>
      </label>
      <noscript><button class="btn btn-secondary btn-sm" type="submit">Показать</button></noscript>
    </form>`;

  const form = `
    <form method="post" action="/admin/students/save" class="form">
      ${editing ? `<input type="hidden" name="id" value="${Number(editing.id)}">` : ''}
      <label class="field">
        <span class="field-label">ФИО ученика</span>
        <input type="text" name="full_name" value="${escapeHtml(editing ? editing.full_name : '')}" placeholder="Иванов Иван Иванович" required maxlength="120">
      </label>
      <label class="field">
        <span class="field-label">Класс</span>
        <select name="class_id" required>
          <option value="">— выберите класс —</option>
          ${selectOptions(classes, editing ? editing.class_id : filterClassId)}
        </select>
      </label>
      <fieldset class="field">
        <legend class="field-label">Родители</legend>
        ${parents.length ? `<div class="check-list">${parents.map((parent) => `
          <label class="check">
            <input type="checkbox" name="parent_ids" value="${Number(parent.id)}"${linkedParents.includes(parent.id) ? ' checked' : ''}>
            <span>${escapeHtml(parent.full_name)}<small>${escapeHtml(parent.email)}</small></span>
          </label>`).join('')}</div>` : '<p class="muted">Родителей пока нет.</p>'}
      </fieldset>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">${editing ? 'Сохранить' : 'Добавить ученика'}</button>
        ${editing ? '<a class="btn btn-ghost" href="/admin/students">Отмена</a>' : ''}
      </div>
    </form>`;

  return render(req, res, 'Ученики', '/admin/students', `
    ${pageHead('Ученики', 'ФИО, класс и привязка родителей', classFilter)}
    <div class="split">
      <section class="card">${rows}</section>
      <aside class="card">
        <div class="card-head"><h2>${editing ? 'Изменить ученика' : 'Новый ученик'}</h2></div>
        ${form}
      </aside>
    </div>`);
});

router.post('/students/save', (req, res) => {
  const id = toId(req.body.id);
  const fullName = String(req.body.full_name || '').trim();
  const classId = toId(req.body.class_id);
  const rawParentIds = req.body.parent_ids === undefined
    ? []
    : Array.isArray(req.body.parent_ids) ? req.body.parent_ids : [req.body.parent_ids];

  if (!fullName || !classId || !db.prepare('SELECT 1 FROM classes WHERE id = ?').get(classId)) {
    return redirectWith(res, '/admin/students', 'invalid');
  }

  const parentIds = rawParentIds
    .map(toId)
    .filter((parentId) => parentId && db.prepare("SELECT 1 FROM users WHERE id = ? AND role = 'parent'").get(parentId));

  const save = db.transaction(() => {
    let studentId = id;
    if (id) {
      db.prepare('UPDATE students SET full_name = ?, class_id = ? WHERE id = ?').run(fullName, classId, id);
    } else {
      studentId = Number(db.prepare('INSERT INTO students (full_name, class_id) VALUES (?, ?)')
        .run(fullName, classId).lastInsertRowid);
    }
    db.prepare('DELETE FROM parent_students WHERE student_id = ?').run(studentId);
    for (const parentId of parentIds) {
      db.prepare('INSERT OR IGNORE INTO parent_students (parent_id, student_id) VALUES (?, ?)').run(parentId, studentId);
    }
  });

  save();
  return redirectWith(res, '/admin/students', id ? 'updated' : 'created');
});

router.post('/students/:id/delete', (req, res) => {
  const id = toId(req.params.id);
  if (id) db.prepare('DELETE FROM students WHERE id = ?').run(id);
  return redirectWith(res, '/admin/students', 'deleted');
});

/* ─────────────────────────── Учителя ────────────────────────── */

router.get('/teachers', (req, res) => {
  const editId = toId(req.query.edit);
  const teachers = db.prepare(`
    SELECT u.id, u.full_name, u.email,
           (SELECT GROUP_CONCAT(s.name, ', ')
            FROM teacher_subjects ts JOIN subjects s ON s.id = ts.subject_id
            WHERE ts.teacher_id = u.id) AS subject_names,
           (SELECT GROUP_CONCAT(c.name, ', ')
            FROM classes c WHERE c.class_teacher_id = u.id) AS class_names,
           (SELECT COUNT(*) FROM lessons l WHERE l.teacher_id = u.id) AS lesson_count
    FROM users u
    WHERE u.role = 'teacher'
    ORDER BY u.full_name
  `).all();
  const subjects = db.prepare('SELECT id, name FROM subjects ORDER BY name').all();
  const editing = editId
    ? db.prepare("SELECT id, full_name, email FROM users WHERE id = ? AND role = 'teacher'").get(editId)
    : null;
  const linkedSubjects = editing
    ? db.prepare('SELECT subject_id FROM teacher_subjects WHERE teacher_id = ?').all(editing.id).map((row) => row.subject_id)
    : [];

  const rows = teachers.length ? `
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th>Учитель</th><th>Предметы</th><th>Классный руководитель</th><th>Уроков</th><th></th></tr></thead>
        <tbody>
          ${teachers.map((teacher) => `
            <tr>
              <td><strong>${escapeHtml(teacher.full_name)}</strong><div class="cell-note">${escapeHtml(teacher.email)}</div></td>
              <td>${teacher.subject_names ? escapeHtml(teacher.subject_names) : '<span class="muted">не назначены</span>'}</td>
              <td>${teacher.class_names ? escapeHtml(teacher.class_names) : '<span class="muted">—</span>'}</td>
              <td>${Number(teacher.lesson_count)}</td>
              <td class="row-actions">
                <a class="btn btn-ghost btn-sm" href="/admin/teachers?edit=${Number(teacher.id)}">Изменить</a>
                <form method="post" action="/admin/teachers/${Number(teacher.id)}/delete" data-confirm="Удалить учителя ${escapeHtml(teacher.full_name)}?">
                  <button type="submit" class="btn btn-danger btn-sm">Удалить</button>
                </form>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>` : emptyState('Учителей пока нет', 'Добавьте первого учителя в форме справа.');

  const form = `
    <form method="post" action="/admin/teachers/save" class="form">
      ${editing ? `<input type="hidden" name="id" value="${Number(editing.id)}">` : ''}
      <label class="field">
        <span class="field-label">ФИО</span>
        <input type="text" name="full_name" value="${escapeHtml(editing ? editing.full_name : '')}" placeholder="Сидорова Мария Петровна" required maxlength="120">
      </label>
      <label class="field">
        <span class="field-label">E-mail для входа</span>
        <input type="email" name="email" value="${escapeHtml(editing ? editing.email : '')}" required maxlength="160" autocomplete="off">
      </label>
      <label class="field">
        <span class="field-label">${editing ? 'Новый пароль (необязательно)' : 'Пароль'}</span>
        <input type="password" name="password" ${editing ? '' : 'required'} minlength="6" autocomplete="new-password" placeholder="${editing ? 'Оставьте пустым, чтобы не менять' : 'Минимум 6 символов'}">
      </label>
      <fieldset class="field">
        <legend class="field-label">Предметы</legend>
        ${subjects.length ? `<div class="check-list">${subjects.map((subject) => `
          <label class="check">
            <input type="checkbox" name="subject_ids" value="${Number(subject.id)}"${linkedSubjects.includes(subject.id) ? ' checked' : ''}>
            <span>${escapeHtml(subject.name)}</span>
          </label>`).join('')}</div>` : '<p class="muted">Сначала добавьте предметы.</p>'}
      </fieldset>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">${editing ? 'Сохранить' : 'Добавить учителя'}</button>
        ${editing ? '<a class="btn btn-ghost" href="/admin/teachers">Отмена</a>' : ''}
      </div>
    </form>`;

  return render(req, res, 'Учителя', '/admin/teachers', `
    ${pageHead('Учителя', 'Аккаунты учителей и преподаваемые предметы')}
    <div class="split">
      <section class="card">${rows}</section>
      <aside class="card">
        <div class="card-head"><h2>${editing ? 'Изменить учителя' : 'Новый учитель'}</h2></div>
        ${form}
      </aside>
    </div>`);
});

router.post('/teachers/save', (req, res) => {
  const id = toId(req.body.id);
  const fullName = String(req.body.full_name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const rawSubjectIds = req.body.subject_ids === undefined
    ? []
    : Array.isArray(req.body.subject_ids) ? req.body.subject_ids : [req.body.subject_ids];
  const subjectIds = rawSubjectIds
    .map(toId)
    .filter((subjectId) => subjectId && db.prepare('SELECT 1 FROM subjects WHERE id = ?').get(subjectId));

  if (!fullName || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || (!id && password.length < 6)) {
    return redirectWith(res, '/admin/teachers', 'invalid');
  }

  if (id && !db.prepare("SELECT 1 FROM users WHERE id = ? AND role = 'teacher'").get(id)) {
    return redirectWith(res, '/admin/teachers', 'not-found');
  }

  const { hashPassword } = require('../auth');

  try {
    const save = db.transaction(() => {
      let teacherId = id;
      if (id) {
        if (password.length >= 6) {
          db.prepare('UPDATE users SET full_name = ?, email = ?, password_hash = ? WHERE id = ?')
            .run(fullName, email, hashPassword(password), id);
        } else {
          db.prepare('UPDATE users SET full_name = ?, email = ? WHERE id = ?').run(fullName, email, id);
        }
      } else {
        teacherId = Number(db.prepare(
          "INSERT INTO users (email, password_hash, role, full_name) VALUES (?, ?, 'teacher', ?)"
        ).run(email, hashPassword(password), fullName).lastInsertRowid);
      }
      db.prepare('DELETE FROM teacher_subjects WHERE teacher_id = ?').run(teacherId);
      for (const subjectId of subjectIds) {
        db.prepare('INSERT OR IGNORE INTO teacher_subjects (teacher_id, subject_id) VALUES (?, ?)')
          .run(teacherId, subjectId);
      }
    });
    save();
  } catch (error) {
    return redirectWith(res, '/admin/teachers', error.code === 'SQLITE_CONSTRAINT_UNIQUE' ? 'email-taken' : 'invalid');
  }

  return redirectWith(res, '/admin/teachers', id ? 'updated' : 'created');
});

router.post('/teachers/:id/delete', (req, res) => {
  const id = toId(req.params.id);
  if (!id) return redirectWith(res, '/admin/teachers', 'not-found');

  const used = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM lessons WHERE teacher_id = ?) +
      (SELECT COUNT(*) FROM schedule WHERE teacher_id = ?) +
      (SELECT COUNT(*) FROM classes WHERE class_teacher_id = ?) AS total
  `).get(id, id, id).total;

  if (used > 0) return redirectWith(res, '/admin/teachers', 'in-use');
  db.prepare("DELETE FROM users WHERE id = ? AND role = 'teacher'").run(id);
  return redirectWith(res, '/admin/teachers', 'deleted');
});

/* ─────────────────────────── Предметы ───────────────────────── */

router.get('/subjects', (req, res) => {
  const editId = toId(req.query.edit);
  const subjects = db.prepare(`
    SELECT s.*,
           (SELECT GROUP_CONCAT(u.full_name, ', ')
            FROM teacher_subjects ts JOIN users u ON u.id = ts.teacher_id
            WHERE ts.subject_id = s.id) AS teacher_names,
           (SELECT COUNT(*) FROM lessons l WHERE l.subject_id = s.id) AS lesson_count
    FROM subjects s
    ORDER BY s.name
  `).all();
  const editing = editId ? db.prepare('SELECT * FROM subjects WHERE id = ?').get(editId) : null;

  const rows = subjects.length ? `
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th>Предмет</th><th>Учителя</th><th>Уроков</th><th></th></tr></thead>
        <tbody>
          ${subjects.map((subject) => `
            <tr>
              <td><strong>${escapeHtml(subject.name)}</strong></td>
              <td>${subject.teacher_names ? escapeHtml(subject.teacher_names) : '<span class="muted">не назначены</span>'}</td>
              <td>${Number(subject.lesson_count)}</td>
              <td class="row-actions">
                <a class="btn btn-ghost btn-sm" href="/admin/subjects?edit=${Number(subject.id)}">Изменить</a>
                <form method="post" action="/admin/subjects/${Number(subject.id)}/delete" data-confirm="Удалить предмет ${escapeHtml(subject.name)}?">
                  <button type="submit" class="btn btn-danger btn-sm">Удалить</button>
                </form>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>` : emptyState('Предметов пока нет', 'Добавьте первый предмет в форме справа.');

  const form = `
    <form method="post" action="/admin/subjects/save" class="form">
      ${editing ? `<input type="hidden" name="id" value="${Number(editing.id)}">` : ''}
      <label class="field">
        <span class="field-label">Название предмета</span>
        <input type="text" name="name" value="${escapeHtml(editing ? editing.name : '')}" placeholder="Например, География" required maxlength="80">
      </label>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">${editing ? 'Сохранить' : 'Добавить предмет'}</button>
        ${editing ? '<a class="btn btn-ghost" href="/admin/subjects">Отмена</a>' : ''}
      </div>
    </form>`;

  return render(req, res, 'Предметы', '/admin/subjects', `
    ${pageHead('Предметы', 'Учебные предметы школы')}
    <div class="split">
      <section class="card">${rows}</section>
      <aside class="card">
        <div class="card-head"><h2>${editing ? 'Изменить предмет' : 'Новый предмет'}</h2></div>
        ${form}
      </aside>
    </div>`);
});

router.post('/subjects/save', (req, res) => {
  const id = toId(req.body.id);
  const name = String(req.body.name || '').trim();
  if (!name) return redirectWith(res, '/admin/subjects', 'invalid');

  try {
    if (id) {
      db.prepare('UPDATE subjects SET name = ? WHERE id = ?').run(name, id);
    } else {
      db.prepare('INSERT INTO subjects (name) VALUES (?)').run(name);
    }
  } catch (error) {
    return redirectWith(res, '/admin/subjects', error.code === 'SQLITE_CONSTRAINT_UNIQUE' ? 'duplicate' : 'invalid');
  }

  return redirectWith(res, '/admin/subjects', id ? 'updated' : 'created');
});

router.post('/subjects/:id/delete', (req, res) => {
  const id = toId(req.params.id);
  if (!id) return redirectWith(res, '/admin/subjects', 'not-found');
  const used = db.prepare(`
    SELECT (SELECT COUNT(*) FROM lessons WHERE subject_id = ?) +
           (SELECT COUNT(*) FROM schedule WHERE subject_id = ?) +
           (SELECT COUNT(*) FROM teacher_subjects WHERE subject_id = ?) AS total
  `).get(id, id, id).total;
  if (used > 0) return redirectWith(res, '/admin/subjects', 'in-use');
  db.prepare('DELETE FROM subjects WHERE id = ?').run(id);
  return redirectWith(res, '/admin/subjects', 'deleted');
});

/* ─────────────────────────── Расписание ─────────────────────── */

router.get('/schedule', (req, res) => {
  const classes = db.prepare('SELECT id, name FROM classes ORDER BY name').all();
  if (!classes.length) {
    return render(req, res, 'Расписание', '/admin/schedule', `
      ${pageHead('Расписание', 'Неделя по классу')}
      ${emptyState('Сначала добавьте классы', 'Расписание строится по классам.')}`);
  }

  const requestedClassId = toId(req.query.class_id);
  const classId = classes.some((item) => item.id === requestedClassId) ? requestedClassId : classes[0].id;
  const weekStart = mondayOf(isValidDateString(req.query.week_start) ? req.query.week_start : todayMoscow());
  const subjects = db.prepare('SELECT id, name FROM subjects ORDER BY name').all();
  const teachers = db.prepare("SELECT id, full_name FROM users WHERE role = 'teacher' ORDER BY full_name").all();
  const entries = db.prepare(`
    SELECT sc.*, sub.name AS subject_name, u.full_name AS teacher_name
    FROM schedule sc
    JOIN subjects sub ON sub.id = sc.subject_id
    JOIN users u ON u.id = sc.teacher_id
    WHERE sc.class_id = ? AND sc.week_start = ?
    ORDER BY sc.day_of_week, sc.lesson_no
  `).all(classId, weekStart);

  const bySlot = new Map();
  for (const entry of entries) bySlot.set(`${entry.day_of_week}:${entry.lesson_no}`, entry);

  const editId = toId(req.query.edit);
  const editing = editId ? entries.find((entry) => entry.id === editId) : null;
  const initialDay = editing ? editing.day_of_week : Math.min(5, Math.max(1, toId(req.query.day) || 1));
  const initialLesson = editing ? editing.lesson_no : Math.min(8, Math.max(1, toId(req.query.lesson) || 1));
  const initialTimes = LESSON_TIMES[initialLesson] || ['09:00', '09:45'];

  const classOptions = classes.map((item) => `<option value="${Number(item.id)}"${item.id === classId ? ' selected' : ''}>${escapeHtml(item.name)}</option>`).join('');
  const weekEnd = addDays(weekStart, 6);
  const prevWeek = addDays(weekStart, -7);
  const nextWeek = addDays(weekStart, 7);

  const gridRows = [];
  for (let lessonNo = 1; lessonNo <= 6; lessonNo += 1) {
    const cells = [1, 2, 3, 4, 5].map((day) => {
      const entry = bySlot.get(`${day}:${lessonNo}`);
      if (!entry) {
        return `<td class="schedule-empty">
          <a class="schedule-add" href="/admin/schedule?class_id=${Number(classId)}&week_start=${encodeURIComponent(weekStart)}&day=${day}&lesson=${lessonNo}" aria-label="Добавить урок в ${escapeHtml(DAY_NAMES[day])}, урок ${lessonNo}">+</a>
        </td>`;
      }
      return `<td>
        <a class="schedule-item" href="/admin/schedule?class_id=${Number(classId)}&week_start=${encodeURIComponent(weekStart)}&edit=${Number(entry.id)}">
          <strong>${escapeHtml(entry.subject_name)}</strong>
          <span>${escapeHtml(entry.teacher_name)}</span>
          <small>${entry.room ? `${escapeHtml(entry.room)} · ` : ''}${escapeHtml(entry.time_start || '')}${entry.time_end ? `–${escapeHtml(entry.time_end)}` : ''}</small>
        </a>
      </td>`;
    }).join('');
    gridRows.push(`<tr><th scope="row"><span class="lesson-number">${lessonNo}</span><small>${escapeHtml((LESSON_TIMES[lessonNo] || [''])[0])}</small></th>${cells}</tr>`);
  }

  const weekNav = `
    <div class="week-nav">
      <a class="btn btn-ghost btn-sm" href="/admin/schedule?class_id=${Number(classId)}&week_start=${encodeURIComponent(prevWeek)}">←</a>
      <div class="week-label"><strong>${escapeHtml(formatWeekRange(weekStart))}</strong><span>${weekStart === mondayOf(todayMoscow()) ? 'текущая неделя' : `${escapeHtml(formatShortDate(weekStart))} — ${escapeHtml(formatShortDate(weekEnd))}`}</span></div>
      <a class="btn btn-ghost btn-sm" href="/admin/schedule?class_id=${Number(classId)}&week_start=${encodeURIComponent(nextWeek)}">→</a>
    </div>`;

  const form = `
    <form method="post" action="/admin/schedule/save" class="form">
      ${editing ? `<input type="hidden" name="id" value="${Number(editing.id)}">` : ''}
      <input type="hidden" name="class_id" value="${Number(classId)}">
      <input type="hidden" name="week_start" value="${escapeHtml(weekStart)}">
      <div class="form-grid">
        <label class="field">
          <span class="field-label">День</span>
          <select name="day_of_week" required>${[1, 2, 3, 4, 5].map((day) => `<option value="${day}"${initialDay === day ? ' selected' : ''}>${escapeHtml(DAY_NAMES[day])}</option>`).join('')}</select>
        </label>
        <label class="field">
          <span class="field-label">Урок №</span>
          <select name="lesson_no" required>${[1, 2, 3, 4, 5, 6, 7, 8].map((no) => `<option value="${no}"${initialLesson === no ? ' selected' : ''}>${no}</option>`).join('')}</select>
        </label>
        <label class="field">
          <span class="field-label">Предмет</span>
          <select name="subject_id" required><option value="">— выберите —</option>${selectOptions(subjects, editing ? editing.subject_id : null)}</select>
        </label>
        <label class="field">
          <span class="field-label">Учитель</span>
          <select name="teacher_id" required>${teacherOptions(teachers, editing ? editing.teacher_id : null)}</select>
        </label>
        <label class="field">
          <span class="field-label">Кабинет</span>
          <input type="text" name="room" value="${escapeHtml(editing ? editing.room : '')}" maxlength="20" placeholder="201">
        </label>
        <label class="field">
          <span class="field-label">Начало</span>
          <input type="time" name="time_start" value="${escapeHtml(editing ? editing.time_start : initialTimes[0])}">
        </label>
        <label class="field">
          <span class="field-label">Конец</span>
          <input type="time" name="time_end" value="${escapeHtml(editing ? editing.time_end : initialTimes[1])}">
        </label>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">${editing ? 'Сохранить урок' : 'Добавить урок'}</button>
        ${editing ? `<a class="btn btn-ghost" href="/admin/schedule?class_id=${Number(classId)}&week_start=${encodeURIComponent(weekStart)}">Отмена</a>` : ''}
      </div>
    </form>
    ${editing ? `<form method="post" action="/admin/schedule/${Number(editing.id)}/delete" class="form form--danger" data-confirm="Удалить этот урок из расписания?">
      <input type="hidden" name="class_id" value="${Number(classId)}">
      <input type="hidden" name="week_start" value="${escapeHtml(weekStart)}">
      <button type="submit" class="btn btn-danger btn-sm">Удалить урок</button>
    </form>` : ''}`;

  return render(req, res, 'Расписание', '/admin/schedule', `
    ${pageHead('Расписание', 'Неделя по классу', `
      <form method="get" action="/admin/schedule" class="inline-form">
        <input type="hidden" name="week_start" value="${escapeHtml(weekStart)}">
        <select name="class_id" onchange="this.form.submit()">${classOptions}</select>
        <noscript><button class="btn btn-secondary btn-sm" type="submit">Показать</button></noscript>
      </form>
      <form method="post" action="/admin/schedule/copy">
        <input type="hidden" name="class_id" value="${Number(classId)}">
        <input type="hidden" name="week_start" value="${escapeHtml(weekStart)}">
        <button type="submit" class="btn btn-secondary" data-confirm="Скопировать эту неделю на следующую? Совпадающие уроки будут заменены.">Скопировать на следующую</button>
      </form>
    `)}
    <section class="card">
      <div class="card-toolbar">${weekNav}</div>
      <div class="table-wrap">
        <table class="schedule-table">
          <thead><tr><th></th>${[1, 2, 3, 4, 5].map((day) => `<th>${escapeHtml(DAY_NAMES[day])}<small>${escapeHtml(formatShortDate(addDays(weekStart, day - 1)))}</small></th>`).join('')}</tr></thead>
          <tbody>${gridRows.join('')}</tbody>
        </table>
      </div>
    </section>
    <div class="split">
      <section class="card card--soft">
        <div class="card-head"><h2>Как это работает</h2></div>
        <p class="muted">Расписание задаётся отдельно для каждой недели. Кнопка «Скопировать на следующую» переносит все уроки текущей недели на ту же сетку следующей. Учитель видит уроки в «Моём дне» по датам.</p>
        <p class="muted">Нажмите «+» в пустой ячейке или урок, чтобы изменить его.</p>
      </section>
      <aside class="card">
        <div class="card-head"><h2>${editing ? 'Изменить урок' : 'Добавить урок'}</h2></div>
        ${form}
      </aside>
    </div>`);
});

router.post('/schedule/save', (req, res) => {
  const id = toId(req.body.id);
  const classId = toId(req.body.class_id);
  const day = toId(req.body.day_of_week);
  const lessonNo = toId(req.body.lesson_no);
  const subjectId = toId(req.body.subject_id);
  const teacherId = toId(req.body.teacher_id);
  const weekStart = mondayOf(isValidDateString(req.body.week_start) ? req.body.week_start : todayMoscow());
  const room = String(req.body.room || '').trim() || null;
  const timeStart = String(req.body.time_start || '').trim() || null;
  const timeEnd = String(req.body.time_end || '').trim() || null;
  const back = `/admin/schedule?class_id=${classId || ''}&week_start=${encodeURIComponent(weekStart)}`;

  if (!classId || !day || day > 5 || !lessonNo || lessonNo > 8 || !subjectId || !teacherId) {
    return redirectWith(res, back, 'invalid');
  }
  if (!db.prepare('SELECT 1 FROM classes WHERE id = ?').get(classId)
    || !db.prepare('SELECT 1 FROM subjects WHERE id = ?').get(subjectId)
    || !db.prepare("SELECT 1 FROM users WHERE id = ? AND role = 'teacher'").get(teacherId)) {
    return redirectWith(res, back, 'invalid');
  }

  try {
    if (id) {
      db.prepare(`
        UPDATE schedule
        SET class_id = ?, day_of_week = ?, lesson_no = ?, subject_id = ?, teacher_id = ?,
            room = ?, time_start = ?, time_end = ?
        WHERE id = ? AND week_start = ?
      `).run(classId, day, lessonNo, subjectId, teacherId, room, timeStart, timeEnd, id, weekStart);
    } else {
      db.prepare(`
        INSERT INTO schedule
          (week_start, class_id, day_of_week, lesson_no, subject_id, teacher_id, room, time_start, time_end)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(weekStart, classId, day, lessonNo, subjectId, teacherId, room, timeStart, timeEnd);
    }
  } catch (error) {
    return redirectWith(res, back, error.code === 'SQLITE_CONSTRAINT_UNIQUE' ? 'duplicate' : 'invalid');
  }

  return redirectWith(res, back, id ? 'updated' : 'created');
});

router.post('/schedule/:id/delete', (req, res) => {
  const id = toId(req.params.id);
  const classId = toId(req.body.class_id);
  const weekStart = isValidDateString(req.body.week_start) ? req.body.week_start : todayMoscow();
  if (id) db.prepare('DELETE FROM schedule WHERE id = ?').run(id);
  return redirectWith(res, `/admin/schedule?class_id=${classId || ''}&week_start=${encodeURIComponent(weekStart)}`, 'deleted');
});

router.post('/schedule/copy', (req, res) => {
  const classId = toId(req.body.class_id);
  const weekStart = mondayOf(isValidDateString(req.body.week_start) ? req.body.week_start : todayMoscow());
  const nextWeek = addDays(weekStart, 7);
  const back = `/admin/schedule?class_id=${classId || ''}&week_start=${encodeURIComponent(nextWeek)}`;

  if (!classId) return redirectWith(res, '/admin/schedule', 'invalid');

  const entries = db.prepare('SELECT * FROM schedule WHERE class_id = ? AND week_start = ?').all(classId, weekStart);
  if (!entries.length) return redirectWith(res, back, 'empty-week');

  const copy = db.transaction(() => {
    for (const entry of entries) {
      db.prepare(`
        INSERT INTO schedule
          (week_start, class_id, day_of_week, lesson_no, subject_id, teacher_id, room, time_start, time_end)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (week_start, class_id, day_of_week, lesson_no) DO UPDATE SET
          subject_id = excluded.subject_id,
          teacher_id = excluded.teacher_id,
          room = excluded.room,
          time_start = excluded.time_start,
          time_end = excluded.time_end
      `).run(
        nextWeek,
        entry.class_id,
        entry.day_of_week,
        entry.lesson_no,
        entry.subject_id,
        entry.teacher_id,
        entry.room,
        entry.time_start,
        entry.time_end
      );
    }
  });
  copy();

  return redirectWith(res, back, 'copied');
});

module.exports = router;
