#!/usr/bin/env node
// Chạy thợ tự động ngay trên máy bạn (không cần web chạy, không cần Claude):
//   npm run muse-auto            làm hết các đơn đang chờ rồi dừng
//   npm run muse-auto -- --watch quét lại mỗi 60 giây cho đến khi bạn bấm Ctrl+C
// Dùng chung file .env với web. Danh sách cần nhắn Zalo ghi vào muse-work/CAN-NHAN-ZALO.txt.
const path = require('path');
const { google } = require('googleapis');
const { tick } = require('../server/auto-muse.js');

const ROOT = process.env.DRIVE_ROOT_FOLDER_ID || '';
const WORK = path.resolve(process.env.MUSE_WORK_DIR || 'muse-work');
const notify = { file: path.join(WORK, 'CAN-NHAN-ZALO.txt'), siteUrl: process.env.SITE_URL || '' };

function getDrive() {
  const { GOOGLE_CLIENT_ID: id, GOOGLE_CLIENT_SECRET: secret, GOOGLE_REFRESH_TOKEN: token } = process.env;
  if (!id || !secret || !token || !ROOT) throw new Error('Thiếu cấu hình Drive trong file .env.');
  const auth = new google.auth.OAuth2(id, secret);
  auth.setCredentials({ refresh_token: token });
  return google.drive({ version: 'v3', auth });
}

async function once(drv) {
  let n = 0;
  for (;;) {
    const r = await tick(drv, ROOT, { workDir: WORK, notify, requireApproval: process.env.REQUIRE_APPROVAL === 'true', maxEdge: 4096 });
    if (!r || r.none || r.busy || r.error) { if (r && r.error) console.error('Lỗi:', r.error); return n; }
    n++;
    console.log(r.done ? `Xong ${r.code}` : `Từ chối ${r.code}${r.reason ? ' (' + r.reason + ')' : ''}`);
  }
}

(async () => {
  const drv = getDrive();
  const watch = process.argv.includes('--watch');
  do {
    const n = await once(drv);
    if (!watch) console.log(n ? `Đã làm ${n} đơn.` : 'Không có đơn nào đang chờ.');
    if (watch) await new Promise((r) => setTimeout(r, 60000));
  } while (watch);
})().catch((e) => {
  if (/invalid_grant/i.test(String(e.message))) console.error('Lỗi: khóa đăng nhập Drive đã hết hạn (chế độ Testing hết hạn sau 7 ngày). Chạy lại: npm run get-token');
  else console.error('Lỗi:', e.message);
  process.exit(1);
});
