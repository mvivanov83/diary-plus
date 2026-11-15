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
  formatDateTimeMoscow,
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
router.use((req, res, next) => {
  if (req.user.status === 'rejected') {
    return sendError(res, 403, 'Заявка отклонена', 'Обратитесь к администратору школы, чтобы восстановить доступ.', req.user);
  }
  if (req.user.status === 'pending') {
    return req.path === '/pending' ? next() : res.redirect('/parent/pending');
  }
  if (req.path === '/pending') return res.redirect('/parent');
  return next();
});

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
    unread: res.locals.unread || 0,
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

function getChild(parentId, childId) {
  if (!childId) return null;
  return db.prepare(`
    SELECT st.id, st.full_name, st.class_id, c.name AS class_name
    FROM parent_students ps
    JOIN students st ON st.id = ps.student_id
    JOIN classes c ON c.id = st.class_id
    WHERE ps.parent_id = ? AND st.id = ?
  `).get(parentId, childId) || null;
}

function resolveChild(req) {
  const children = getChildren(req.user.id);
  if (!children.length) return { child: null, children };
  const requested = toId(req.query.child);
  const child = children.find((item) => item.id === requested) || children[0];
  return { child, children };
}

function childTabs(children, activeId, basePath) {
  if (children.length < 2) return '';
  return `<div class="child-tabs">${children.map((item) => `
    <a class="child-tab${item.id === activeId ? ' is-active' : ''}" href="${basePath}?child=${Number(item.id)}">
      ${escapeHtml(item.full_name)} <small>${escapeHtml(item.class_name)}</small>
    </a>`).join('')}</div>`;
}

