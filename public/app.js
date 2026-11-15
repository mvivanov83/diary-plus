'use strict';

/* Демо-доступы на странице входа */
document.querySelectorAll('[data-demo-email]').forEach((button) => {
  button.addEventListener('click', () => {
    const form = document.querySelector('.auth-form');
    if (!form) return;
    const email = form.querySelector('input[name="email"]');
    const password = form.querySelector('input[name="password"]');
    if (email) email.value = button.getAttribute('data-demo-email') || '';
    if (password) password.value = button.getAttribute('data-demo-password') || '';
    if (email) email.focus();
  });
});

/* Таймер до 18:00 МСК */
function formatRemaining(milliseconds) {
  const totalMinutes = Math.ceil(milliseconds / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) return `${hours} ч ${minutes} мин`;
  if (hours > 0) return `${hours} ч`;
  return `${Math.max(0, minutes)} мин`;
}

document.querySelectorAll('[data-deadline]').forEach((card) => {
  const deadline = new Date(card.getAttribute('data-deadline'));
  const value = card.querySelector('[data-timer]');
  if (!value || Number.isNaN(deadline.getTime())) return;

  function tick() {
    const remaining = deadline.getTime() - Date.now();
    if (remaining <= 0) {
      value.textContent = 'Дедлайн 18:00 прошёл';
      card.classList.add('timer-card--over');
      return;
    }
    value.textContent = formatRemaining(remaining);
  }

  tick();
  window.setInterval(tick, 30000);
});

/* Отметить всех присутствующими */
document.querySelectorAll('[data-mark-all]').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('input[type="radio"][name^="att_"][value="present"]').forEach((input) => {
      input.checked = true;
      input.closest('.att-option')?.classList.add('is-checked');
    });
    document.querySelectorAll('.att-option').forEach((label) => {
      const input = label.querySelector('input');
      label.classList.toggle('is-checked', Boolean(input && input.checked));
    });
  });
});

/* Подсветка выбранной посещаемости */
document.querySelectorAll('.att-option input').forEach((input) => {
  const sync = () => {
    const group = input.closest('.attendance-options');
    if (group) {
      group.querySelectorAll('.att-option').forEach((label) => {
        const radio = label.querySelector('input');
        label.classList.toggle('is-checked', Boolean(radio && radio.checked));
      });
    }
  };
  input.addEventListener('change', sync);
  sync();
});

/* Подсказка о весе оценок */
const typeSelect = document.querySelector('[data-lesson-type]');
const weightHint = document.querySelector('[data-weight-hint]');
if (typeSelect && weightHint) {
  const syncWeight = () => {
    weightHint.textContent = `Вес оценок: ${typeSelect.value === 'test' ? 2 : 1}`;
  };
  typeSelect.addEventListener('change', syncWeight);
  syncWeight();
}

/* Подтверждение опасных действий */
document.querySelectorAll('form[data-confirm]').forEach((form) => {
  form.addEventListener('submit', (event) => {
    const message = form.getAttribute('data-confirm') || 'Вы уверены?';
    if (!window.confirm(message)) event.preventDefault();
  });
});
