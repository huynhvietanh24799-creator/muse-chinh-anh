// Các thao tác Drive mà Muse cần, tách riêng để kiểm thử được bằng Drive giả.
// Dùng qua lệnh: node scripts/muse.js next | done <mã> <file> | reject <mã> <lý do>
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

const CODE_RE = /^DON-[a-f0-9]{16}$/;
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const MAX_RESULT = 25 * 1024 * 1024;

async function listChildren(drv, folderId) {
  const r = await drv.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id,name,createdTime)',
    pageSize: 100,
  });
  return r.data.files || [];
}

async function findFolder(drv, rootId, code) {
  if (!CODE_RE.test(code)) throw new Error('Mã đơn không đúng dạng.');
  const r = await drv.files.list({
    q: `'${rootId}' in parents and name = '${code}' and mimeType = '${FOLDER_MIME}' and trashed = false`,
    fields: 'files(id,createdTime)',
    pageSize: 1,
  });
  const f = r.data.files[0];
  if (!f) throw new Error('Không tìm thấy đơn ' + code + ' (có thể đã hết hạn và bị xóa).');
  return f;
}

async function download(drv, fileId, dest) {
  const r = await drv.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });
  await pipeline(r.data, fs.createWriteStream(dest));
}

async function readText(drv, fileId) {
  const r = await drv.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });
  const parts = [];
  for await (const c of r.data) parts.push(Buffer.from(c));
  return Buffer.concat(parts).toString('utf8');
}

// Tìm đơn sẵn sàng cũ nhất, tải ảnh về workDir/<mã>/ và trả thông tin để Muse làm.
// Chỉ trả yêu cầu chữ, KHÔNG trả tên hay số điện thoại của khách (Muse không cần).
async function nextOrder(drv, rootId, workDir, { requireApproval = false } = {}) {
  const folders = [];
  let pageToken;
  do {
    const r = await drv.files.list({
      q: `'${rootId}' in parents and mimeType = '${FOLDER_MIME}' and name contains 'DON-' and trashed = false`,
      fields: 'nextPageToken,files(id,name,createdTime)',
      pageSize: 100,
      pageToken,
    });
    folders.push(...(r.data.files || []));
    pageToken = r.data.nextPageToken;
  } while (pageToken);
  folders.sort((a, b) => Date.parse(a.createdTime) - Date.parse(b.createdTime));

  for (const folder of folders) {
    if (!CODE_RE.test(folder.name)) continue;
    const files = await listChildren(drv, folder.id);
    const by = Object.fromEntries(files.map((f) => [f.name, f]));
    // yeu-cau.txt là dấu hiệu "ảnh đã tải đủ"; xong/từ chối thì bỏ qua
    if (!by['yeu-cau.txt'] || by['xong.txt'] || by['tu-choi.txt']) continue;
    if (requireApproval && !by['da-duyet.txt']) continue;
    const photo = files.find((f) => /^anh\.(jpg|png|webp)$/.test(f.name));
    if (!photo) continue;
    const style = files.find((f) => /^anh-mau\.(jpg|png|webp)$/.test(f.name)) || null;

    const dir = path.join(workDir, folder.name);
    fs.mkdirSync(dir, { recursive: true });
    await download(drv, photo.id, path.join(dir, photo.name));
    if (style) await download(drv, style.id, path.join(dir, style.name));
    const note = await readText(drv, by['yeu-cau.txt'].id);
    const request = (note.match(/^Yêu cầu: (.*)$/m) || [])[1] || '';
    return {
      code: folder.name,
      dir,
      photo: path.join(dir, photo.name),
      style: style ? path.join(dir, style.name) : null,
      request: request.startsWith('(không có') ? '' : request,
    };
  }
  return null;
}

