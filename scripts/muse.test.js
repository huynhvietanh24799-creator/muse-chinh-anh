const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { makeDrive } = require('../server/fake-drive.js');
const { nextOrder, finishOrder, rejectOrder } = require('./muse-lib.js');

const DIR = 'application/vnd.google-apps.folder';
const H = 3600 * 1000;
const iso = (ago) => new Date(Date.now() - ago * H).toISOString();
const JPEG = Buffer.from('ffd8ffe000104a464946', 'hex');
const PNG = Buffer.from('89504e470d0a1a0a0000', 'hex');

function seedDrive() {
  const f = (id, name, parent, ago, content = Buffer.alloc(0)) => ({ id, name, parents: parent ? [parent] : [], mime: name.startsWith('DON-') ? DIR : '', createdTime: iso(ago), content });
  return makeDrive([
    f('ROOT', 'Đơn chỉnh ảnh AI', null, 99),
    // cũ nhất nhưng ảnh chưa tải đủ (chưa có yeu-cau.txt) -> phải bỏ qua
    f('o1', 'DON-1111111111111111', 'ROOT', 10), f('o1a', 'anh.jpg', 'o1', 10, JPEG),
    // sẵn sàng, cũ nhất trong các đơn sẵn sàng
    f('o2', 'DON-2222222222222222', 'ROOT', 8), f('o2a', 'anh.jpg', 'o2', 8, JPEG), f('o2b', 'anh-mau.png', 'o2', 8, PNG),
    f('o2c', 'yeu-cau.txt', 'o2', 8, Buffer.from('Yêu cầu: sáng hơn, tông ấm\nẢnh phong cách: có (anh-mau)\nTên: An\nSĐT/Zalo: 0900000000\n')),
    // sẵn sàng nhưng mới hơn
    f('o3', 'DON-3333333333333333', 'ROOT', 2), f('o3a', 'anh.png', 'o3', 2, PNG),
    f('o3c', 'yeu-cau.txt', 'o3', 2, Buffer.from('Yêu cầu: (không có, làm theo ảnh phong cách)\nẢnh phong cách: không\n')),
    // đã xong -> bỏ qua
    f('o4', 'DON-4444444444444444', 'ROOT', 12), f('o4a', 'anh.jpg', 'o4', 12, JPEG), f('o4c', 'yeu-cau.txt', 'o4', 12), f('o4x', 'xong.txt', 'o4', 11),
  ]);
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'muse-'));

test('next: chọn đơn sẵn sàng cũ nhất, tải ảnh, không lộ tên/số điện thoại', async () => {
  const drive = seedDrive();
  const work = tmp();
  const o = await nextOrder(drive, 'ROOT', work);
  assert.strictEqual(o.code, 'DON-2222222222222222');
  assert.strictEqual(o.request, 'sáng hơn, tông ấm');
  assert.ok(fs.existsSync(o.photo) && fs.existsSync(o.style));
  assert.deepStrictEqual(fs.readFileSync(o.photo), JPEG);
  assert.ok(!JSON.stringify(o).includes('0900000000') && !JSON.stringify(o).includes('"An"'));
});

test('next: đơn chỉ có ảnh phong cách thì request rỗng, style null nếu không có', async () => {
  const drive = seedDrive();
  drive.store.splice(drive.store.findIndex((f) => f.id === 'o2'), 1); // bỏ đơn 2
  const o = await nextOrder(drive, 'ROOT', tmp());
  assert.strictEqual(o.code, 'DON-3333333333333333');
  assert.strictEqual(o.request, '');
  assert.strictEqual(o.style, null);
});

test('next: không có đơn nào thì trả null; bật duyệt đơn thì bỏ qua đơn chưa duyệt', async () => {
  const drive = seedDrive();
  assert.strictEqual(await nextOrder(drive, 'ROOT', tmp(), { requireApproval: true }), null);
  drive.store.push({ id: 'ap', name: 'da-duyet.txt', parents: ['o3'], mime: '', createdTime: iso(1), content: Buffer.alloc(0) });
  assert.strictEqual((await nextOrder(drive, 'ROOT', tmp(), { requireApproval: true })).code, 'DON-3333333333333333');
});

