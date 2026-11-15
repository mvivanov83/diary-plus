'use strict';

/* ──────────────────────────────────────────────────────────────
   Единая точка экранирования пользовательского текста в HTML.
   Любая динамическая строка выводится только через escapeHtml().
   ────────────────────────────────────────────────────────────── */
const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

/* Москва — фиксированный UTC+3 (переходов на летнее время нет с 2014 года).
   Все даты уроков хранятся как YYYY-MM-DD, время заполнения — ISO UTC. */
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;

function moscowDate(date = new Date()) {
  return new Date(date.getTime() + MSK_OFFSET_MS).toISOString().slice(0, 10);
}

function moscowTime(date = new Date()) {
  const shifted = new Date(date.getTime() + MSK_OFFSET_MS);
  return { hour: shifted.getUTCHours(), minute: shifted.getUTCMinutes() };
}

function moscowDeadline(dateStr) {
  // 18:00 Europe/Moscow = 15:00 UTC этого дня
  return new Date(`${dateStr}T15:00:00.000Z`);
}

function parseDate(dateStr) {
  return new Date(`${dateStr}T12:00:00.000Z`);
}

function toDateString(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(dateStr, days) {
  const date = parseDate(dateStr);
  date.setUTCDate(date.getUTCDate() + days);
  return toDateString(date);
}

function mondayOf(dateStr) {
  const date = parseDate(dateStr);
  const day = date.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  date.setUTCDate(date.getUTCDate() - diff);
  return toDateString(date);
}

function weekDays(weekStart) {
  return [1, 2, 3, 4, 5].map((day) => ({
    day,
    date: addDays(weekStart, day - 1),
  }));
}

function formatDate(dateStr, options = {}) {
  if (!dateStr) return '';
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    ...options,
  }).format(parseDate(dateStr));
}

function formatShortDate(dateStr) {
  return formatDate(dateStr, { day: '2-digit', month: '2-digit' });
}

function formatWeekRange(weekStart) {
  const end = addDays(weekStart, 6);
  const startDate = parseDate(weekStart);
  const endDate = parseDate(end);
  const sameMonth = startDate.getUTCMonth() === endDate.getUTCMonth();
  const start = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'UTC',
    day: 'numeric',
    ...(sameMonth ? {} : { month: 'short' }),
  }).format(startDate);
  const endFormatted = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(endDate);
  return `${start} — ${endFormatted}`;
}

function formatDateTimeMoscow(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function todayMoscow() {
  return moscowDate();
}

function yesterdayMoscow() {
  return addDays(moscowDate(), -1);
}

const FILL_LABELS = {
  on_time: 'Вовремя',
  late: 'С опозданием',
  missing: 'Незаполнен',
  pending: 'Ожидает',
};

/* Статус заполнения урока.
   filled_at + fill_status хранятся в БД; «Незаполнен» вычисляется,
   когда дедлайн 18:00 МСК уже прошёл, а урок так и не заполнен. */
function lessonFillState(lesson, now = new Date()) {
  if (lesson.filled_at) {
    if (lesson.fill_status === 'late') return 'late';
    if (lesson.fill_status === 'on_time') return 'on_time';
    return new Date(lesson.filled_at) <= moscowDeadline(lesson.date) ? 'on_time' : 'late';
  }
  return now.getTime() > moscowDeadline(lesson.date).getTime() ? 'missing' : 'pending';
}

function fillLabel(state) {
  return FILL_LABELS[state] || FILL_LABELS.pending;
}

const LESSON_TYPE_LABELS = {
  regular: 'Обычный',
  test: 'Контрольная',
  independent: 'Самостоятельная',
};

function lessonTypeLabel(type) {
  return LESSON_TYPE_LABELS[type] || LESSON_TYPE_LABELS.regular;
}

function lessonWeight(type) {
  return type === 'test' ? 2 : 1;
}

const ATTENDANCE_LABELS = {
  present: 'Присутствовал',
  absent: 'Отсутствовал',
  late: 'Опоздал',
  excused: 'Уважительная',
};

const ATTENDANCE_SHORT = {
  present: 'Н',
  absent: 'О',
  late: 'ОП',
  excused: 'У',
};

function attendanceLabel(status) {
  return ATTENDANCE_LABELS[status] || '';
}

function attendanceShort(status) {
  return ATTENDANCE_SHORT[status] || '';
}

function satisfactoryLabel(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return Number(value).toFixed(1).replace('.', ',');
}

function parseGradeList(raw) {
  if (!raw || !String(raw).trim()) return [];
  const parts = String(raw).trim().split(/[\s,;]+/).filter(Boolean);
  if (parts.length > 5) {
    throw new Error('За один урок можно поставить не более 5 оценок.');
  }
  return parts.map((part) => {
    if (!/^[2-5]$/.test(part)) {
      throw new Error('Оценки могут быть только 2, 3, 4 или 5.');
    }
    return Number(part);
  });
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function isValidDateString(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function trimOrNull(value) {
  const trimmed = String(value === undefined || value === null ? '' : value).trim();
  return trimmed || null;
}

module.exports = {
  escapeHtml,
  moscowDate,
  moscowTime,
  moscowDeadline,
  todayMoscow,
  yesterdayMoscow,
  parseDate,
  toDateString,
  addDays,
  mondayOf,
  weekDays,
  formatDate,
  formatShortDate,
  formatWeekRange,
  formatDateTimeMoscow,
  lessonFillState,
  fillLabel,
  FILL_LABELS,
  lessonTypeLabel,
  lessonWeight,
  LESSON_TYPE_LABELS,
  attendanceLabel,
  attendanceShort,
  ATTENDANCE_LABELS,
  satisfactoryLabel,
  parseGradeList,
  isValidEmail,
  isValidDateString,
  clamp,
  trimOrNull,
};
