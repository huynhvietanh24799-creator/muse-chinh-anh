// Hỏi từng giá trị cần thiết rồi ghi vào file .env. Khóa bí mật được ẩn khi gõ/dán.
//   npm run setup
const readline = require('readline');
const crypto = require('crypto');
const fs = require('fs');
const { getKey, parseFolderId, isClientId, isClientSecret, writeEnv } = require('./envfile.js');

const ENV = '.env';
const read = () => (fs.existsSync(ENV) ? fs.readFileSync(ENV, 'utf8') : '');

// Một phiên hỏi duy nhất cho cả buổi (nhiều phiên riêng dễ làm mất dòng đã gõ/dán).
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
let muted = false;
const rawWrite = rl._writeToOutput ? rl._writeToOutput.bind(rl) : null;
if (rawWrite) rl._writeToOutput = (s) => rawWrite(muted ? s.replace(/[^\r\n]/g, '*') : s);
const lines = [];
let waiter = null;
let ended = false;
rl.on('line', (l) => { if (waiter) { const w = waiter; waiter = null; w(l); } else lines.push(l); });
rl.on('close', () => { ended = true; if (waiter) { const w = waiter; waiter = null; w(null); } });

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    if (lines.length) return resolve(lines.shift().trim());
    if (ended) return resolve(null);
    muted = hidden;
    waiter = (l) => { muted = false; if (hidden) console.log(''); resolve(l === null ? null : l.trim()); };
  });
}

async function askValid(question, ok, hint, opts) {
  for (;;) {
    const v = await ask(question, opts);
    if (v === null) { console.log('\nKhông nhận được dữ liệu nhập. Hãy chạy lại: npm run setup'); process.exit(1); }
    if (ok(v)) return v;
    console.log('  Chưa đúng: ' + hint + ' Thử lại nhé.');
  }
}

(async () => {
  console.log('Điền thông tin vào file .env. Giá trị bí mật sẽ hiện dấu * khi bạn dán.\n');
  const id = await askValid('1) Client ID (dạng ...apps.googleusercontent.com): ', isClientId, 'Client ID có đuôi .apps.googleusercontent.com.');
  const secret = await askValid('2) Client secret (ẩn khi gõ): ', isClientSecret, 'Client secret là chuỗi dài, thường bắt đầu bằng GOCSPX-.', { hidden: true });
  const folder = parseFolderId(await askValid('3) ID hoặc link thư mục "Đơn chỉnh ảnh AI" trên Drive: ', (v) => !!parseFolderId(v), 'Dán link thư mục Drive hoặc đoạn ID sau /folders/.'));
  const site = (await ask('4) Địa chỉ trang web (để trống nếu chưa có, điền sau): ')) || '';
  rl.close();

  writeEnv(ENV, 'GOOGLE_CLIENT_ID', id, '.env.example');
  writeEnv(ENV, 'GOOGLE_CLIENT_SECRET', secret, '.env.example');
  writeEnv(ENV, 'DRIVE_ROOT_FOLDER_ID', parseFolderId(folder), '.env.example');
  if (site) writeEnv(ENV, 'SITE_URL', site.replace(/\/+$/, ''), '.env.example');
  if (!getKey(read(), 'CLEANUP_KEY')) writeEnv(ENV, 'CLEANUP_KEY', crypto.randomBytes(24).toString('hex'), '.env.example');
  console.log('\nĐã lưu vào .env (chỉ máy bạn đọc được). Bước tiếp theo:  npm run get-token');
})();
