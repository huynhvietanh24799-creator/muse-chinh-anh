#!/usr/bin/env node
// Công cụ chỉnh ánh sáng cho Muse. Dùng bộ xử lý ảnh đã kiểm tra trong scripts/lib/pipeline.js.
//
//   npm run relight -- <ảnh vào> <ảnh ra> '<JSON thông số>' [--style <ảnh mẫu>]
//
// Ví dụ:
//   npm run relight -- anh.jpg ket-qua.jpg '{"exposure":0.4,"shadows":40,"highlights":-20}'
//   npm run relight -- anh.jpg ket-qua.jpg '{"lightOn":1,"lightX":0.15,"lightY":0.4,"lightIntensity":60,"lightRadius":45,"lightWarmth":30}'
//   npm run relight -- anh.jpg ket-qua.jpg '{"styleStrength":80}' --style anh-mau.jpg
//
// Thông số (đều tùy chọn; số ngoài khoảng sẽ bị chặn):
//   exposure -3..3 (độ sáng, đơn vị stop)   shadows -100..100 (vùng tối)   highlights -100..100 (vùng sáng)
//   contrast -100..100   temperature -100..100 (lạnh -> ấm)   saturation -100..100   vibrance -100..100
//   vignette 0..100 (tối viền)
//   lightOn 0|1, lightX 0..1, lightY 0..1 (vị trí đèn ảo, 0,0 là góc trên trái), lightIntensity -100..100,
//   lightRadius 10..100, lightWarmth -100..100
//   styleStrength 0..100 (cần --style: đưa tông màu/ánh sáng của ảnh mẫu sang ảnh)
//   auto 1 (tự cân chỉnh độ sáng, vùng tối/sáng, tương phản theo ảnh; thông số khác ghi đè lên)
//   sharpen 0..300, sharpenRadius 0.5..3, sharpenThreshold 0..30, detail -100..100, noise 0..100
const path = require('path');
const fs = require('fs');
const { processImage, labStats, autoParams } = require('./lib/pipeline.js');

const LIMITS = {
  exposure: [-3, 3], shadows: [-100, 100], highlights: [-100, 100], contrast: [-100, 100], temperature: [-100, 100],
  saturation: [-100, 100], vibrance: [-100, 100], vignette: [0, 100], lightOn: [0, 1], lightX: [0, 1], lightY: [0, 1],
  lightIntensity: [-100, 100], lightRadius: [10, 100], lightWarmth: [-100, 100], styleStrength: [0, 100], auto: [0, 1],
  sharpen: [0, 300], sharpenRadius: [0.5, 3], sharpenThreshold: [0, 30], detail: [-100, 100], noise: [0, 100],
};
// Cạnh dài tối đa khi xử lý. Máy chủ miễn phí ít bộ nhớ nên có thể đặt nhỏ hơn: RELIGHT_MAX_EDGE=3000
const MAX_EDGE = Math.min(4096, Number(process.env.RELIGHT_MAX_EDGE) || 4096);

function cleanParams(raw) {
  const out = {};
  for (const [k, v] of Object.entries(raw || {})) {
    if (!LIMITS[k]) throw new Error('Thông số không hợp lệ: ' + k + '. Xem hướng dẫn ở đầu file scripts/relight.js.');
    if (typeof v !== 'number' || !isFinite(v)) throw new Error('Thông số ' + k + ' phải là một số.');
    out[k] = Math.min(LIMITS[k][1], Math.max(LIMITS[k][0], v));
  }
  return out;
}

async function load(sharp, file, maxEdge) {
  const { data, info } = await sharp(file, { failOn: 'error' })
    .rotate() // theo hướng chụp (EXIF)
    .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), w: info.width, h: info.height };
}

async function relight(inFile, outFile, rawParams, styleFile) {
  const sharp = require('sharp');
  const params = cleanParams(rawParams);
  const img = await load(sharp, inFile, MAX_EDGE);
  if (styleFile) {
    const ref = await load(sharp, styleFile, 320);
    const a = labStats(img.data, img.w, img.h);
    const b = labStats(ref.data, ref.w, ref.h);
    params.style = { strength: (params.styleStrength ?? 80) / 100, sm: a.m, ss: a.s, tm: b.m, ts: b.s };
  }
  delete params.styleStrength;
  if (params.auto) {
    const a = autoParams(img.data, img.w, img.h);
    // chỉ lấy phần ánh sáng; thông số người dùng truyền vào được ưu tiên
    for (const k of ['exposure', 'shadows', 'highlights', 'contrast']) if (params[k] === undefined) params[k] = a[k];
  }
  delete params.auto;
  const result = processImage(img.data, img.w, img.h, params);
  const ext = path.extname(outFile).toLowerCase();
  let pipe = sharp(Buffer.from(result.buffer, result.byteOffset, result.length), { raw: { width: img.w, height: img.h, channels: 4 } }).removeAlpha();
  if (ext === '.png') pipe = pipe.png();
  else if (ext === '.webp') pipe = pipe.webp({ quality: 93 });
  else if (ext === '.jpg' || ext === '.jpeg') pipe = pipe.jpeg({ quality: 93, mozjpeg: true });
  else throw new Error('Ảnh ra phải có đuôi .jpg, .png hoặc .webp');
  await pipe.toFile(outFile);
  return { ok: true, output: outFile, width: img.w, height: img.h };
}

module.exports = { relight, cleanParams, LIMITS };

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const si = args.indexOf('--style');
    const style = si >= 0 ? args.splice(si, 2)[1] : null;
    const [inFile, outFile, json] = args;
    if (!inFile || !outFile) {
      console.error("Cách dùng: relight.js <ảnh vào> <ảnh ra> '<JSON thông số>' [--style <ảnh mẫu>]");
      process.exit(2);
    }
    if (!fs.existsSync(inFile)) throw new Error('Không thấy ảnh vào: ' + inFile);
    if (style && !fs.existsSync(style)) throw new Error('Không thấy ảnh mẫu: ' + style);
    let params = {};
    try { params = json ? JSON.parse(json) : {}; } catch (e) { throw new Error('Thông số phải là JSON hợp lệ.'); }
    console.log(JSON.stringify(await relight(inFile, outFile, params, style)));
  })().catch((e) => {
    console.error('Lỗi:', e.message);
    process.exit(1);
  });
}
