// Backend cho dịch vụ chỉnh ảnh theo yêu cầu / theo ảnh phong cách.
// Khách gửi ảnh + yêu cầu chữ và/hoặc ảnh phong cách muốn giống. Backend đưa vào
// thư mục "Đơn chỉnh ảnh AI" trên Drive theo mã đơn, trả trạng thái và ảnh kết quả
// khi xong, và TỰ XÓA đơn sau RETENTION_HOURS giờ (mặc định 48 giờ).
//
// Biến môi trường:
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN : đăng nhập Drive (OAuth)
//   DRIVE_ROOT_FOLDER_ID : ID thư mục "Đơn chỉnh ảnh AI" trên Drive
//   CLEANUP_KEY          : (tùy chọn) khóa để dịch vụ ping gọi /api/cleanup
//   RETENTION_HOURS      : (tùy chọn) số giờ giữ đơn, mặc định 48
//   REQUIRE_APPROVAL     : (tùy chọn) "true" = trợ lý chỉ làm khi bạn tạo da-duyet.txt
//   ALLOWED_ORIGIN       : (tùy chọn) tên miền được gọi API, mặc định mọi nơi
//   AUTO_MUSE            : (tùy chọn) "true" = máy chủ tự làm đơn (thợ tự động), không cần Claude
//   SITE_URL             : (tùy chọn) địa chỉ trang web, để ghi link vào file nhắc Zalo
const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const { google } = require('googleapis');
const autoMuse = require('./auto-muse.js');

const ROOT_FOLDER_ID = process.env.DRIVE_ROOT_FOLDER_ID || '';
const RETENTION_HOURS = Number(process.env.RETENTION_HOURS) || 48;
const RETENTION_MS = RETENTION_HOURS * 3600 * 1000;
const REQUIRE_APPROVAL = process.env.REQUIRE_APPROVAL === 'true';
const CLEANUP_KEY = process.env.CLEANUP_KEY || '';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
// AUTO_MUSE=true: máy chủ tự chỉnh ánh sáng cho đơn, không cần Claude hay máy của bạn bật.
const AUTO_MUSE = process.env.AUTO_MUSE === 'true';

// Mã đơn: 16 ký tự hex ngẫu nhiên (64 bit) — không đoán được, cũng là chìa
// khóa để xem/tải ảnh kết quả, nên không bao giờ liệt kê mã của người khác.
const CODE_RE = /^DON-[a-f0-9]{16}$/;

const MAX_IMAGE = 20 * 1024 * 1024; // mỗi ảnh (ảnh chính và ảnh phong cách)
const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const RESULT_RE = /^ket-qua\.(jpe?g|png|webp)$/i;
const RESULT_MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const ORDER_LIMIT = Number(process.env.ORDER_LIMIT_PER_HOUR) || 5;
const resultFile = (files) => files.find((f) => RESULT_RE.test(f.name)) || null;

const FOLDER_MIME = 'application/vnd.google-apps.folder';

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: MAX_IMAGE, files: 2, fields: 10, fieldSize: 4096 },
  fileFilter(req, file, cb) {
    if (IMAGE_TYPES[file.mimetype]) return cb(null, true);
    const err = new Error('bad_type');
    err.code = 'BAD_TYPE';
    cb(err);
  },
});

// ---------- Google Drive ----------

let drive = null;
function getDrive() {
  if (drive) return drive;
  const { GOOGLE_CLIENT_ID: id, GOOGLE_CLIENT_SECRET: secret, GOOGLE_REFRESH_TOKEN: token } = process.env;
  if (!id || !secret || !token || !ROOT_FOLDER_ID) return null;
  const auth = new google.auth.OAuth2(id, secret);
  auth.setCredentials({ refresh_token: token });
  drive = google.drive({ version: 'v3', auth });
  return drive;
}

async function listFiles(drv, folderId) {
  const r = await drv.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id,name,createdTime)',
    pageSize: 100,
  });
  return r.data.files || [];
}

async function uploadFile(drv, folderId, body, name, mimeType) {
  await drv.files.create({
    requestBody: { name, parents: [folderId] },
    media: { mimeType, body },
    fields: 'id',
  });
}

