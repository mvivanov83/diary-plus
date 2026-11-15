'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const config = require('../config');
const { requireAuth } = require('../auth');
const { sendError } = require('../layout');

const router = express.Router();

router.get('/files/homework/:lessonId', requireAuth, (req, res) => {
  const lesson = db.prepare(`
    SELECT l.id, l.class_id, l.teacher_id, l.homework_file, l.homework_original_name
    FROM lessons l
    WHERE l.id = ?
  `).get(Number(req.params.lessonId));

  if (!lesson || !lesson.homework_file) {
    return sendError(res, 404, 'Файл не найден', 'К этому уроку не прикреплён файл.', req.user);
  }

  let allowed = req.user.role === 'admin';
  if (!allowed && req.user.role === 'teacher') {
    allowed = lesson.teacher_id === req.user.id;
  }
  if (!allowed && req.user.role === 'parent') {
    allowed = Boolean(db.prepare(`
      SELECT 1 AS ok
      FROM parent_students ps
      JOIN students st ON st.id = ps.student_id
      WHERE ps.parent_id = ? AND st.class_id = ?
      LIMIT 1
    `).get(req.user.id, lesson.class_id));
  }

  if (!allowed) {
    return sendError(res, 403, 'Нет доступа', 'Файл доступен только участникам этого класса.', req.user);
  }

  const fullPath = path.join(config.UPLOADS_DIR, path.basename(lesson.homework_file));
  if (!fs.existsSync(fullPath)) {
    return sendError(res, 404, 'Файл не найден', 'Файл был удалён с сервера.', req.user);
  }

  return res.download(fullPath, lesson.homework_original_name || lesson.homework_file);
});

module.exports = router;
