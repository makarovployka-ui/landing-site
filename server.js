'use strict';

const express         = require('express');
const multer          = require('multer');
const path            = require('path');
const fs              = require('fs');
const https           = require('https');
const FormData        = require('form-data');
const { SocksProxyAgent } = require('socks-proxy-agent');

// ── Telegram ─────────────────────────────────────────────────
const BOT_TOKEN = 'ВСТАВЬТЕ_TOKEN_БОТА_СЮДА';
const CHAT_ID   = 'ВСТАВЬТЕ_CHAT_ID_СЮДА';

// ── SOCKS5 прокси ────────────────────────────────────────────
const PROXY_HOST = '89.124.80.186';
const PROXY_PORT = 1080;
const PROXY_USER = 'ВСТАВЬТЕ_ЛОГИН_СЮДА';
const PROXY_PASS = 'ВСТАВЬТЕ_ПАРОЛЬ_СЮДА';

const PROXY_URL  = `socks5://${PROXY_USER}:${PROXY_PASS}@${PROXY_HOST}:${PROXY_PORT}`;
const proxyAgent = new SocksProxyAgent(PROXY_URL);

const PORT          = process.env.PORT || 3000;
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 МБ

// ── Multer ───────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = path.join(__dirname, 'uploads_tmp');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const safe = Buffer.from(file.originalname, 'latin1').toString('utf8')
      .replace(/[/\\?%*:|"<>]/g, '_');
    cb(null, Date.now() + '_' + safe);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: function (req, file, cb) {
    const allowed = ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png'];
    const ext = path.extname(file.originalname).toLowerCase();
    allowed.includes(ext)
      ? cb(null, true)
      : cb(new Error('Недопустимый формат: ' + ext));
  }
});

// ── Отправка текста в Telegram через прокси ──────────────────
function tgSendMessage(text) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML' });
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/sendMessage`,
      method: 'POST',
      agent: proxyAgent,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Отправка файла в Telegram через прокси ───────────────────
function tgSendDocument(filePath, fileName, caption) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('chat_id', CHAT_ID);
    form.append('caption', caption);
    form.append('parse_mode', 'HTML');
    form.append('document', fs.createReadStream(filePath), { filename: fileName });

    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/sendDocument`,
      method: 'POST',
      agent: proxyAgent,
      headers: form.getHeaders()
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    form.pipe(req);
  });
}

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
      client_name    = '',
      client_phone   = '',
      client_email   = '',
      client_company = '',
      submitted_at   = ''
    } = req.body || {};

    if (!client_name.trim())
      return res.status(400).json({ error: 'Не указано ФИО.' });
    if (!client_phone.trim())
      return res.status(400).json({ error: 'Не указан телефон.' });
    if (!client_email.trim())
      return res.status(400).json({ error: 'Не указан email.' });
    if (!req.file)
      return res.status(400).json({ error: 'Файл не приложен.' });

    const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');

    const dateStr = submitted_at
      ? new Date(submitted_at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })
      : new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });

    const caption = [
      '📋 <b>Новая заявка — fi.center</b>',
      '',
      `👤 <b>ФИО:</b> ${client_name.trim()}`,
      `📞 <b>Телефон:</b> ${client_phone.trim()}`,
      `📧 <b>Email:</b> ${client_email.trim()}`,
      `🏢 <b>Организация:</b> ${client_company.trim() || '—'}`,
      '',
      `🕐 <b>Время:</b> ${dateStr} (МСК)`,
    ].join('\n');

    const tgResult = await tgSendDocument(req.file.path, originalName, caption);

    if (!tgResult.ok) {
      throw new Error('Telegram API: ' + (tgResult.description || 'неизвестная ошибка'));
    }

    console.log('✅ Отправлено в Telegram:', client_name.trim(), '|', originalName);
    if (tmpFile) fs.unlink(tmpFile, () => {});

    return res.status(200).json({ message: 'Заявка успешно отправлена.' });

  } catch (err) {
    console.error('❌ Ошибка:', err.message);
    if (tmpFile) fs.unlink(tmpFile, () => {});
    return res.status(500).json({ error: 'Ошибка при отправке: ' + err.message });
  }
});

// ── Ошибки Multer ────────────────────────────────────────────
app.use((err, req, res, next) => {
  if (err) {
    const msg = (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE')
      ? 'Файл превышает лимит 50 МБ.'
      : (err.message || 'Ошибка загрузки.');
    return res.status(400).json({ error: msg });
  }
  next();
});

// ── Запуск ───────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('════════════════════════════════════');
  console.log('  fi.center сервер: http://localhost:' + PORT);
  console.log('  Прокси: ' + PROXY_HOST + ':' + PROXY_PORT);
  console.log('  Telegram CHAT_ID: ' + CHAT_ID);
  console.log('════════════════════════════════════');
});
