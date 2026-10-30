#!/usr/bin/env node
// Lệnh cho Muse (trợ lý AI) làm việc với Drive. Dùng chung khóa đăng nhập với web (file .env).
//
//   node scripts/muse.js next                   in JSON của đơn cũ nhất đang chờ và tải ảnh về muse-work/<mã>/
//                                               (in {"none":true} nếu không có đơn)
//   node scripts/muse.js done <mã> <file ảnh>   tải ảnh kết quả lên rồi mới đánh dấu xong
//   node scripts/muse.js reject <mã> <lý do>    từ chối đơn (khách thấy "chưa thể thực hiện")
//
// Chạy từ thư mục dự án, ví dụ: cd web-app-anh && npm run muse -- next
const path = require('path');
const { google } = require('googleapis');
const { nextOrder, finishOrder, rejectOrder } = require('./muse-lib.js');

const ROOT = process.env.DRIVE_ROOT_FOLDER_ID || '';
const WORK = path.resolve(process.env.MUSE_WORK_DIR || 'muse-work');
// File dành cho CHỦ SHOP: ai cần được nhắn Zalo, số nào, link nào. Muse (AI) không đọc file này.
const NOTIFY = { file: path.join(WORK, 'CAN-NHAN-ZALO.txt'), siteUrl: process.env.SITE_URL || '' };

function getDrive() {
  const { GOOGLE_CLIENT_ID: id, GOOGLE_CLIENT_SECRET: secret, GOOGLE_REFRESH_TOKEN: token } = process.env;
  if (!id || !secret || !token || !ROOT) {
    throw new Error('Thiếu cấu hình Drive trong file .env (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, DRIVE_ROOT_FOLDER_ID).');
  }
  const auth = new google.auth.OAuth2(id, secret);
  auth.setCredentials({ refresh_token: token });
  return google.drive({ version: 'v3', auth });
}

async function main() {
  const [cmd, a, b] = process.argv.slice(2);
  const drv = getDrive();
  if (cmd === 'next') {
    const o = await nextOrder(drv, ROOT, WORK, { requireApproval: process.env.REQUIRE_APPROVAL === 'true' });
    console.log(JSON.stringify(o || { none: true }, null, 2));
  } else if (cmd === 'done' && a && b) {
    console.log(JSON.stringify(await finishOrder(drv, ROOT, a, path.resolve(b), WORK, NOTIFY)));
  } else if (cmd === 'reject' && a) {
    console.log(JSON.stringify(await rejectOrder(drv, ROOT, a, process.argv.slice(4).join(' '), WORK, NOTIFY)));
  } else {
    console.error('Cách dùng: muse.js next | done <mã> <file> | reject <mã> <lý do>');
    process.exit(2);
  }
}

main().catch((e) => {
  // Ứng dụng Google ở chế độ Testing: khóa đăng nhập hết hạn sau 7 ngày.
  if (/invalid_grant/i.test(String(e && (e.message || e)))) {
    console.error('Lỗi: khóa đăng nhập Drive đã hết hạn (chế độ Testing của Google hết hạn sau 7 ngày). Chủ shop hãy chạy lại: npm run get-token');
  } else {
    console.error('Lỗi:', e.message);
  }
  process.exit(1);
});
