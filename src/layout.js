'use strict';

const { escapeHtml } = require('./util');
const { roleLabel, initials, flashBlock } = require('./ui');

const NAV = {
  admin: [
    { href: '/admin', label: 'Сводка' },
    { href: '/admin/classes', label: 'Классы' },
    { href: '/admin/students', label: 'Ученики' },
    { href: '/admin/teachers', label: 'Учителя' },
    { href: '/admin/subjects', label: 'Предметы' },
    { href: '/admin/schedule', label: 'Расписание' },
    { href: '/admin/requests', label: 'Заявки' },
    { href: '/admin/reports/journal', label: 'Отчёт' },
  ],
  teacher: [
    { href: '/teacher', label: 'Мой день' },
    { href: '/teacher/journal', label: 'Журнал класса' },
    { href: '/teacher/students', label: 'Ученики' },
  ],
  parent: [
    { href: '/parent', label: 'Мои дети' },
    { href: '/parent/performance', label: 'Успеваемость' },
    { href: '/parent/tokens', label: 'Токены' },
    { href: '/parent/notifications', label: 'Уведомления', badge: true },
  ],
};

function navHtml(role, active, unread = 0) {
  const items = NAV[role] || [];
  return items.map((item) => {
    const roots = ['/admin', '/teacher', '/parent'];
    const isActive = item.href === active
      || (!roots.includes(item.href) && active.startsWith(`${item.href}/`))
      || (item.href === '/parent' && active.startsWith('/parent/children/'));
    const badge = item.badge && unread > 0
      ? `<span class="nav-badge" aria-label="Непрочитанных: ${Number(unread)}">${Number(unread)}</span>`
      : '';
    return `<a class="nav-link${isActive ? ' is-active' : ''}" href="${escapeHtml(item.href)}"${
      isActive ? ' aria-current="page"' : ''
    }>${escapeHtml(item.label)}${badge}</a>`;
  }).join('');
}

function layout({ title, user, active = '', body, flash = null, unread = 0 }) {
  if (!user) throw new Error('layout() requires a user');
  const safeTitle = escapeHtml(title);
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${safeTitle} · Дневник+</title>
  <link rel="stylesheet" href="/styles.css">
  <script src="/app.js" defer></script>
</head>
<body>
  <a class="skip-link" href="#content">К содержимому</a>
  <header class="topbar">
    <div class="container topbar-inner">
      <a class="brand" href="/" aria-label="Дневник+ — на главную">Дневник<span class="brand-plus">+</span></a>
      <div class="topbar-right">
        <div class="user-chip">
          <span class="user-avatar" aria-hidden="true">${initials(user.full_name)}</span>
          <span class="user-meta">
            <span class="user-name">${escapeHtml(user.full_name)}</span>
            <span class="user-role">${escapeHtml(roleLabel(user.role))}</span>
          </span>
        </div>
        <form method="post" action="/logout" class="logout-form">
          <button type="submit" class="btn btn-ghost btn-sm">Выйти</button>
        </form>
      </div>
    </div>
  </header>
  <nav class="mainnav" aria-label="Основная навигация">
    <div class="container nav-scroll">
      ${navHtml(user.role, active, unread)}
    </div>
  </nav>
  <main class="container page" id="content">
    ${flashBlock(flash)}
    ${body}
  </main>
  <footer class="footer">
    <div class="container footer-inner">
      <span>Дневник+ · частная школа</span>
      <span>MVP · этап 2</span>
    </div>
  </footer>
</body>
</html>`;
}

function authPage({ title, body, error = '' }) {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${escapeHtml(title)} · Дневник+</title>
  <link rel="stylesheet" href="/styles.css">
  <script src="/app.js" defer></script>
</head>
<body class="auth-body">
  <main class="auth-shell">
    <section class="auth-hero">
      <div class="auth-brand">Дневник<span>+</span></div>
      <p class="auth-kicker">Электронный дневник частной школы</p>
      <h1>Спокойный порядок<br>в школьных делах</h1>
      <p class="auth-lead">Расписание, журнал, домашние задания и оценки — в одном месте. Для администратора, учителя и родителя.</p>
      <ul class="auth-features">
        <li><span>01</span> Журнал с крупными ячейками для планшета</li>
        <li><span>02</span> Правило 18:00 и статусы заполнения</li>
        <li><span>03</span> Родитель видит только своих детей</li>
      </ul>
    </section>
    <section class="auth-card">
      <div class="auth-card-head">
        <h2>Вход в дневник</h2>
        <p>Используйте школьный e-mail и пароль.</p>
      </div>
      ${error ? `<div class="flash flash--error" role="alert">${escapeHtml(error)}</div>` : ''}
      <form method="post" action="/login" class="form auth-form">
        <label class="field">
          <span class="field-label">E-mail</span>
          <input type="email" name="email" autocomplete="username" inputmode="email" required autofocus>
        </label>
        <label class="field">
          <span class="field-label">Пароль</span>
          <input type="password" name="password" autocomplete="current-password" required>
        </label>
        <button type="submit" class="btn btn-primary btn-block">Войти</button>
      </form>
      <div class="demo-logins">
        <div class="demo-title">Демо-доступы</div>
        <button type="button" class="demo-login" data-demo-email="admin@diary.app" data-demo-password="admin123">
          <span><strong>Администратор</strong><small>admin@diary.app</small></span><code>admin123</code>
        </button>
        <button type="button" class="demo-login" data-demo-email="teacher1@diary.app" data-demo-password="teacher123">
          <span><strong>Учитель</strong><small>teacher1@diary.app</small></span><code>teacher123</code>
        </button>
        <button type="button" class="demo-login" data-demo-email="parent1@diary.app" data-demo-password="parent123">
          <span><strong>Родитель</strong><small>parent1@diary.app</small></span><code>parent123</code>
        </button>
      </div>
      <p class="auth-note">Закрытый сервис. Регистрация родителей — по заявке с одобрением администратора.</p>
      <p class="auth-switch">Нет аккаунта? <a href="/register">Зарегистрироваться как родитель</a></p>
    </section>
  </main>
</body>
</html>`;
}

