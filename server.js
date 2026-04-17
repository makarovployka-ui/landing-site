const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const nodemailer = require('nodemailer');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_FILE_SIZE_MB = Number(process.env.MAX_FILE_SIZE_MB || 50);
const UPLOAD_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9а-яА-ЯёЁ._-]/g, '_');
    cb(null, `${Date.now()}-${safeName}`);
  }
});

const allowedExtensions = new Set(['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png']);

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExtensions.has(ext)) {
      return cb(null, true);
    }
    cb(new Error('Недопустимый формат файла. Разрешены: PDF, DOC, DOCX, JPG, JPEG, PNG.'));
  }
});

function createTransporter() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 465);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error('SMTP не настроен. Заполните SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS в .env');
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass }
  });
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'upload-mailer' });
});

app.post('/api/upload', upload.single('attachment'), async (req, res) => {
  let uploadedFilePath = null;

  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, message: 'Файл не был загружен.' });
    }

    uploadedFilePath = req.file.path;

    const transporter = createTransporter();
    const recipient = process.env.RECIPIENT_EMAIL || process.env.SMTP_USER;
    const sender = process.env.FROM_EMAIL || process.env.SMTP_USER;

    const clientName = req.body.name || 'Не указано';
    const clientPhone = req.body.phone || 'Не указано';
    const clientEmail = req.body.email || 'Не указано';
    const clientComment = req.body.comment || 'Без комментария';

    await transporter.sendMail({
      from: sender,
      to: recipient,
      replyTo: clientEmail !== 'Не указано' ? clientEmail : undefined,
      subject: 'Новый файл с сайта fi.center | Рецензирование',
      text:
`С сайта поступила новая заявка.\n\n` +
`Имя: ${clientName}\n` +
`Телефон: ${clientPhone}\n` +
`Email: ${clientEmail}\n` +
`Комментарий: ${clientComment}\n` +
`Файл: ${req.file.originalname}`,
      html:
`<h2>Новая заявка с сайта</h2>
<p><strong>Имя:</strong> ${clientName}</p>
<p><strong>Телефон:</strong> ${clientPhone}</p>
<p><strong>Email:</strong> ${clientEmail}</p>
<p><strong>Комментарий:</strong> ${clientComment}</p>
<p><strong>Файл:</strong> ${req.file.originalname}</p>`,
      attachments: [
        {
          filename: req.file.originalname,
          path: uploadedFilePath
        }
      ]
    });

    fs.unlink(uploadedFilePath, () => {});

    return res.json({ ok: true, message: 'Файл успешно отправлен на почту.' });
  } catch (error) {
    if (uploadedFilePath) {
      fs.unlink(uploadedFilePath, () => {});
    }

    return res.status(500).json({
      ok: false,
      message: error.message || 'Ошибка при отправке файла.'
    });
  }
});

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      ok: false,
      message: err.code === 'LIMIT_FILE_SIZE'
        ? `Файл слишком большой. Максимум ${MAX_FILE_SIZE_MB} МБ.`
        : 'Ошибка загрузки файла.'
    });
  }

  if (err) {
    return res.status(400).json({ ok: false, message: err.message });
  }

  return res.status(500).json({ ok: false, message: 'Внутренняя ошибка сервера.' });
});

app.get('*', (req, res) => {
  const requestedPath = path.join(__dirname, req.path);
  if (fs.existsSync(requestedPath) && fs.statSync(requestedPath).isFile()) {
    return res.sendFile(requestedPath);
  }
  return res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server started on http://localhost:${PORT}`);
});