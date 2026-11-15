'use strict';

const bcrypt = require('bcryptjs');
const {
  moscowDeadline,
  todayMoscow,
  addDays,
  mondayOf,
  parseDate,
} = require('./util');

function seed(db) {
  const hash = {
    admin: bcrypt.hashSync('admin123', 10),
    teacher: bcrypt.hashSync('teacher123', 10),
    parent: bcrypt.hashSync('parent123', 10),
  };

  const insertUser = db.prepare(
    'INSERT INTO users (email, password_hash, role, full_name) VALUES (?, ?, ?, ?)'
  );
  const insertSubject = db.prepare('INSERT INTO subjects (name) VALUES (?)');
  const insertClass = db.prepare(
    'INSERT INTO classes (name, class_teacher_id) VALUES (?, ?)'
  );
  const insertStudent = db.prepare(
    'INSERT INTO students (full_name, class_id) VALUES (?, ?)'
  );
  const insertParentStudent = db.prepare(
    'INSERT INTO parent_students (parent_id, student_id) VALUES (?, ?)'
  );
  const insertTeacherSubject = db.prepare(
    'INSERT INTO teacher_subjects (teacher_id, subject_id) VALUES (?, ?)'
  );
  const insertSchedule = db.prepare(`
    INSERT INTO schedule
      (week_start, class_id, day_of_week, lesson_no, subject_id, teacher_id, room, time_start, time_end)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertLesson = db.prepare(`
    INSERT INTO lessons
      (schedule_id, class_id, subject_id, teacher_id, date, lesson_no, topic, lesson_type,
       homework_text, parent_comment, filled_at, fill_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertAttendance = db.prepare(
    'INSERT INTO attendance (lesson_id, student_id, status) VALUES (?, ?, ?)'
  );
  const insertGrade = db.prepare(
    'INSERT INTO grades (lesson_id, student_id, value, weight) VALUES (?, ?, ?, ?)'
  );
  const insertToken = db.prepare(
    'INSERT INTO tokens (student_id, teacher_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)'
  );
  const insertPendingUser = db.prepare(`
    INSERT INTO users (email, password_hash, role, full_name, status)
    VALUES (?, ?, 'parent', ?, 'pending')
  `);
  const insertNotification = db.prepare(`
    INSERT INTO notifications (parent_id, student_id, kind, title, body, link, created_at, read_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertNote = db.prepare(`
    INSERT INTO student_notes (student_id, teacher_id, body, created_at) VALUES (?, ?, ?, ?)
  `);

  const run = db.transaction(() => {
    /* ── Пользователи ─────────────────────────────────────────── */
    const adminId = insertUser.run('admin@diary.app', hash.admin, 'admin', 'Администратор школы').lastInsertRowid;

    const teacher1 = insertUser.run(
      'teacher1@diary.app', hash.teacher, 'teacher', 'Морозова Анна Сергеевна'
    ).lastInsertRowid;
    const teacher2 = insertUser.run(
      'teacher2@diary.app', hash.teacher, 'teacher', 'Смирнова Ирина Петровна'
    ).lastInsertRowid;
    const teacher3 = insertUser.run(
      'teacher3@diary.app', hash.teacher, 'teacher', 'Кузнецова Ольга Викторовна'
    ).lastInsertRowid;
    const teacher4 = insertUser.run(
      'teacher4@diary.app', hash.teacher, 'teacher', 'Волков Дмитрий Андреевич'
    ).lastInsertRowid;

    const parent1 = insertUser.run(
      'parent1@diary.app', hash.parent, 'parent', 'Орлова Елена Викторовна'
    ).lastInsertRowid;
    const parent2 = insertUser.run(
      'parent2@diary.app', hash.parent, 'parent', 'Соколов Игорь Николаевич'
    ).lastInsertRowid;
    const parent3 = insertUser.run(
      'parent3@diary.app', hash.parent, 'parent', 'Лебедева Мария Сергеевна'
    ).lastInsertRowid;
    const parent4 = insertUser.run(
      'parent4@diary.app', hash.parent, 'parent', 'Смирнова Татьяна Олеговна'
    ).lastInsertRowid;
    const pendingParent = insertPendingUser.run(
      'newparent@diary.app', hash.parent, 'Новикова Елена Андреевна'
    ).lastInsertRowid;

    /* ── Предметы ────────────────────────────────────────────── */
    const subjectNames = ['Математика', 'Русский язык', 'Литература', 'Английский язык', 'История'];
    const subjects = {};
    for (const name of subjectNames) {
      subjects[name] = Number(insertSubject.run(name).lastInsertRowid);
    }

    insertTeacherSubject.run(teacher1, subjects['Математика']);
    insertTeacherSubject.run(teacher2, subjects['Русский язык']);
    insertTeacherSubject.run(teacher2, subjects['Литература']);
    insertTeacherSubject.run(teacher3, subjects['Английский язык']);
    insertTeacherSubject.run(teacher4, subjects['История']);

    /* ── Классы и ученики ────────────────────────────────────── */
    const classNames = ['5А', '6Б', '7В'];
    const classes = {};
    const classTeacher = {
      '5А': teacher1,
      '6Б': teacher2,
      '7В': teacher3,
    };
    for (const name of classNames) {
      classes[name] = Number(insertClass.run(name, classTeacher[name]).lastInsertRowid);
    }

    const studentsByClass = {
      '5А': [
        'Орлов Максим Андреевич',
        'Белова Анна Дмитриевна',
        'Крылов Иван Сергеевич',
        'Соколова Дарья Павловна',
        'Морозов Артём Ильич',
        'Егорова Полина Максимовна',
        'Павлов Кирилл Романович',
        'Виноградова Мария Алексеевна',
        'Богданов Лев Денисович',
        'Фролова Варвара Евгеньевна',
      ],
      '6Б': [
        'Соколов Никита Игоревич',
        'Романова Алиса Владимировна',
        'Киселёв Егор Андреевич',
        'Титова Софья Михайловна',
        'Кузнецов Матвей Сергеевич',
        'Мельникова Виктория Олеговна',
        'Даниил Захаров Артёмович',
        'Захарова Ева Дмитриевна',
        'Гусев Роман Кириллович',
        'Баранова Ксения Павловна',
      ],
      '7В': [
        'Орлова София Андреевна',
        'Смирнов Александр Ильич',
        'Козлова Милана Сергеевна',
        'Новиков Владислав Егорович',
        'Волкова Арина Денисовна',
        'Лебедев Тимофей Максимович',
        'Соловьёва Елизавета Романовна',
        'Фомин Глеб Александрович',
        'Павлова Анастасия Ильинична',
        'Дмитриев Ярослав Олегович',
      ],
    };

    const students = {};
    for (const className of classNames) {
      students[className] = studentsByClass[className].map((fullName) =>
        Number(insertStudent.run(fullName, classes[className]).lastInsertRowid)
      );
    }

    /* parent1 — двое детей: 5А и 7В */
    insertParentStudent.run(parent1, students['5А'][0]);
    insertParentStudent.run(parent1, students['7В'][0]);
    insertParentStudent.run(parent2, students['6Б'][0]);
    insertParentStudent.run(parent3, students['5А'][1]);
    insertParentStudent.run(parent3, students['6Б'][1]);
    insertParentStudent.run(parent4, students['7В'][1]);

    /* ── Расписание: текущая неделя ± 4 ──────────────────────── */
    const today = todayMoscow();
    const currentMonday = mondayOf(today);
    const weekStarts = [];
    for (let offset = -4; offset <= 4; offset += 1) {
      weekStarts.push(addDays(currentMonday, offset * 7));
    }

    const teacherBySubject = {
      'Математика': Number(teacher1),
      'Русский язык': Number(teacher2),
      'Литература': Number(teacher2),
      'Английский язык': Number(teacher3),
      'История': Number(teacher4),
    };

    const weekPattern = [
      ['Математика', 'Русский язык', 'Английский язык', 'Литература', 'История', 'Математика'],
      ['Русский язык', 'Математика', 'История', 'Английский язык', 'Литература', 'Русский язык'],
      ['Английский язык', 'Литература', 'Математика', 'Русский язык', 'История', 'Английский язык'],
      ['Математика', 'История', 'Русский язык', 'Литература', 'Английский язык', 'Математика'],
      ['Литература', 'Английский язык', 'Математика', 'История', 'Русский язык', 'Русский язык'],
    ];

    const times = [
      ['09:00', '09:45'],
      ['09:55', '10:40'],
      ['11:00', '11:45'],
      ['12:00', '12:45'],
      ['13:00', '13:45'],
      ['14:00', '14:45'],
      ['15:00', '15:45'],
      ['16:00', '16:45'],
    ];

    const rooms = { '5А': '201', '6Б': '202', '7В': '203' };

    const scheduleByWeek = new Map();
    for (const weekStart of weekStarts) {
      for (const className of classNames) {
        const rows = [];
        for (let day = 1; day <= 5; day += 1) {
          const pattern = weekPattern[day - 1];
          for (let lessonNo = 1; lessonNo <= 6; lessonNo += 1) {
            const subjectName = pattern[lessonNo - 1];
            const scheduleId = Number(
              insertSchedule.run(
                weekStart,
                classes[className],
                day,
                lessonNo,
                subjects[subjectName],
                teacherBySubject[subjectName],
                rooms[className],
                times[lessonNo - 1][0],
                times[lessonNo - 1][1]
              ).lastInsertRowid
            );
            rows.push({
              id: scheduleId,
              classId: classes[className],
              className,
              day,
              lessonNo,
              subjectId: subjects[subjectName],
              subjectName,
              teacherId: teacherBySubject[subjectName],
              timeStart: times[lessonNo - 1][0],
              timeEnd: times[lessonNo - 1][1],
            });
          }
        }
        scheduleByWeek.set(`${weekStart}:${className}`, rows);
      }
    }

    /* ── Уроки, посещаемость, оценки за прошедшие дни ─────────── */
    const topics = {
      'Математика': ['Дроби: сложение и вычитание', 'Решение уравнений', 'Проценты в задачах', 'Геометрические фигуры', 'Текстовые задачи'],
      'Русский язык': ['Правописание приставок', 'Сложное предложение', 'Части речи', 'Орфограммы корня', 'Синтаксический разбор'],
      'Литература': ['Образ героя в рассказе', 'Анализ стихотворения', 'Литературные жанры', 'Автор и его эпоха'],
      'Английский язык': ['Present Perfect', 'My future profession', 'Past Simple', 'Reading practice', 'Shopping and money'],
      'История': ['Древний Египет', 'Средние века', 'Реформы Петра I', 'Культура России', 'Великие географические открытия'],
    };
    const homework = {
      'Математика': '№ 145–148, повторить правила сложения дробей.',
      'Русский язык': 'Упражнение 212, выучить словарные слова.',
      'Литература': 'Прочитать главу 3, ответить на вопросы.',
      'Английский язык': 'Workbook p. 54, выучить 10 новых слов.',
      'История': '§ 12, подготовить короткое сообщение.',
    };
    const comments = [
      'Обратите внимание на оформление решения.',
      'Хорошая работа на уроке, продолжайте в том же духе.',
      'Нужно повторить тему дома.',
      'Активно работал(а) на уроке.',
    ];
    const tokenReasons = [
      ['Активность на уроке', 2],
      ['Помощь однокласснику', 3],
      ['Отличная работа', 2],
      ['Опоздание', -1],
      ['Нарушение дисциплины', -2],
    ];

    function pickGrade() {
      const r = Math.random();
      if (r < 0.38) return 5;
      if (r < 0.73) return 4;
      if (r < 0.93) return 3;
      return 2;
    }

    function pickAttendance() {
      const r = Math.random();
      if (r < 0.90) return 'present';
      if (r < 0.94) return 'late';
      if (r < 0.97) return 'absent';
      return 'excused';
    }

    function moscowIso(dateStr, hour, minute) {
      const base = parseDate(dateStr);
      const utc = new Date(Date.UTC(
        base.getUTCFullYear(),
        base.getUTCMonth(),
        base.getUTCDate(),
        hour - 3,
        minute,
        0
      ));
      return utc.toISOString();
    }

    const filledLessons = [];

    for (const weekStart of weekStarts) {
      for (const className of classNames) {
        const rows = scheduleByWeek.get(`${weekStart}:${className}`);
        for (const row of rows) {
          const date = addDays(weekStart, row.day - 1);
          if (date > today) continue;

          const lessonId = Number(
            insertLesson.run(
              row.id,
              row.classId,
              row.subjectId,
              row.teacherId,
              date,
              row.lessonNo,
              null,
              'regular',
              null,
              null,
              null,
              null
            ).lastInsertRowid
          );

          const studentIds = students[className];

          if (date === today) continue;

          /* Заполненный урок */
          const typeRoll = Math.random();
          const lessonType = typeRoll < 0.12 ? 'test' : typeRoll < 0.24 ? 'independent' : 'regular';
          const topicList = topics[row.subjectName];
          const topic = topicList[Math.floor(Math.random() * topicList.length)];
          const hw = homework[row.subjectName];
          const comment = Math.random() < 0.12
            ? comments[Math.floor(Math.random() * comments.length)]
            : null;
          const late = Math.random() < 0.12;
          const hour = late ? 18 + Math.floor(Math.random() * 2) : 14 + Math.floor(Math.random() * 4);
          const minute = Math.floor(Math.random() * 60);
          const filledAt = moscowIso(date, hour, minute);
          const fillStatus = new Date(filledAt) <= moscowDeadline(date) ? 'on_time' : 'late';

          db.prepare(`
            UPDATE lessons
            SET topic = ?, lesson_type = ?, homework_text = ?, parent_comment = ?,
                filled_at = ?, fill_status = ?
            WHERE id = ?
          `).run(topic, lessonType, hw, comment, filledAt, fillStatus, lessonId);
          filledLessons.push(lessonId);

          const weight = lessonType === 'test' ? 2 : 1;
          for (const studentId of studentIds) {
            insertAttendance.run(lessonId, studentId, pickAttendance());

            const roll = Math.random();
            if (roll < 0.58) {
              insertGrade.run(lessonId, studentId, pickGrade(), weight);
              if (Math.random() < 0.22) {
                insertGrade.run(lessonId, studentId, pickGrade(), weight);
              }
            }
          }
        }
      }
    }

    /* ── Ровно 2 незаполненных урока за вчера у teacher1 ──────── */
    const yesterday = addDays(today, -1);
    let teacher1Yesterday = db.prepare(`
      SELECT id FROM lessons
      WHERE teacher_id = ? AND date = ?
      ORDER BY lesson_no
    `).all(teacher1, yesterday);

    if (teacher1Yesterday.length < 2) {
      const extraTargets = [
        { className: '5А', lessonNo: 7 },
        { className: '6Б', lessonNo: 8 },
      ];
      for (const target of extraTargets) {
        if (teacher1Yesterday.length >= 2) break;
        const exists = db.prepare(
          'SELECT id FROM lessons WHERE class_id = ? AND date = ? AND lesson_no = ?'
        ).get(classes[target.className], yesterday, target.lessonNo);
        if (exists) {
          db.prepare(`
            UPDATE lessons SET teacher_id = ?, subject_id = ?, topic = NULL, lesson_type = 'regular',
              homework_text = NULL, parent_comment = NULL, filled_at = NULL, fill_status = NULL
            WHERE id = ?
          `).run(teacher1, subjects['Математика'], exists.id);
          teacher1Yesterday.push({ id: exists.id });
        } else {
          const newId = Number(insertLesson.run(
            null,
            classes[target.className],
            subjects['Математика'],
            teacher1,
            yesterday,
            target.lessonNo,
            null,
            'regular',
            null,
            null,
            null,
            null
          ).lastInsertRowid);
          teacher1Yesterday.push({ id: newId });
        }
      }
    }

    for (const row of teacher1Yesterday.slice(0, 2)) {
      db.prepare('DELETE FROM grades WHERE lesson_id = ?').run(row.id);
      db.prepare('DELETE FROM attendance WHERE lesson_id = ?').run(row.id);
      db.prepare(`
        UPDATE lessons
        SET topic = NULL, lesson_type = 'regular', homework_text = NULL,
            homework_file = NULL, homework_original_name = NULL,
            parent_comment = NULL, filled_at = NULL, fill_status = NULL
        WHERE id = ?
      `).run(row.id);
    }

    /* ── Токены ──────────────────────────────────────────────── */
    for (const className of classNames) {
      for (const studentId of students[className]) {
        const count = 2 + Math.floor(Math.random() * 2);
        for (let i = 0; i < count; i += 1) {
          const [reason, amount] = tokenReasons[Math.floor(Math.random() * tokenReasons.length)];
          const dayOffset = 1 + Math.floor(Math.random() * 26);
          const date = addDays(today, -dayOffset);
          const createdAt = moscowIso(date, 10 + Math.floor(Math.random() * 7), 15);
          insertToken.run(
            studentId,
            Math.random() < 0.8 ? teacher1 : teacher2,
            amount,
            reason,
            createdAt
          );
        }
      }
    }

    /* ── Заявка родителя на модерации ────────────────────────── */
    db.prepare(`
      INSERT INTO parent_requests (email, full_name, child_name, child_class, status, user_id)
      VALUES (?, ?, ?, ?, 'pending', ?)
    `).run(
      'newparent@diary.app',
      'Новикова Елена Андреевна',
      'Новиков Артём Сергеевич',
      '6Б',
      pendingParent
    );

    /* ── Демо-уведомления и внутренняя заметка ───────────────── */
    const now = Date.now();
    const hoursAgo = (hours) => new Date(now - hours * 60 * 60 * 1000).toISOString();
    insertNotification.run(
      parent1,
      students['5А'][0],
      'grade',
      'Новая оценка: Математика',
      'Орлов Максим · 5А: 5 за контрольную работу.',
      `/parent/performance?child=${students['5А'][0]}`,
      hoursAgo(2),
      null
    );
    insertNotification.run(
      parent1,
      students['5А'][0],
      'homework',
      'Домашнее задание: Математика',
      'Орлов Максим · 5А: № 145–148, повторить правила сложения дробей.',
      `/parent/children/${students['5А'][0]}/diary`,
      hoursAgo(5),
      null
    );
    insertNotification.run(
      parent1,
      students['7В'][0],
      'token',
      'Начислено 2 токен(ов)',
      'Орлова София: активность на уроке.',
      `/parent/tokens?child=${students['7В'][0]}`,
      hoursAgo(26),
      null
    );
    insertNotification.run(
      parent1,
      students['7В'][0],
      'schedule',
      'Расписание: 7В',
      'Орлова София: изменение в расписании на текущую неделю.',
      `/parent/children/${students['7В'][0]}/diary`,
      hoursAgo(50),
      hoursAgo(48)
    );
    insertNotification.run(
      parent2,
      students['6Б'][0],
      'comment',
      'Комментарий учителя: Русский язык',
      'Соколов Никита · 6Б: хорошая работа на уроке.',
      `/parent/children/${students['6Б'][0]}/diary`,
      hoursAgo(7),
      null
    );
    insertNote.run(
      students['5А'][0],
      teacher1,
      'Сильный ученик, стоит предложить задания повышенной сложности. Родителю не показывать.',
      hoursAgo(20)
    );

    console.log('[diary+] Демо-данные: 3 класса, 30 учеников, 4 учителя, 5 предметов, заявка на модерации.');
    console.log(`[diary+] Незаполненные уроки teacher1 за ${yesterday}: 2.`);
    console.log(`[diary+] Администратор #${adminId}`);
  });

  run();
}

module.exports = seed;
