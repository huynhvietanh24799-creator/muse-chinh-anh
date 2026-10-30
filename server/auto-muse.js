// Thợ tự động: thay Muse (AI) bằng chương trình chạy một mình, không cần Claude.
// Nhận đơn từ Drive, hiểu yêu cầu bằng bộ luật tiếng Việt, chỉnh ánh sáng bằng scripts/relight.js
// (chạy ở tiến trình riêng để không làm đơ máy chủ web), nộp ảnh rồi đánh dấu xong.
//
// Ưu điểm: không tốn lượt dùng AI, không bị khách "ra lệnh" qua yêu cầu (chương trình không làm theo chữ nào cả).
// Hạn chế: chỉ hiểu các yêu cầu về ánh sáng/màu đã có trong bộ luật; không tự đánh giá nội dung ảnh.
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { nextOrder, finishOrder, rejectOrder } = require('../scripts/muse-lib.js');
const { interpret } = require('../scripts/lib/intent.js');
const { LIMITS } = require('../scripts/relight.js');

const RELIGHT = path.join(__dirname, '..', 'scripts', 'relight.js');
// Dịch vụ chỉ chỉnh ánh sáng và tông màu: bỏ các thay đổi về độ nét, chi tiết, nhiễu.
const LIGHT_KEYS = ['exposure', 'shadows', 'highlights', 'contrast', 'temperature', 'saturation', 'vibrance', 'vignette'];
const LIGHT_SET_KEYS = ['lightOn', 'lightX', 'lightY', 'lightIntensity', 'lightRadius', 'lightWarmth'];

// Đổi yêu cầu thành thông số chỉnh ánh sáng.
//   action 'process': chỉnh ảnh với params
//   action 'reject' : từ chối với reason (yêu cầu hoàn toàn ngoài phạm vi ánh sáng)
function decide(request, hasStyle) {
  const r = interpret(request);
  const params = {};
  for (const k of LIGHT_KEYS) if (r.delta[k]) params[k] = r.delta[k];
  for (const k of LIGHT_SET_KEYS) if (r.set[k] !== undefined) params[k] = r.set[k];
  if (hasStyle) params.styleStrength = 80;
  for (const k of Object.keys(params)) params[k] = Math.min(LIMITS[k][1], Math.max(LIMITS[k][0], params[k]));

  if (Object.keys(params).length === 0) {
    if (r.unsupported.length) return { action: 'reject', reason: 'Yêu cầu ngoài phạm vi chỉnh ánh sáng: ' + r.unsupported.join(', ') };
    return { action: 'process', params: { auto: 1 }, notes: ['không hiểu yêu cầu, đã cân chỉnh tự động'] };
  }
  return { action: 'process', params, notes: r.notes };
}

function runRelight(inFile, outFile, params, styleFile, maxEdge) {
  const args = [RELIGHT, inFile, outFile, JSON.stringify(params)];
  if (styleFile) args.push('--style', styleFile);
  return new Promise((resolve, reject) => {
    execFile(process.execPath, args, { timeout: 120000, env: { ...process.env, RELIGHT_MAX_EDGE: String(maxEdge) } }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message).trim().slice(0, 300)));
      resolve(stdout);
    });
  });
}

let busy = false;

// Làm một đơn. Trả về { none } | { code, done } | { code, rejected } | { error }.
async function tick(drv, rootId, opts = {}) {
  if (busy) return { busy: true };
  busy = true;
  const workDir = opts.workDir || path.join(os.tmpdir(), 'muse-work');
  let order = null;
  try {
    order = await nextOrder(drv, rootId, workDir, { requireApproval: !!opts.requireApproval });
    if (!order) return { none: true };
    const d = decide(order.request, !!order.style);
    if (d.action === 'reject') {
      await rejectOrder(drv, rootId, order.code, d.reason, workDir, opts.notify);
      return { code: order.code, rejected: true, reason: d.reason };
    }
    const out = path.join(order.dir, 'ket-qua.jpg');
    await runRelight(order.photo, out, d.params, order.style, opts.maxEdge || 3000);
    await finishOrder(drv, rootId, order.code, out, workDir, opts.notify);
    return { code: order.code, done: true, notes: d.notes };
  } catch (e) {
    // Một đơn hỏng (ảnh lỗi...) không được chặn cả hàng đợi: từ chối đơn đó để các đơn sau còn được làm.
    console.error('auto-muse loi:', e.message);
    if (order) {
      try {
        await rejectOrder(drv, rootId, order.code, 'Không xử lý được ảnh này', workDir, opts.notify);
        return { code: order.code, rejected: true, error: e.message };
      } catch (e2) {
        console.error('auto-muse khong tu choi duoc:', e2.message);
      }
    }
    return { error: e.message };
  } finally {
    busy = false;
  }
}

module.exports = { tick, decide };
