// Chạy: npm test  (dùng Drive giả, không cần tài khoản thật)
const test = require('node:test');
const assert = require('node:assert');
process.env.DRIVE_ROOT_FOLDER_ID = 'ROOT'; // phải đặt trước khi nạp server
process.env.ORDER_LIMIT_PER_HOUR = '100';
const { app, cleanup, CODE_RE, __setDrive } = require('./index.js');

const H = 3600 * 1000;
const iso = (hoursAgo) => new Date(Date.now() - hoursAgo * H).toISOString();

const { makeDrive } = require('./fake-drive.js');

const png = () => new Blob([Buffer.from('89504e470d0a1a0a', 'hex')], { type: 'image/png' });
const jpg = () => new Blob([Buffer.from('ffd8ffe0', 'hex')], { type: 'image/jpeg' });

async function withServer(fn) {
  const server = app.listen(0);
  try { await fn(`http://localhost:${server.address().port}`); } finally { server.close(); }
}

test('CODE_RE chỉ nhận mã đúng dạng', () => {
  assert.ok(CODE_RE.test('DON-0123456789abcdef'));
  assert.ok(!CODE_RE.test('DON-123456'));
  assert.ok(!CODE_RE.test("DON-0123456789abcdef' or name contains '"));
});

test('cả luồng: gửi đơn -> đang xử lý -> Muse trả ảnh -> khách tải -> tự dọn', async () => {
  const drive = makeDrive([{ id: 'ROOT', name: 'Đơn chỉnh ảnh AI', mime: 'application/vnd.google-apps.folder' }]);
  __setDrive(drive);
  await withServer(async (base) => {
    // 1. Khách gửi ảnh + ảnh phong cách + yêu cầu
    const fd = new FormData();
    fd.append('photo', jpg(), 'chan-dung.jpg');
    fd.append('style', png(), 'mau.png');
    fd.append('request', 'Làm sáng, tông ấm như ảnh mẫu');
    fd.append('name', 'An');
    fd.append('phone', '0900000000');
    fd.append('consent', '1');
    const r = await fetch(`${base}/api/orders`, { method: 'POST', body: fd });
    assert.strictEqual(r.status, 200);
    const { orderCode } = await r.json();
    assert.ok(CODE_RE.test(orderCode));
    // thứ tự tạo: thư mục, ảnh, ảnh mẫu, rồi yeu-cau.txt cuối cùng
    assert.deepStrictEqual(drive.created, [orderCode, 'anh.jpg', 'anh-mau.png', 'yeu-cau.txt']);
    const folder = drive.store.find((f) => f.name === orderCode);
    assert.deepStrictEqual(folder.parents, ['ROOT']);
    const note = drive.store.find((f) => f.name === 'yeu-cau.txt').content.toString('utf8');
    assert.match(note, /Làm sáng, tông ấm như ảnh mẫu/);
    assert.match(note, /Ảnh phong cách: có/);

    // 2. Đang xử lý
    let s = await (await fetch(`${base}/api/orders/${orderCode}/status`)).json();
    assert.strictEqual(s.status, 'processing');
    assert.strictEqual((await fetch(`${base}/api/orders/${orderCode}/download`)).status, 404);

    // 3. Muse tải kết quả lên rồi mới tạo xong.txt
    const put = (name, content) => drive.store.push({ id: 'm' + name, name, parents: [folder.id], mime: '', content: Buffer.from(content), createdTime: new Date().toISOString() });
    put('ket-qua.jpg', 'ANH-DA-CHINH');
    s = await (await fetch(`${base}/api/orders/${orderCode}/status`)).json();
    assert.strictEqual(s.status, 'processing', 'chưa có xong.txt thì chưa tính là xong');
    put('xong.txt', 'ok');
    s = await (await fetch(`${base}/api/orders/${orderCode}/status`)).json();
    assert.strictEqual(s.status, 'done');
    assert.ok(Date.parse(s.expiresAt) > Date.now());

    // 4. Khách tải về / xem trước
    const dl = await fetch(`${base}/api/orders/${orderCode}/download`);
    assert.strictEqual(dl.status, 200);
    assert.strictEqual(dl.headers.get('content-type'), 'image/jpeg');
    assert.match(dl.headers.get('content-disposition'), /^attachment/);
    assert.strictEqual(await dl.text(), 'ANH-DA-CHINH');
    const inline = await fetch(`${base}/api/orders/${orderCode}/download?inline=1`);
    assert.match(inline.headers.get('content-disposition'), /^inline/);
    await inline.arrayBuffer();

    // 5. Dọn dẹp: đơn xong thì xóa ảnh gốc, ảnh mẫu, yeu-cau.txt nhưng giữ kết quả
    await cleanup(true);
    const names = drive.store.filter((f) => f.parents.includes(folder.id)).map((f) => f.name).sort();
    assert.deepStrictEqual(names, ['ket-qua.jpg', 'xong.txt']);
  });
});

