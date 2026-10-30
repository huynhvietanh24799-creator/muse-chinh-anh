const test = require('node:test');
const assert = require('node:assert');
const { setKey, getKey, parseFolderId, isClientId, isClientSecret } = require('./envfile.js');

test('setKey đổi đúng dòng, giữ phần còn lại, thêm khi chưa có', () => {
  const t = '# ghi chú\nA=1\nGOOGLE_CLIENT_ID=\nB=2\n';
  const r = setKey(t, 'GOOGLE_CLIENT_ID', 'x$y&z');
  assert.strictEqual(r, '# ghi chú\nA=1\nGOOGLE_CLIENT_ID=x$y&z\nB=2\n');
  assert.strictEqual(setKey('A=1', 'NEW', 'v'), 'A=1\nNEW=v\n');
  assert.strictEqual(getKey(r, 'B'), '2');
});

test('parseFolderId nhận ID hoặc link, từ chối rác', () => {
  assert.strictEqual(parseFolderId('1AbCdEfGhIjKlMn'), '1AbCdEfGhIjKlMn');
  assert.strictEqual(parseFolderId('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMn?usp=sharing'), '1AbCdEfGhIjKlMn');
  assert.strictEqual(parseFolderId('abc'), '');
  assert.strictEqual(parseFolderId('xin chao ban'), '');
});

test('kiểm tra dạng Client ID và secret', () => {
  assert.ok(isClientId('1021457625213-6edabc.apps.googleusercontent.com'));
  assert.ok(!isClientId('1021457625213'));
  assert.ok(isClientSecret('GOCSPX-abcdefghijklmnopqrstuvwxyz'));
  assert.ok(!isClientSecret('ngan'));
});