// Chỉ gọi với mã đã qua CODE_RE nên ghép chuỗi vào truy vấn là an toàn.
async function findOrderFolder(drv, code) {
  const r = await drv.files.list({
    q: `'${ROOT_FOLDER_ID}' in parents and name = '${code}' and mimeType = '${FOLDER_MIME}' and trashed = false`,
    fields: 'files(id,createdTime)',
    pageSize: 1,
  });
  return r.data.files[0] || null;
}

// Từ danh sách file trong thư mục đơn, suy ra trạng thái và hạn xóa.
//   Đơn xong: hết hạn sau RETENTION_HOURS kể từ lúc có xong.txt.
//   Đơn chưa xong: hết hạn sau RETENTION_HOURS kể từ lúc tạo đơn.
function describe(files, folderCreatedTime) {
  const by = Object.fromEntries(files.map((f) => [f.name, f]));
  let status = 'processing';
  // Xong = có xong.txt VÀ có ảnh kết quả (phòng khi xong.txt đến trước do đồng bộ chậm).
  if (by['xong.txt'] && resultFile(files)) status = 'done';
  else if (by['tu-choi.txt']) status = 'rejected';
  else if (REQUIRE_APPROVAL && !by['da-duyet.txt']) status = 'pending';
  const base = status === 'done' ? by['xong.txt'].createdTime
    : status === 'rejected' ? by['tu-choi.txt'].createdTime
    : folderCreatedTime;
  const expiresAt = new Date(Date.parse(base) + RETENTION_MS).toISOString();
  return { status, expiresAt, by };
}

// Trả về null nếu mã sai, không có, hoặc đã quá hạn (kể cả khi chưa kịp xóa).
async function loadOrder(drv, code) {
  if (!CODE_RE.test(code)) return null;
  const folder = await findOrderFolder(drv, code);
  if (!folder) return null;
  const files = await listFiles(drv, folder.id);
  const info = describe(files, folder.createdTime);
  if (Date.now() > Date.parse(info.expiresAt)) return null;
  return { folder, files, ...info };
}

// ---------- Dọn dẹp tự động ----------

let cleaning = false;
let lastCleanup = 0;
let cleanAgain = false; // có yêu cầu dọn trong lúc đang dọn: dọn lại ngay khi xong

// Xóa vĩnh viễn (không qua thùng rác) các đơn quá hạn. Với đơn đã có kết quả,
// xóa luôn ảnh gốc, ảnh phong cách và yeu-cau.txt (có số điện thoại) cho gọn.
// Chỉ đụng tới thư mục con tên DON-<16 hex> trong thư mục gốc.
async function cleanup(force = false) {
  const drv = getDrive();
  if (!drv) return null;
  if (cleaning) { if (force) cleanAgain = true; return null; }
  if (!force && Date.now() - lastCleanup < 10 * 60 * 1000) return null;
  cleaning = true;
  lastCleanup = Date.now();
  const stats = { checked: 0, deleted: 0, trimmed: 0 };
  try {
    let pageToken;
    do {
      const r = await drv.files.list({
        q: `'${ROOT_FOLDER_ID}' in parents and mimeType = '${FOLDER_MIME}' and name contains 'DON-' and trashed = false`,
        fields: 'nextPageToken,files(id,name,createdTime)',
        pageSize: 100,
        pageToken,
      });
      for (const folder of r.data.files || []) {
        if (!CODE_RE.test(folder.name)) continue;
        stats.checked++;
        const files = await listFiles(drv, folder.id);
        const info = describe(files, folder.createdTime);
        if (Date.now() > Date.parse(info.expiresAt)) {
          await drv.files.delete({ fileId: folder.id });
          stats.deleted++;
        } else if (info.status === 'rejected' || (info.status === 'done' && resultFile(files))) {
          for (const f of files) {
            if (/^(anh|anh-mau)\./.test(f.name) || f.name === 'yeu-cau.txt') {
              await drv.files.delete({ fileId: f.id });
              stats.trimmed++;
            }
          }
        }
      }
      pageToken = r.data.nextPageToken;
    } while (pageToken);
    // File nhắc Zalo (có số điện thoại) do thợ tự động ghi vào thư mục gốc: xóa khi quá hạn.
    const z = await drv.files.list({
      q: `'${ROOT_FOLDER_ID}' in parents and name contains 'ZALO-DON-' and trashed = false`,
      fields: 'files(id,name,createdTime)',
      pageSize: 100,
    });
    for (const f of z.data.files || []) {
      if (/^ZALO-DON-[a-f0-9]{16}\.txt$/.test(f.name) && Date.now() - Date.parse(f.createdTime) > RETENTION_MS) {
        await drv.files.delete({ fileId: f.id });
        stats.deleted++;
      }
    }
  } catch (e) {
    console.error('cleanup loi:', e.message);
  } finally {
    cleaning = false;
    if (cleanAgain) { cleanAgain = false; setImmediate(() => cleanup(true).catch(() => {})); }
  }
  return stats;
}