test('xong.txt đến trước ảnh kết quả thì chưa tính là xong; bị từ chối thì báo từ chối', async () => {
  const dir = 'application/vnd.google-apps.folder';
  const mk = (id, name, parent, ago) => ({ id, name, parents: parent ? [parent] : [], mime: name.startsWith('DON-') ? dir : '', createdTime: iso(ago) });
  const drive = makeDrive([
    { id: 'ROOT', name: 'Đơn chỉnh ảnh AI', mime: dir },
    mk('a', 'DON-aaaaaaaaaaaaaaaa', 'ROOT', 2), mk('a1', 'xong.txt', 'a', 1),
    mk('b', 'DON-bbbbbbbbbbbbbbbb', 'ROOT', 2), mk('b1', 'tu-choi.txt', 'b', 1), mk('b2', 'anh.jpg', 'b', 2),
  ]);
  __setDrive(drive);
  await withServer(async (base) => {
    const st = async (c) => (await fetch(`${base}/api/orders/${c}/status`)).json();
    assert.strictEqual((await st('DON-aaaaaaaaaaaaaaaa')).status, 'processing');
    assert.strictEqual((await st('DON-bbbbbbbbbbbbbbbb')).status, 'rejected');
  });
  await cleanup(true);
  assert.ok(!drive.store.some((f) => f.id === 'b2'), 'đơn bị từ chối: ảnh gốc phải bị xóa ngay');
  assert.ok(drive.store.some((f) => f.id === 'b1'));
});

test('chỉ có yêu cầu chữ (không ảnh mẫu) vẫn nhận; không có gì thì từ chối', async () => {
  const drive = makeDrive([{ id: 'ROOT', name: 'Đơn chỉnh ảnh AI', mime: 'application/vnd.google-apps.folder' }]);
  __setDrive(drive);
  await withServer(async (base) => {
    const ok = new FormData();
    ok.append('photo', jpg(), 'a.jpg');
    ok.append('request', 'nét hơn');
    ok.append('consent', '1');
    const r1 = await fetch(`${base}/api/orders`, { method: 'POST', body: ok });
    assert.strictEqual(r1.status, 200);
    assert.ok(!drive.created.includes('anh-mau.png'));

    const none = new FormData();
    none.append('photo', jpg(), 'a.jpg');
    none.append('consent', '1');
    const r2 = await fetch(`${base}/api/orders`, { method: 'POST', body: none });
    assert.strictEqual(r2.status, 400);
    assert.strictEqual((await r2.json()).error, 'need_request');
  });
});

test('từ chối: thiếu ảnh, thiếu đồng ý, sai loại file, mã sai', async () => {
  __setDrive(makeDrive([{ id: 'ROOT', name: 'x', mime: 'application/vnd.google-apps.folder' }]));
  await withServer(async (base) => {
    const post = (fd) => fetch(`${base}/api/orders`, { method: 'POST', body: fd }).then(async (r) => [r.status, (await r.json()).error]);
    assert.deepStrictEqual(await post(new FormData()), [400, 'missing_files']);

    const noConsent = new FormData();
    noConsent.append('photo', jpg(), 'a.jpg');
    noConsent.append('request', 'sáng hơn');
    assert.deepStrictEqual(await post(noConsent), [400, 'need_consent']);

    const bad = new FormData();
    bad.append('photo', new Blob(['x'], { type: 'text/plain' }), 'a.txt');
    assert.deepStrictEqual(await post(bad), [400, 'bad_type']);

    assert.strictEqual((await fetch(`${base}/api/orders/DON-12345/status`)).status, 404);
    assert.strictEqual((await fetch(`${base}/api/orders/DON-aaaaaaaaaaaaaaaa/status`)).status, 404);
  });
});

test('cleanup xóa đơn quá hạn, giữ đơn còn hạn và đơn mới xong', async () => {
  const dir = 'application/vnd.google-apps.folder';
  const drive = makeDrive([
    { id: 'ROOT', name: 'Đơn chỉnh ảnh AI', mime: dir },
    { id: 'old', name: 'DON-aaaaaaaaaaaaaaaa', mime: dir, parents: ['ROOT'], createdTime: iso(60) },
    { id: 'o1', name: 'anh.jpg', parents: ['old'], createdTime: iso(60) },
    { id: 'new', name: 'DON-bbbbbbbbbbbbbbbb', mime: dir, parents: ['ROOT'], createdTime: iso(5) },
    { id: 'n1', name: 'anh.jpg', parents: ['new'], createdTime: iso(5) },
    // tạo từ 70 giờ trước nhưng mới xong 1 giờ trước -> phải giữ
    { id: 'late', name: 'DON-dddddddddddddddd', mime: dir, parents: ['ROOT'], createdTime: iso(70) },
    { id: 'l1', name: 'ket-qua.png', parents: ['late'], createdTime: iso(1) },
    { id: 'l2', name: 'xong.txt', parents: ['late'], createdTime: iso(1) },
    // tên lạ trong thư mục gốc: không được đụng tới
    { id: 'alien', name: 'DON-khong-phai-cua-minh', mime: dir, parents: ['ROOT'], createdTime: iso(900) },
  ]);
  __setDrive(drive);
  const stats = await cleanup(true);
  assert.strictEqual(stats.deleted, 1);
  assert.deepStrictEqual(drive.deleted, ['old']);
  assert.ok(drive.store.some((f) => f.id === 'alien'));
  assert.ok(drive.store.some((f) => f.id === 'l1'));
});
