// Chạy MỘT LẦN trên máy bạn để lấy GOOGLE_REFRESH_TOKEN.
//   1. Điền GOOGLE_CLIENT_ID và GOOGLE_CLIENT_SECRET vào file .env
//   2. npm run get-token
//   3. Mở link in ra, đăng nhập Gmail của bạn, bấm cho phép
//   4. Khóa được tự ghi vào .env (không in ra màn hình)
const http = require('http');
const { google } = require('googleapis');
const { writeEnv } = require('./envfile.js');

const { GOOGLE_CLIENT_ID: id, GOOGLE_CLIENT_SECRET: secret } = process.env;
if (!id || !secret) {
  console.error('Thiếu GOOGLE_CLIENT_ID hoặc GOOGLE_CLIENT_SECRET trong file .env');
  process.exit(1);
}

const PORT = 53682;
const redirect = `http://localhost:${PORT}`;
const oauth = new google.auth.OAuth2(id, secret, redirect);
const url = oauth.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent', // bắt buộc để Google luôn trả refresh token
  scope: ['https://www.googleapis.com/auth/drive'],
});

const server = http.createServer(async (req, res) => {
  const code = new URL(req.url, redirect).searchParams.get('code');
  if (!code) {
    res.end('Chưa có mã. Hãy mở lại link trong cửa sổ dòng lệnh.');
    return;
  }
  try {
    const { tokens } = await oauth.getToken(code);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('Xong! Quay lại cửa sổ dòng lệnh để copy khóa. Có thể đóng tab này.');
    if (!tokens.refresh_token) {
      console.error('\nGoogle không trả refresh token. Vào https://myaccount.google.com/permissions , gỡ quyền của ứng dụng này rồi chạy lại.');
    } else {
      // Ghi thẳng vào .env, không in ra màn hình (khóa này giống mật khẩu).
      writeEnv('.env', 'GOOGLE_REFRESH_TOKEN', tokens.refresh_token, '.env.example');
      console.log('\nXong! Đã lưu GOOGLE_REFRESH_TOKEN vào file .env (không hiện ra màn hình).');
      console.log('Khi đưa lên Render, mở file .env và copy dòng này vào mục Environment (giữ bí mật như mật khẩu).\n');
    }
  } catch (e) {
    res.end('Lỗi: ' + e.message);
    console.error(e.message);
  }
  server.close();
});

server.listen(PORT, () => {
  console.log('Mở link này trong trình duyệt và đăng nhập bằng Gmail chứa thư mục "Đơn chỉnh ảnh AI":\n');
  console.log(url + '\n');
});