// ---------- Thợ tự động ----------

// Làm lần lượt các đơn đang chờ (tối đa 5 đơn mỗi lượt để không giữ máy chủ quá lâu).
async function museTick() {
  const drv = getDrive();
  if (!AUTO_MUSE || !drv) return null;
  const out = [];
  for (let i = 0; i < 5; i++) {
    const r = await autoMuse.tick(drv, ROOT_FOLDER_ID, {
      requireApproval: REQUIRE_APPROVAL,
      notify: { driveRoot: ROOT_FOLDER_ID, siteUrl: process.env.SITE_URL || '' },
    });
    if (!r || r.none || r.busy || r.error) break;
    out.push(r);
  }
  // Làm xong thì dọn ngay: xóa ảnh gốc, ảnh mẫu và số điện thoại khỏi thư mục đơn đã xong.
  if (out.length) await cleanup(true);
  return out;
}

// ---------- Web ----------

const app = express();
app.set('trust proxy', 1); // Render đứng sau proxy: cần để giới hạn theo IP thật

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.static(path.join(__dirname, '..', 'public')));

const orderLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: ORDER_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_requests' },
});
const readLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_requests' },
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, driveConfigured: !!getDrive() });
});

app.get('/api/cleanup', async (req, res) => {
  if (!CLEANUP_KEY) return res.sendStatus(404);
  const given = Buffer.from(String(req.query.key || ''));
  const want = Buffer.from(CLEANUP_KEY);
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return res.sendStatus(403);
  const stats = await cleanup(true);
  const made = await museTick().catch((e) => { console.error(e.message); return null; });
  res.json({ ok: true, ...(stats || {}), ...(made ? { muse: made.length } : {}) });
});

const oneLine = (v, max) => String(v || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);

app.post(
  '/api/orders',
  orderLimiter,
  upload.fields([
    { name: 'photo', maxCount: 1 },
    { name: 'style', maxCount: 1 },
  ]),
  async (req, res) => {
    const files = req.files || {};
    const photo = files.photo?.[0];
    const style = files.style?.[0];
    const drv = getDrive();
    let folderId = null;
    try {
      if (!drv) return res.status(503).json({ error: 'drive_not_configured' });
      if (!photo) return res.status(400).json({ error: 'missing_files' });
      const request = oneLine(req.body.request, 500);
      // Cần ít nhất một trong hai: yêu cầu chữ hoặc ảnh phong cách.
      if (!request && !style) return res.status(400).json({ error: 'need_request' });
      if (req.body.consent !== '1') return res.status(400).json({ error: 'need_consent' });

      const code = 'DON-' + crypto.randomBytes(8).toString('hex');
      const folder = await drv.files.create({
        requestBody: { name: code, mimeType: FOLDER_MIME, parents: [ROOT_FOLDER_ID] },
        fields: 'id',
      });
      folderId = folder.data.id;

      await uploadFile(drv, folderId, fs.createReadStream(photo.path), `anh.${IMAGE_TYPES[photo.mimetype]}`, photo.mimetype);
      if (style) {
        await uploadFile(drv, folderId, fs.createReadStream(style.path), `anh-mau.${IMAGE_TYPES[style.mimetype]}`, style.mimetype);
      }

      // yeu-cau.txt tải lên CUỐI CÙNG: Muse chỉ nhận đơn khi thấy file này,
      // để không bắt đầu khi ảnh chưa tải xong.
      const note =
        `Yêu cầu: ${request || '(không có, làm theo ảnh phong cách)'}\n` +
        `Ảnh phong cách: ${style ? 'có (anh-mau)' : 'không'}\n` +
        `Tên: ${oneLine(req.body.name, 80)}\n` +
        `SĐT/Zalo: ${oneLine(req.body.phone, 20)}\n`;
      await uploadFile(drv, folderId, Readable.from([note]), 'yeu-cau.txt', 'text/plain');

      res.json({ orderCode: code, retentionHours: RETENTION_HOURS });
      cleanup().catch(() => {});
      museTick().catch(() => {}); // thợ tự động bắt tay làm ngay, khách không phải chờ lịch
    } catch (e) {
      console.error(e.message);
      if (folderId) drv.files.delete({ fileId: folderId }).catch(() => {});
      if (!res.headersSent) res.status(500).json({ error: 'upload_failed' });
    } finally {
      for (const f of [photo, style]) if (f) fs.unlink(f.path, () => {});
    }
  }
);