router.get('/pending', (req, res) => {
  const request = db.prepare(`
    SELECT child_name, child_class, created_at, status
    FROM parent_requests
    WHERE user_id = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(req.user.id);

  const body = `
    <div class="pending-screen">
      <span class="pending-icon" aria-hidden="true">⏳</span>
      <div class="eyebrow">Заявка на модерации</div>
      <h1 class="page-title">Доступ появится после одобрения</h1>
      <p class="pending-lead">Администратор школы проверит заявку и привяжет ребёнка к вашему аккаунту. После этого откроются дневник, оценки, токены и уведомления.</p>
      <dl class="pending-facts">
        <div><dt>Родитель</dt><dd>${escapeHtml(req.user.full_name)}</dd></div>
        <div><dt>E-mail</dt><dd>${escapeHtml(req.user.email)}</dd></div>
        ${request ? `<div><dt>Ребёнок</dt><dd>${escapeHtml(request.child_name)} · ${escapeHtml(request.child_class)}</dd></div>` : ''}
        <div><dt>Статус</dt><dd><span class="badge badge--warning">На рассмотрении</span></dd></div>
      </dl>
      <p class="page-note">Письмо-подтверждение в MVP записывается в лог сервера. Обновите страницу после одобрения.</p>
      <form method="post" action="/logout" class="inline-form"><button class="btn btn-ghost" type="submit">Выйти</button></form>
    </div>`;
  return render(req, res, 'Заявка на рассмотрении', '', body);
});

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

/* ─────────────────────── Успеваемость ───────────────────────── */

function weeklyChart(weekAverages) {
  const width = 720;
  const height = 240;
  const left = 46;
  const right = 706;
  const top = 28;
  const bottom = 190;
  const count = weekAverages.length;
  const step = count > 1 ? (right - left) / (count - 1) : 0;
  const yFor = (value) => top + ((5 - value) / 3) * (bottom - top);

  const grid = [5, 4, 3, 2].map((value) => {
    const y = yFor(value);
    return `<line x1="${left}" y1="${y.toFixed(1)}" x2="${right}" y2="${y.toFixed(1)}" class="chart-grid"/>
      <text x="${left - 10}" y="${(y + 4).toFixed(1)}" class="chart-label" text-anchor="end">${value}</text>`;
  }).join('');

  const points = weekAverages.map((week, index) => ({
    ...week,
    x: left + step * index,
    y: week.average === null ? null : yFor(week.average),
  }));

  const segments = [];
  let current = [];
  for (const point of points) {
    if (point.y === null) {
      if (current.length) segments.push(current);
      current = [];
    } else {
      current.push(point);
    }
  }
  if (current.length) segments.push(current);

  const lines = segments.map((segment) => segment.length > 1
    ? `<polyline class="chart-line" points="${segment.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')}"/>`
    : '').join('');

  const dots = points.filter((point) => point.y !== null).map((point) => `
    <circle class="chart-dot" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="4.5">
      <title>${escapeHtml(point.label)}: средний ${escapeHtml(satisfactoryLabel(point.average))}</title>
    </circle>
    <text x="${point.x.toFixed(1)}" y="${(point.y - 10).toFixed(1)}" class="chart-value" text-anchor="middle">${escapeHtml(satisfactoryLabel(point.average))}</text>`).join('');

  const xLabels = points.map((point) => `<text x="${point.x.toFixed(1)}" y="${height - 18}" class="chart-label" text-anchor="middle">${escapeHtml(formatShortDate(point.week))}</text>`).join('');

  return `<svg class="performance-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="График среднего балла по неделям">
    <title>Динамика среднего балла по неделям</title>
    ${grid}
    ${lines}
    ${dots}
    ${xLabels}
  </svg>`;
}

router.get('/performance', (req, res) => {
  const { child, children } = resolveChild(req);
  if (!child) return render(req, res, 'Успеваемость', '/parent/performance', emptyState('Дети пока не привязаны', 'Администратор школы должен привязать ребёнка к аккаунту.'));

  const today = todayMoscow();
  const currentMonday = mondayOf(today);
  const weeks = 8;
  const chartStart = addDays(currentMonday, -(weeks - 1) * 7);

  const subjectRows = db.prepare(`
    SELECT sub.id, sub.name,
           SUM(g.value * g.weight) AS weight_sum,
           SUM(g.weight) AS weight_total,
           COUNT(*) AS grade_count
    FROM grades g
    JOIN lessons l ON l.id = g.lesson_id
    JOIN subjects sub ON sub.id = l.subject_id
    WHERE g.student_id = ?
    GROUP BY sub.id
    ORDER BY sub.name
  `).all(child.id);

  const attendanceRows = db.prepare(`
    SELECT sub.id, sub.name, COUNT(*) AS total,
           SUM(CASE WHEN a.status IN ('absent', 'excused') THEN 1 ELSE 0 END) AS missed
    FROM attendance a
    JOIN lessons l ON l.id = a.lesson_id
    JOIN subjects sub ON sub.id = l.subject_id
    WHERE a.student_id = ?
    GROUP BY sub.id
  `).all(child.id);
  const attendanceBySubject = new Map(attendanceRows.map((row) => [row.id, row]));

  const gradeRows = db.prepare(`
    SELECT l.date, g.value, g.weight
    FROM grades g
    JOIN lessons l ON l.id = g.lesson_id
    WHERE g.student_id = ? AND l.date BETWEEN ? AND ?
    ORDER BY l.date, g.id
  `).all(child.id, chartStart, today);

  const weekly = new Map();
  for (let index = 0; index < weeks; index += 1) {
    const week = addDays(chartStart, index * 7);
    weekly.set(week, { week, weight_sum: 0, weight_total: 0 });
  }
  for (const row of gradeRows) {
    const bucket = weekly.get(mondayOf(row.date));
    if (!bucket) continue;
    bucket.weight_sum += row.value * row.weight;
    bucket.weight_total += row.weight;
  }
  const weekAverages = [...weekly.values()].map((bucket) => ({
    week: bucket.week,
    label: `Неделя ${formatShortDate(bucket.week)}`,
    average: bucket.weight_total ? bucket.weight_sum / bucket.weight_total : null,
  }));

  const stats = childStats(child.id);
  const attendanceTotal = attendanceRows.reduce((sum, row) => sum + row.total, 0);
  const attendanceMissed = attendanceRows.reduce((sum, row) => sum + row.missed, 0);

  const subjectTable = subjectRows.length ? `
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th>Предмет</th><th>Оценок</th><th>Средний (взвешенный)</th><th>Итог</th><th>Пропуски</th></tr></thead>
        <tbody>
          ${subjectRows.map((row) => {
            const average = row.weight_total ? row.weight_sum / row.weight_total : null;
            const final = average === null ? null : Math.round(average);
            const attendance = attendanceBySubject.get(row.id);
            const missed = attendance && attendance.total ? (attendance.missed / attendance.total) * 100 : null;
            return `<tr>
              <td><strong>${escapeHtml(row.name)}</strong></td>
              <td>${Number(row.grade_count)}</td>
              <td title="Сумма(оценка × вес) / сумма весов; контрольная — вес 2">${average === null ? '—' : escapeHtml(satisfactoryLabel(average))}</td>
              <td>${final === null ? '—' : `<span class="grade grade--${Math.min(5, Math.max(2, final))}">${final}</span>`}</td>
              <td>${missed === null ? '—' : escapeHtml(percent(missed))}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>` : emptyState('Оценок пока нет', 'Как только учитель выставит оценки, здесь появится успеваемость.');

  const body = `
    ${pageHead('Успеваемость', 'Средние по предметам, динамика по неделям и посещаемость')}
    ${childTabs(children, child.id, '/parent/performance')}
    <div class="child-context">
      <span class="child-avatar child-avatar--sm">${initials(child.full_name)}</span>
      <div><strong>${escapeHtml(child.full_name)}</strong><span>${escapeHtml(child.class_name)} класс</span></div>
    </div>
    <div class="stat-grid stat-grid--three">
      <div class="stat"><span class="stat-label">Средний балл</span><strong class="stat-value">${stats.average === null ? '—' : escapeHtml(satisfactoryLabel(stats.average))}</strong><span class="stat-note">за всё время, взвешенный</span></div>
      <div class="stat"><span class="stat-label">Посещаемость</span><strong class="stat-value">${attendanceTotal ? escapeHtml(percent(100 - (attendanceMissed / attendanceTotal) * 100)) : '—'}</strong><span class="stat-note">${attendanceTotal ? `пропущено ${attendanceMissed} из ${attendanceTotal}` : 'данных пока нет'}</span></div>
      <div class="stat"><span class="stat-label">Токены</span><strong class="stat-value ${stats.tokens < 0 ? 'text-danger' : ''}">${stats.tokens > 0 ? '+' : ''}${Number(stats.tokens)}</strong><span class="stat-note">баланс</span></div>
    </div>
    <section class="card">
      <div class="card-head"><h2>Динамика по неделям</h2><span class="card-hint">последние ${weeks} недель</span></div>
      ${weekAverages.some((week) => week.average !== null) ? `
        <div class="chart-wrap">${weeklyChart(weekAverages)}</div>
        <p class="field-hint">Каждая точка — средневзвешенный балл за неделю. Наведите на точку, чтобы увидеть значение.</p>` : emptyState('Недостаточно данных для графика', 'График появится после выставления оценок.')}
    </section>
    <section class="card">
      <div class="card-head"><h2>Средний по предметам</h2><span class="card-hint">за всё время</span></div>
      ${subjectTable}
    </section>`;
  return render(req, res, 'Успеваемость', '/parent/performance', body);
});

/* ─────────────────────── Токены ─────────────────────────────── */

router.get('/tokens', (req, res) => {
  const { child, children } = resolveChild(req);
  if (!child) return render(req, res, 'Токены', '/parent/tokens', emptyState('Дети пока не привязаны', 'Администратор школы должен привязать ребёнка к аккаунту.'));

  const rows = db.prepare(`
    SELECT t.id, t.amount, t.reason, t.created_at, u.full_name AS teacher_name
    FROM tokens t
    LEFT JOIN users u ON u.id = t.teacher_id
    WHERE t.student_id = ?
    ORDER BY t.created_at DESC, t.id DESC
  `).all(child.id);
  const balance = rows.reduce((sum, row) => sum + row.amount, 0);
  const earned = rows.filter((row) => row.amount > 0).reduce((sum, row) => sum + row.amount, 0);
  const spent = rows.filter((row) => row.amount < 0).reduce((sum, row) => sum + Math.abs(row.amount), 0);

  const body = `
    ${pageHead('Токены', 'Баланс и история начислений и списаний')}
    ${childTabs(children, child.id, '/parent/tokens')}
    <div class="child-context">
      <span class="child-avatar child-avatar--sm">${initials(child.full_name)}</span>
      <div><strong>${escapeHtml(child.full_name)}</strong><span>${escapeHtml(child.class_name)} класс</span></div>
    </div>
    <div class="stat-grid stat-grid--three">
      <div class="stat"><span class="stat-label">Баланс</span><strong class="stat-value ${balance < 0 ? 'text-danger' : ''}">${balance > 0 ? '+' : ''}${balance}</strong><span class="stat-note">токенов</span></div>
      <div class="stat"><span class="stat-label">Начислено</span><strong class="stat-value text-success">+${earned}</strong><span class="stat-note">за всё время</span></div>
      <div class="stat"><span class="stat-label">Списано</span><strong class="stat-value">−${spent}</strong><span class="stat-note">за всё время</span></div>
    </div>
    <section class="card">
      <div class="card-head"><h2>История</h2><span class="card-hint">${rows.length} операций</span></div>
      ${rows.length ? `
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Дата</th><th>Изменение</th><th>Причина</th><th>Учитель</th></tr></thead>
            <tbody>
              ${rows.map((row) => `<tr>
                <td>${escapeHtml(formatDateTimeMoscow(row.created_at))}</td>
                <td><strong class="${row.amount < 0 ? 'text-danger' : 'text-success'}">${row.amount > 0 ? '+' : ''}${Number(row.amount)}</strong></td>
                <td>${escapeHtml(row.reason)}</td>
                <td>${escapeHtml(row.teacher_name || '—')}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>` : emptyState('Токенов пока нет', 'Учитель может начислить токены за активность на уроке.')}
    </section>
    <p class="page-note">Токены — внутренняя мотивация школы. Баланс и история видны только вашей семье и учителям.</p>`;
  return render(req, res, 'Токены', '/parent/tokens', body);
});

/* ─────────────────────── Уведомления ───────────────────────── */

const NOTIFICATION_LABELS = {
  grade: 'Оценка',
  homework: 'Домашнее задание',
  schedule: 'Расписание',
  token: 'Токены',
  comment: 'Комментарий',
};

router.get('/notifications', (req, res) => {
  const rows = db.prepare(`
    SELECT n.id, n.kind, n.title, n.body, n.link, n.created_at, n.read_at, st.full_name AS student_name
    FROM notifications n
    LEFT JOIN students st ON st.id = n.student_id
    WHERE n.parent_id = ?
    ORDER BY n.created_at DESC, n.id DESC
    LIMIT 100
  `).all(req.user.id);
  const unread = rows.filter((row) => !row.read_at).length;

  const items = rows.map((row) => `
    <article class="notification${row.read_at ? '' : ' notification--unread'}">
      <div class="notification-kind notification-kind--${escapeHtml(row.kind)}">${escapeHtml(NOTIFICATION_LABELS[row.kind] || 'Событие')}</div>
      <div class="notification-body">
        <h3>${escapeHtml(row.title)}</h3>
        ${row.body ? `<p>${escapeHtml(row.body)}</p>` : ''}
        <span>${escapeHtml(row.student_name || '')}${row.student_name ? ' · ' : ''}${escapeHtml(formatDateTimeMoscow(row.created_at))}</span>
      </div>
      ${row.link ? `<a class="btn btn-ghost btn-sm" href="${escapeHtml(row.link)}">Открыть</a>` : ''}
    </article>`).join('');

  const body = `
    ${pageHead('Уведомления', 'Оценки, домашние задания, расписание и токены', unread > 0 ? `
      <form method="post" action="/parent/notifications/read" class="inline-form">
        <button class="btn btn-secondary btn-sm" type="submit">Отметить все прочитанными</button>
      </form>` : '')}
    ${unread > 0 ? `<p class="page-note"><strong>${unread}</strong> непрочитанных уведомлений.</p>` : ''}
    <div class="notification-list">
      ${items || emptyState('Уведомлений пока нет', 'Здесь появятся новые оценки, домашние задания и изменения расписания.')}
    </div>`;
  return render(req, res, 'Уведомления', '/parent/notifications', body);
});

router.post('/notifications/read', (req, res) => {
  db.prepare('UPDATE notifications SET read_at = ? WHERE parent_id = ? AND read_at IS NULL')
    .run(new Date().toISOString(), req.user.id);
  return res.redirect('/parent/notifications?msg=notifications-read');
});

module.exports = router;
