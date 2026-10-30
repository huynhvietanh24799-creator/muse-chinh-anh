// Đọc/ghi file .env: chỉ đổi đúng dòng cần đổi, giữ nguyên phần còn lại.
const fs = require('fs');

function setKey(text, key, value) {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(text)) return text.replace(re, () => line);
  return text.replace(/\n*$/, '\n') + line + '\n';
}

function getKey(text, key) {
  const m = text.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return m ? m[1].trim() : '';
}

// Nhận ID hoặc cả link Drive dạng .../folders/<ID>?... rồi trả về ID (hoặc '' nếu không hợp lệ).
function parseFolderId(input) {
  const s = String(input || '').trim();
  const m = s.match(/\/folders\/([\w-]{10,})/);
  const id = m ? m[1] : s;
  return /^[\w-]{10,}$/.test(id) ? id : '';
}

const isClientId = (s) => /^\d+-[\w-]+\.apps\.googleusercontent\.com$/.test(String(s).trim());
const isClientSecret = (s) => /^[\w-]{20,}$/.test(String(s).trim());

function writeEnv(file, key, value, template) {
  let text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : (template && fs.existsSync(template) ? fs.readFileSync(template, 'utf8') : '');
  text = setKey(text, key, value);
  fs.writeFileSync(file, text, { mode: 0o600 });
}

module.exports = { setKey, getKey, parseFolderId, isClientId, isClientSecret, writeEnv };