test('done: tải ảnh lên TRƯỚC rồi mới tạo xong.txt; dọn thư mục làm việc', async () => {
  const drive = seedDrive();
  const work = tmp();
  const o = await nextOrder(drive, 'ROOT', work);
  const out = path.join(work, 'sau-khi-chinh.jpg');
  fs.writeFileSync(out, Buffer.concat([JPEG, Buffer.from('noi dung anh')]));
  drive.created.length = 0;
  const r = await finishOrder(drive, 'ROOT', o.code, out, work);
  assert.strictEqual(r.uploaded, 'ket-qua.jpg');
  assert.deepStrictEqual(drive.created, ['ket-qua.jpg', 'xong.txt']);
  assert.ok(!fs.existsSync(o.dir));
  // làm lại lần nữa thì báo đã xong
  await assert.rejects(() => finishOrder(drive, 'ROOT', o.code, out, work), /đã xong/);
});

test('done: từ chối file không phải ảnh thật, file rỗng, mã sai', async () => {
  const drive = seedDrive();
  const work = tmp();
  const txt = path.join(work, 'x.jpg');
  fs.writeFileSync(txt, 'day khong phai anh that su, chi la chu');
  await assert.rejects(() => finishOrder(drive, 'ROOT', 'DON-2222222222222222', txt, work), /ảnh JPG, PNG hoặc WEBP thật/);
  const empty = path.join(work, 'e.jpg');
  fs.writeFileSync(empty, '');
  await assert.rejects(() => finishOrder(drive, 'ROOT', 'DON-2222222222222222', empty, work), /rỗng/);
  await assert.rejects(() => finishOrder(drive, 'ROOT', "DON-1' or name contains '", txt, work), /không đúng dạng/);
  await assert.rejects(() => finishOrder(drive, 'ROOT', 'DON-9999999999999999', txt, work), /Không tìm thấy/);
  assert.ok(!drive.created.includes('xong.txt'));
});

test('reject: tạo tu-choi.txt và đơn không còn được giao nữa', async () => {
  const drive = seedDrive();
  const work = tmp();
  await rejectOrder(drive, 'ROOT', 'DON-2222222222222222', 'ảnh mạo danh\nngười khác', work);
  const note = drive.store.find((f) => f.name === 'tu-choi.txt');
  assert.ok(note);
  assert.strictEqual(note.content.toString().includes('\n', 0) && note.content.toString().trim().includes('\n'), false, 'lý do phải gọn một dòng');
  const next = await nextOrder(drive, 'ROOT', work);
  assert.strictEqual(next.code, 'DON-3333333333333333');
});

test('done/reject: ghi sẵn dòng "cần nhắn Zalo" cho chủ shop, kết quả lệnh không lộ số điện thoại', async () => {
  const drive = seedDrive();
  const work = tmp();
  const notify = { file: path.join(work, 'CAN-NHAN-ZALO.txt'), siteUrl: 'https://muse.example.com/' };
  const o = await nextOrder(drive, 'ROOT', work);
  const out = path.join(work, 'kq.jpg');
  fs.writeFileSync(out, Buffer.concat([JPEG, Buffer.from('anh')]));
  const r = await finishOrder(drive, 'ROOT', o.code, out, work, notify);
  assert.ok(!JSON.stringify(r).includes('0900000000'), 'kết quả lệnh không được chứa số điện thoại');
  await rejectOrder(drive, 'ROOT', 'DON-3333333333333333', 'không phù hợp', work, notify);
  const lines = fs.readFileSync(notify.file, 'utf8').trim().split('\n');
  assert.strictEqual(lines.length, 2);
  assert.match(lines[0], /\| XONG \| An \| 0900000000 \| https:\/\/muse\.example\.com\/\?don=DON-2222222222222222$/);
  assert.match(lines[1], /\| TỪ CHỐI \|/);
});
