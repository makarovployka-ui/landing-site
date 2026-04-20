'use strict';

const express    = require('express');
const multer     = require('multer');
const nodemailer = require('nodemailer');
const path       = require('path');
const fs         = require('fs');

// ── Конфигурация ────────────────────────────────────────────
const PORT            = process.env.PORT || 3000;
const RECIPIENT_EMAIL = process.env.RECIPIENT_EMAIL || 'info@fi.center';
const SMTP_HOST       = process.env.SMTP_HOST       || 'smtp.yandex.ru';
const SMTP_PORT       = parseInt(process.env.SMTP_PORT || '465', 10);
const SMTP_USER       = process.env.SMTP_USER       || '';   // задать в .env
const SMTP_PASS       = process.env.SMTP_PASS       || '';   // задать в .env
const MAX_FILE_SIZE   = 50 * 1024 * 1024; // 50 МБ

// ── Multer: хранение загружаемых файлов ─────────────────────
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = path.join(__dirname, 'uploads_tmp');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const timestamp = Date.now();
    const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_А-Яа-яЁё]/g, '_');
    cb(null, `${timestamp}_${safe}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: function (req, file, cb) {
    const allowed = ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Недопустимый формат файла: ${ext}`));
    }
  }
});

// ── SMTP транспорт ───────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_PORT === 465,
  auth: {
    user: SMTP_USER,
    pass: SMTP_PASS
  }
});

// ── Express ──────────────────────────────────────────────────
const app = express();

// Отдаём index.html и статику из текущей папки
app.use(express.static(path.join(__dirname)));

// CORS (если фронт и бэк на разных портах в dev-режиме)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── POST /submit — приём заявки ──────────────────────────────
app.post('/submit', upload.single('attachment'), async (req, res) => {
  try {
    const {
      client_name    = '',
      client_phone   = '',
      client_email   = '',
      client_company = '',
      submission_source = '',
      submitted_at   = ''
    } = req.body;

    // Базовая валидация
    if (!client_name.trim() || !client_phone.trim() || !client_email.trim()) {
      return res.status(400).json({ error: 'Не заполнены обязательные поля: ФИО, телефон, email.' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Файл экспертизы не приложен.' });
    }

    // Формируем письмо
    const mailOptions = {
      from:    `"fi.center — Заявки" <${SMTP_USER}>`,
      to:      RECIPIENT_EMAIL,
      replyTo: client_email,
      subject: `Новая заявка на рецензию — ${client_name}`,
      text: [
        'Новая заявка на рецензирование судебной экспертизы',
        '',
        `ФИО:           ${client_name}`,
        `Телефон:       ${client_phone}`,
        `Email:         ${client_email}`,
        `Организация:   ${client_company || '—'}`,
        '',
        `Источник:      ${submission_source || '—'}`,
        `Время подачи:  ${submitted_at   || new Date().toISOString()}`,
        '',
        'Файл экспертизы приложен к письму.'
      ].join('\n'),
      attachments: [
        {
          filename: req.file.originalname,
          path:     req.file.path
        }
      ]
    };

    await transporter.sendMail(mailOptions);

    // Удаляем временный файл после отправки
    fs.unlink(req.file.path, () => {});

    return res.status(200).json({ message: 'Заявка успешно отправлена.' });

  } catch (err) {
    console.error('Ошибка отправки заявки:', err);
    // Удаляем временный файл при ошибке
    if (req.file && req.file.path) fs.unlink(req.file.path, () => {});
    return res.status(500).json({ error: err.message || 'Внутренняя ошибка сервера.' });
  }
});

// ── Обработка ошибок multer ──────────────────────────────────
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Файл превышает лимит 50 МБ.' });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
});

// ── Запуск ───────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`fi.center сервер запущен: http://localhost:${PORT}`);
  console.log(`Получатель заявок: ${RECIPIENT_EMAIL}`);
});