app.get('/api/orders/:code/status', readLimiter, async (req, res) => {
  const drv = getDrive();
  if (!drv) return res.status(503).json({ error: 'drive_not_configured' });
  try {
    const order = await loadOrder(drv, req.params.code);
    if (!order) return res.status(404).json({ error: 'not_found' });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ status: order.status, expiresAt: order.expiresAt });
    cleanup().catch(() => {});
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: 'status_failed' });
  }
});

app.get('/api/orders/:code/download', readLimiter, async (req, res) => {
  const drv = getDrive();
  if (!drv) return res.status(503).json({ error: 'drive_not_configured' });
  try {
    const order = await loadOrder(drv, req.params.code);
    if (!order) return res.status(404).json({ error: 'not_found' });
    const file = resultFile(order.files);
    if (order.status !== 'done' || !file) return res.status(404).json({ error: 'not_ready' });
    const ext = file.name.split('.').pop().toLowerCase();
    const dl = await drv.files.get({ fileId: file.id, alt: 'media' }, { responseType: 'stream' });
    // ?inline=1 để trang hiển thị ảnh xem trước; mặc định là tải xuống.
    const disposition = req.query.inline === '1' ? 'inline' : 'attachment';
    res.setHeader('Content-Type', RESULT_MIME[ext] || 'application/octet-stream');
    res.setHeader('Content-Disposition', `${disposition}; filename="anh-da-chinh-${req.params.code}.${ext}"`);
    res.setHeader('Cache-Control', 'no-store');
    dl.data.on('error', (e) => {
      console.error('download loi:', e.message);
      res.destroy(e);
    });
    dl.data.pipe(res);
  } catch (e) {
    console.error(e.message);
    if (!res.headersSent) res.status(500).json({ error: 'download_failed' });
  }
});

// Lỗi từ multer (file quá lớn, sai loại...) trả JSON để trang hiện thông báo đúng.
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'file_too_large' });
  if (err.code === 'BAD_TYPE') return res.status(400).json({ error: 'bad_type' });
  if (err instanceof multer.MulterError) return res.status(400).json({ error: 'bad_request' });
  console.error(err);
  res.status(500).json({ error: 'server_error' });
});

module.exports = { app, cleanup, describe, museTick, CODE_RE, __setDrive: (d) => { drive = d; } };

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Studio backend chay o cong ${PORT}`));
  // Dọn khi vừa thức dậy và mỗi giờ khi còn thức (Render gói miễn phí hay ngủ).
  setTimeout(() => cleanup(true), 10 * 1000);
  setInterval(() => cleanup(true), 60 * 60 * 1000).unref();
  // Thợ tự động quét đơn mỗi phút khi máy chủ còn thức (phòng đơn bị sót).
  if (AUTO_MUSE) setInterval(() => museTick().catch((e) => console.error(e.message)), 60 * 1000).unref();
}
