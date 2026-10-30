const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { relight, cleanParams } = require('./relight.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'relight-'));
async function make(file, rgb, w = 200, h = 120) {
  await sharp({ create: { width: w, height: h, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } }).jpeg().toFile(file);
}
async function mean(file) {
  const { data } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  let s = 0; for (const v of data) s += v; return s / data.length;
}

test('tăng độ sáng làm ảnh sáng hơn; xuất đúng định dạng', async () => {
  const d = tmp();
  await make(path.join(d, 'a.jpg'), [90, 90, 90]);
  const r = await relight(path.join(d, 'a.jpg'), path.join(d, 'b.png'), { exposure: 1 });
  assert.strictEqual(r.ok, true);
  assert.ok((await mean(path.join(d, 'b.png'))) > (await mean(path.join(d, 'a.jpg'))) + 20);
  assert.strictEqual((await sharp(path.join(d, 'b.png')).metadata()).format, 'png');
});

test('đèn ảo bên trái làm bên trái sáng hơn bên phải', async () => {
  const d = tmp();
  await make(path.join(d, 'a.jpg'), [100, 100, 100], 300, 200);
  await relight(path.join(d, 'a.jpg'), path.join(d, 'b.jpg'), { lightOn: 1, lightX: 0.1, lightY: 0.5, lightIntensity: 80, lightRadius: 35 });
  const { data, info } = await sharp(path.join(d, 'b.jpg')).raw().toBuffer({ resolveWithObject: true });
  const px = (x, y) => data[(y * info.width + x) * info.channels];
  assert.ok(px(10, 100) > px(290, 100) + 30, `${px(10, 100)} so với ${px(290, 100)}`);
});

test('chuyển ánh sáng theo ảnh mẫu: ảnh xám nhận tông ấm', async () => {
  const d = tmp();
  await make(path.join(d, 'a.jpg'), [110, 110, 110]);
  await make(path.join(d, 'mau.jpg'), [235, 170, 100]);
  await relight(path.join(d, 'a.jpg'), path.join(d, 'b.jpg'), { styleStrength: 100 }, path.join(d, 'mau.jpg'));
  const { data } = await sharp(path.join(d, 'b.jpg')).raw().toBuffer({ resolveWithObject: true });
  assert.ok(data[0] > data[2] + 25, 'đỏ phải cao hơn xanh dương');
});

test('chặn thông số lạ, chặn số vượt khoảng, đuôi ảnh sai', async () => {
  assert.throws(() => cleanParams({ hack: 1 }), /không hợp lệ/);
  assert.throws(() => cleanParams({ exposure: 'nhieu' }), /phải là một số/);
  assert.strictEqual(cleanParams({ exposure: 99 }).exposure, 3);
  const d = tmp();
  await make(path.join(d, 'a.jpg'), [90, 90, 90]);
  await assert.rejects(() => relight(path.join(d, 'a.jpg'), path.join(d, 'b.gif'), {}), /\.jpg, \.png hoặc \.webp/);
});
