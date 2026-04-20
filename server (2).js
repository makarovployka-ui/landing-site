'use strict';

const express    = require('express');
const multer     = require('multer');
const nodemailer = require('nodemailer');
const path       = require('path');
const fs         = require('fs');

// ── Конфигурация ────────────────────────────────────────────
const PORT            = process.env.PORT || 3000;
const SMTP_HOST       = 'smtp.yandex.ru';
const SMTP_PORT       = 465;
const SMTP_USER       = 'adm@fi.center';
const SMTP_PASS       = 'rhfbhbcmbczmojyv';
const SENDER_EMAIL    = 'adm@fi.center';
const RECIPIENT_EMAIL = 'adm@fi.center';
const MAX_FILE_SIZE   = 50 * 1024 * 1024; // 50 МБ

// ── Multer: временное хранение файлов ───────────────────────
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = path.join(__dirname, 'uploads_tmp');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const timestamp = Date.now();
    const safe = Buffer.from(file.originalname, 'latin1').toString('utf8')
      .replace(/[/\\?%*:|"<>]/g, '_');
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
      cb(new Error('Недопустимый формат: ' + ext + '. Разрешены: PDF, DOC, DOCX, JPG, PNG'));
    }
  }
});

// ── Nodemailer: SMTP Яндекс ──────────────────────────────────
const transporter = nodemailer.createTransport({
  host:   SMTP_HOST,
  port:   SMTP_PORT,
  secure: true,
  auth: {
    user: SMTP_USER,
    pass: SMTP_PASS
  },
  tls: { rejectUnauthorized: true }
});

transporter.verify(function (error) {
  if (error) {
    console.error('SMTP ошибка:', error.message);
  } else {
    console.log('SMTP Яндекс подключён. Готов к отправке.');
  }
});

// ── Express ──────────────────────────────────────────────────
const app = express();

app.use(express.static(path.join(__dirname)));

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── POST /submit ─────────────────────────────────────────────
app.post('/submit', upload.single('attachment'), async (req, res) => {
  const tmpFile = req.file ? req.file.path : null;

  try {
    const {
      client_name       = '',
      client_phone      = '',
      client_email      = '',
      client_company    = '',
      submission_source = '',
      submitted_at      = ''
    } = req.body || {};

    if (!client_name.trim())
      return res.status(400).json({ error: 'Не указано ФИО клиента.' });
    if (!client_phone.trim())
      return res.status(400).json({ error: 'Не указан номер телефона.' });
    if (!client_email.trim())
      return res.status(400).json({ error: 'Не указан email клиента.' });
    if (!req.file)
      return res.status(400).json({ error: 'Файл экспертизы не приложен.' });

    const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');

    const dateStr = submitted_at
      ? new Date(submitted_at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })
      : new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });

    const mailOptions = {
      from:    '"fi.center — Заявки" <' + SENDER_EMAIL + '>',
      to:      RECIPIENT_EMAIL,
      replyTo: client_email.trim(),
      subject: 'Новая заявка на рецензию — ' + client_name.trim(),
      text: [
        '========================================',
        '  Новая заявка — fi.center',
        '========================================',
        '',
        'ФИО:          ' + client_name.trim(),
        'Телефон:      ' + client_phone.trim(),
        'Email:        ' + client_email.trim(),
        'Организация:  ' + (client_company.trim() || '—'),
        '',
        'Источник:     ' + (submission_source || 'fi.center landing'),
        'Время подачи: ' + dateStr + ' (МСК)',
        '',
        'Файл экспертизы приложен к письму.',
        '========================================'
      ].join('\n'),
      attachments: [
        {
          filename: originalName,
          path:     req.file.path,
          encoding: 'base64'
        }
      ]
    };

    await transporter.sendMail(mailOptions);
    console.log('Заявка отправлена:', client_name.trim(), '|', originalName);

    if (tmpFile) fs.unlink(tmpFile, () => {});

    return res.status(200).json({ message: 'Заявка успешно отправлена.' });

  } catch (err) {
    console.error('Ошибка:', err.message);
    if (tmpFile) fs.unlink(tmpFile, () => {});
    return res.status(500).json({ error: 'Ошибка при отправке письма: ' + err.message });
  }
});

// ── Ошибки Multer ────────────────────────────────────────────
app.use((err, req, res, next) => {
  if (err) {
    const msg = (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE')
      ? 'Файл превышает лимит 50 МБ.'
      : (err.message || 'Ошибка загрузки файла.');
    return res.status(400).json({ error: msg });
  }
  next();
});

// ── Запуск ───────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('fi.center сервер: http://localhost:' + PORT);
  console.log('Письма уходят на: ' + RECIPIENT_EMAIL);
});