// Ghi một dòng vào file "cần nhắn Zalo" để CHỦ SHOP đọc. Số điện thoại chỉ đi vào file này,
// không nằm trong kết quả lệnh nên Muse (AI) không nhìn thấy.
async function noteForOwner(drv, files, notify, kind, code) {
  if (!notify || (!notify.file && !notify.driveRoot)) return;
  try {
    let name = '', phone = '';
    const note = files.find((f) => f.name === 'yeu-cau.txt');
    if (note) {
      const text = await readText(drv, note.id);
      name = (text.match(/^Tên: (.*)$/m) || [])[1] || '';
      phone = (text.match(/^SĐT\/Zalo: (.*)$/m) || [])[1] || '';
    }
    const when = new Date().toLocaleString('sv-SE').slice(0, 16);
    const link = notify.siteUrl ? notify.siteUrl.replace(/\/+$/, '') + '/?don=' + code : code;
    const line = `${when} | ${kind} | ${name} | ${phone} | ${link}\n`;
    if (notify.driveRoot) {
      // Chạy trên máy chủ (ổ đĩa tạm bị xóa khi khởi động lại): ghi thành một file nhỏ trong thư mục Drive gốc.
      await drv.files.create({
        requestBody: { name: `ZALO-${code}.txt`, parents: [notify.driveRoot] },
        media: { mimeType: 'text/plain', body: Readable.from([line]) },
        fields: 'id',
      });
      return;
    }
    fs.mkdirSync(path.dirname(notify.file), { recursive: true });
    fs.appendFileSync(notify.file, line);
  } catch (e) {
    /* không có danh sách nhắn Zalo thì việc làm ảnh vẫn tiếp tục */
  }
}

function sniff(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'png';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

// Tải ảnh kết quả lên, CHỜ tải xong, rồi mới tạo xong.txt (đúng thứ tự web cần).
async function finishOrder(drv, rootId, code, filePath, workDir, notify) {
  const folder = await findFolder(drv, rootId, code);
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size === 0) throw new Error('File kết quả rỗng hoặc không tồn tại.');
  if (stat.size > MAX_RESULT) throw new Error('File kết quả quá lớn (tối đa 25MB).');
  const head = Buffer.alloc(16);
  const fd = fs.openSync(filePath, 'r');
  fs.readSync(fd, head, 0, 16, 0);
  fs.closeSync(fd);
  const ext = sniff(head);
  if (!ext) throw new Error('File kết quả phải là ảnh JPG, PNG hoặc WEBP thật.');

  const files = await listChildren(drv, folder.id);
  if (files.some((f) => f.name === 'xong.txt')) throw new Error('Đơn này đã xong rồi.');
  if (files.some((f) => f.name === 'tu-choi.txt')) throw new Error('Đơn này đã bị từ chối.');
  for (const old of files.filter((f) => /^ket-qua\./i.test(f.name))) await drv.files.delete({ fileId: old.id });

  await drv.files.create({
    requestBody: { name: `ket-qua.${ext}`, parents: [folder.id] },
    media: { mimeType: MIME[ext], body: fs.createReadStream(filePath) },
    fields: 'id',
  });
  await drv.files.create({
    requestBody: { name: 'xong.txt', parents: [folder.id] },
    media: { mimeType: 'text/plain', body: Readable.from([new Date().toISOString() + '\n']) },
    fields: 'id',
  });
  await noteForOwner(drv, files, notify, 'XONG', code);
  if (workDir) fs.rmSync(path.join(workDir, code), { recursive: true, force: true });
  return { code, uploaded: `ket-qua.${ext}` };
}

async function rejectOrder(drv, rootId, code, reason, workDir, notify) {
  const folder = await findFolder(drv, rootId, code);
  const files = await listChildren(drv, folder.id);
  if (files.some((f) => f.name === 'xong.txt')) throw new Error('Đơn này đã xong rồi.');
  const text = String(reason || 'không phù hợp').replace(/[\r\n]+/g, ' ').slice(0, 300) + '\n';
  await drv.files.create({
    requestBody: { name: 'tu-choi.txt', parents: [folder.id] },
    media: { mimeType: 'text/plain', body: Readable.from([text]) },
    fields: 'id',
  });
  await noteForOwner(drv, files, notify, 'TỪ CHỐI', code);
  if (workDir) fs.rmSync(path.join(workDir, code), { recursive: true, force: true });
  return { code, rejected: true };
}

module.exports = { nextOrder, finishOrder, rejectOrder, CODE_RE };
