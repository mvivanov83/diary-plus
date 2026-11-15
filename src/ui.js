'use strict';

const {
  escapeHtml,
  fillLabel,
  attendanceShort,
  attendanceLabel,
} = require('./util');

const ROLE_LABELS = {
  admin: 'Администратор',
  teacher: 'Учитель',
  parent: 'Родитель',
};

const FLASH_MESSAGES = {
  created: ['Запись добавлена.', 'success'],
  updated: ['Изменения сохранены.', 'success'],
  deleted: ['Запись удалена.', 'success'],
  copied: ['Неделя скопирована на следующую.', 'success'],
  'empty-week': ['В этой неделе нет уроков для копирования.', 'warning'],
  saved: ['Урок сохранён.', 'success'],
  'saved-draft': ['Сохранено. Урок ещё не считается заполненным: нужны тема и посещаемость.', 'warning'],
  'file-removed': ['Файл домашнего задания удалён.', 'success'],
  invalid: ['Проверьте заполнение полей.', 'error'],
  duplicate: ['Такая запись уже существует.', 'error'],
  'email-taken': ['Этот e-mail уже используется.', 'error'],
  'in-use': ['Запись используется в расписании или журнале и не может быть удалена.', 'error'],
  'not-found': ['Запись не найдена.', 'error'],
  'wrong-file': ['Можно загрузить PDF, DOC, DOCX, TXT, PNG, JPG или ZIP до 10 МБ.', 'error'],
  'request-created': ['Заявка отправлена администратору.', 'success'],
};

function roleLabel(role) {
  return ROLE_LABELS[role] || '';
}

function initials(fullName) {
  const parts = String(fullName || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0][0] || '';
  const second = parts.length > 1 ? parts[1][0] : '';
  return escapeHtml((first + second).toUpperCase());
}

function getFlash(query) {
  const code = query && query.msg;
  if (!code || !FLASH_MESSAGES[code]) return null;
  const [text, type] = FLASH_MESSAGES[code];
  return { text, type };
}

function flashBlock(flash) {
  if (!flash) return '';
  return `<div class="flash flash--${escapeHtml(flash.type)}" role="status">${escapeHtml(flash.text)}</div>`;
}

function statusBadge(state) {
  const safe = ['on_time', 'late', 'missing', 'pending'].includes(state) ? state : 'pending';
  return `<span class="status status--${safe}">${escapeHtml(fillLabel(safe))}</span>`;
}

function gradeChips(grades) {
  if (!grades || !grades.length) return '<span class="muted">—</span>';
  return `<span class="grades">${grades.map((grade) => {
    const value = Number(grade.value);
    const weight = Number(grade.weight);
    const safeValue = value >= 2 && value <= 5 ? value : 3;
    return `<span class="grade grade--${safeValue}" title="${weight === 2 ? 'Вес 2' : 'Вес 1'}">${safeValue}${
      weight === 2 ? '<span class="grade-weight">×2</span>' : ''
    }</span>`;
  }).join('')}</span>`;
}

function attendanceBadge(status) {
  if (!status) return '';
  const safe = ['present', 'absent', 'late', 'excused'].includes(status) ? status : 'present';
  return `<span class="attendance attendance--${safe}" title="${escapeHtml(attendanceLabel(safe))}">${escapeHtml(
    attendanceShort(safe)
  )}</span>`;
}

function pageHead(title, subtitle, actions = '') {
  return `
    <div class="page-head">
      <div>
        <h1 class="page-title">${escapeHtml(title)}</h1>
        ${subtitle ? `<p class="page-subtitle">${escapeHtml(subtitle)}</p>` : ''}
      </div>
      ${actions ? `<div class="page-actions">${actions}</div>` : ''}
    </div>`;
}

function emptyState(title, text = '') {
  return `
    <div class="empty">
      <div class="empty-mark">+</div>
      <h3>${escapeHtml(title)}</h3>
      ${text ? `<p>${escapeHtml(text)}</p>` : ''}
    </div>`;
}

function percent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return `${Math.round(Number(value))}%`;
}

module.exports = {
  roleLabel,
  initials,
  getFlash,
  flashBlock,
  statusBadge,
  gradeChips,
  attendanceBadge,
  pageHead,
  emptyState,
  percent,
  ROLE_LABELS,
};