function registerPage({ title, classes = [], error = '', values = {} }) {
  const value = (key) => escapeHtml(values[key] || '');
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${escapeHtml(title)} · Дневник+</title>
  <link rel="stylesheet" href="/styles.css">
  <script src="/app.js" defer></script>
</head>
<body class="auth-body">
  <main class="auth-shell">
    <section class="auth-hero">
      <div class="auth-brand">Дневник<span>+</span></div>
      <p class="auth-kicker">Электронный дневник частной школы</p>
      <h1>Заявка на доступ<br>для родителя</h1>
      <p class="auth-lead">Заполните данные и дождитесь проверки администратором школы. После одобрения вы увидите дневник своего ребёнка.</p>
      <ul class="auth-features">
        <li><span>01</span> Заявка проверяется администратором</li>
        <li><span>02</span> Ребёнок привязывается к вашему аккаунту</li>
        <li><span>03</span> До одобрения доступ только к статусу заявки</li>
      </ul>
    </section>
    <section class="auth-card">
      <div class="auth-card-head">
        <h2>Регистрация родителя</h2>
        <p>Все поля обязательны. Используйте настоящие ФИО и школьный класс.</p>
      </div>
      ${error ? `<div class="flash flash--error" role="alert">${escapeHtml(error)}</div>` : ''}
      <form method="post" action="/register" class="form auth-form">
        <label class="field">
          <span class="field-label">Ваше ФИО</span>
          <input type="text" name="full_name" value="${value('full_name')}" autocomplete="name" required maxlength="120" placeholder="Орлова Елена Викторовна">
        </label>
        <label class="field">
          <span class="field-label">E-mail</span>
          <input type="email" name="email" value="${value('email')}" autocomplete="username" inputmode="email" required maxlength="160">
        </label>
        <label class="field">
          <span class="field-label">Пароль</span>
          <input type="password" name="password" autocomplete="new-password" minlength="6" required placeholder="Минимум 6 символов">
        </label>
        <label class="field">
          <span class="field-label">ФИО ребёнка</span>
          <input type="text" name="child_name" value="${value('child_name')}" required maxlength="120" placeholder="Орлов Максим Андреевич">
        </label>
        <label class="field">
          <span class="field-label">Класс ребёнка</span>
          <select name="child_class" required>
            <option value="">— выберите класс —</option>
            ${classes.map((item) => `<option value="${escapeHtml(item.name)}"${values.child_class === item.name ? ' selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}
          </select>
        </label>
        <button type="submit" class="btn btn-primary btn-block">Отправить заявку</button>
      </form>
      <p class="auth-note">Письмо-подтверждение в MVP выводится в лог сервера. Администратор одобрит заявку и привяжет ребёнка к аккаунту.</p>
      <p class="auth-switch">Уже есть аккаунт? <a href="/login">Войти</a></p>
    </section>
  </main>
</body>
</html>`;
}

function sendError(res, status, title, message, user) {
  const body = `
    <section class="error-page">
      <div class="error-code">${escapeHtml(status)}</div>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(message)}</p>
      <a class="btn btn-primary" href="${user ? escapeHtml(user.role === 'admin' ? '/admin' : user.role === 'teacher' ? '/teacher' : '/parent') : '/login'}">На главную</a>
    </section>`;

  if (user) {
    return res.status(status).send(layout({
      title,
      user,
      active: '',
      body,
    }));
  }

  return res.status(status).send(`<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · Дневник+</title><link rel="stylesheet" href="/styles.css"></head>
<body class="auth-body"><main class="standalone-error">${body}</main></body></html>`);
}

module.exports = {
  layout,
  authPage,
  registerPage,
  sendError,
  NAV,
};
