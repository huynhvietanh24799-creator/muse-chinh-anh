// Bộ xử lý ảnh thuần JavaScript. Chạy trong Web Worker (hoặc luồng chính nếu không có Worker).
//
// processImage phải TỰ CHỨA (không dùng biến bên ngoài): app.js lấy mã nguồn của nó
// bằng processImage.toString() rồi đưa vào Worker.
//
// src : Uint8ClampedArray RGBA (không bị sửa)
// p   : tham số chỉnh (xem DEFAULTS trong app.js). Mọi khóa đều tùy chọn.
// Trả về Uint8ClampedArray RGBA mới.
function processImage(src, w, h, p) {
  const n = w * h;
  const k = Math.max(w, h) / 2000; // bán kính làm nét tính theo ảnh 2000px, quy đổi sang cỡ thật
  const LN2 = Math.LN2;
  const out = new Uint8ClampedArray(src.length);
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  const smooth = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };

  // ---------- Bảng tra sRGB <-> tuyến tính ----------
  const toLin = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    toLin[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  const LS = 4096;
  const toSrgb = new Float32Array(LS + 1);
  for (let i = 0; i <= LS; i++) {
    const l = i / LS;
    toSrgb[i] = l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055;
  }
  // "Vai" mềm ở vùng sáng để ảnh không cháy gắt khi tăng sáng. Chỉ bật khi có tăng sáng,
  // để lúc chưa chỉnh gì thì ảnh giữ nguyên.
  let shoulder = false;
  const enc = (l) => {
    if (l <= 0) return 0;
    if (shoulder && l > 0.85) l = 0.85 + 0.15 * Math.tanh((l - 0.85) / 0.15);
    else if (l > 1) l = 1;
    return toSrgb[(l * LS + 0.5) | 0];
  };

  // ---------- Làm mờ Gauss bằng 3 lần box blur (nhanh, bán kính lớn vẫn rẻ) ----------
  function boxH(a, d, r) {
    const iarr = 1 / (r + r + 1);
    for (let y = 0; y < h; y++) {
      let ti = y * w, li = ti, ri = ti + r;
      const fv = a[ti], lv = a[ti + w - 1];
      let val = (r + 1) * fv;
      for (let j = 0; j < r; j++) val += a[ti + j];
      for (let j = 0; j <= r; j++) { val += a[ri++] - fv; d[ti++] = val * iarr; }
      for (let j = r + 1; j < w - r; j++) { val += a[ri++] - a[li++]; d[ti++] = val * iarr; }
      for (let j = w - r; j < w; j++) { val += lv - a[li++]; d[ti++] = val * iarr; }
    }
  }
  function boxV(a, d, r) {
    const iarr = 1 / (r + r + 1);
    for (let x = 0; x < w; x++) {
      let ti = x, li = ti, ri = ti + r * w;
      const fv = a[ti], lv = a[ti + w * (h - 1)];
      let val = (r + 1) * fv;
      for (let j = 0; j < r; j++) val += a[ti + j * w];
      for (let j = 0; j <= r; j++) { val += a[ri] - fv; ri += w; d[ti] = val * iarr; ti += w; }
      for (let j = r + 1; j < h - r; j++) { val += a[ri] - a[li]; ri += w; li += w; d[ti] = val * iarr; ti += w; }
      for (let j = h - r; j < h; j++) { val += lv - a[li]; li += w; d[ti] = val * iarr; ti += w; }
    }
  }
  // Làm mờ a tại chỗ; tmp là mảng nháp cùng cỡ.
  function gauss(a, tmp, sigma) {
    const passes = 3;
    const wIdeal = Math.sqrt((12 * sigma * sigma) / passes + 1);
    let wl = Math.floor(wIdeal);
    if (wl % 2 === 0) wl--;
    const wu = wl + 2;
    const mIdeal = (12 * sigma * sigma - passes * wl * wl - 4 * passes * wl - 3 * passes) / (-4 * wl - 4);
    const m = Math.round(mIdeal);
    const rMax = Math.max(1, Math.floor((Math.min(w, h) - 1) / 2) - 1);
    for (let i = 0; i < passes; i++) {
      const size = i < m ? wl : wu;
      const r = Math.min(rMax, Math.max(1, (size - 1) / 2));
      boxH(a, tmp, r);
      boxV(tmp, a, r);
    }
  }

  // ---------- Bước 0: chuyển phong cách theo ảnh mẫu (Reinhard, không gian Lab) ----------
  // p.style = { strength 0..1, sm, ss (trung bình/độ lệch ảnh gốc), tm, ts (của ảnh mẫu) }, mỗi cái [L, a, b]
  let input = src;
  const st = p.style;
  if (st && st.strength > 0 && st.sm && st.ss && st.tm && st.ts) {
    input = new Uint8ClampedArray(src.length);
    const mix = Math.min(1, st.strength);
    const gain = [0, 1, 2].map((c) => {
      const g = st.ss[c] < 1 ? 1 : st.ts[c] / st.ss[c];
      return c === 0 ? Math.min(1.6, Math.max(0.6, g)) : Math.min(3, Math.max(0, g));
    });
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const finv = (t) => (t * t * t > 0.008856 ? t * t * t : (t - 16 / 116) / 7.787);
    const encPlain = (l) => (l <= 0 ? 0 : l >= 1 ? 1 : toSrgb[(l * LS + 0.5) | 0]);
    for (let i = 0; i < src.length; i += 4) {
      const r = toLin[src[i]], g = toLin[src[i + 1]], b = toLin[src[i + 2]];
      const fx = f((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047);
      const fy = f(0.2126729 * r + 0.7151522 * g + 0.072175 * b);
      const fz = f((0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883);
      const L = 116 * fy - 16, A = 500 * (fx - fy), B = 200 * (fy - fz);
      const L2 = L + ((L - st.sm[0]) * gain[0] + st.tm[0] - L) * mix;
      const A2 = A + ((A - st.sm[1]) * gain[1] + st.tm[1] - A) * mix;
      const B2 = B + ((B - st.sm[2]) * gain[2] + st.tm[2] - B) * mix;
      const gy = (L2 + 16) / 116, gx = gy + A2 / 500, gz = gy - B2 / 200;
      const X = finv(gx) * 0.95047, Y = finv(gy), Z = finv(gz) * 1.08883;
      input[i] = encPlain(3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z) * 255;
      input[i + 1] = encPlain(-0.969266 * X + 1.8760108 * Y + 0.041556 * Z) * 255;
      input[i + 2] = encPlain(0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z) * 255;
      input[i + 3] = src[i + 3];
    }
  }

  // ---------- Bước 1: tông màu, ánh sáng, màu sắc (từng điểm ảnh) ----------
  const expGain = Math.pow(2, num(p.exposure, 0));
  const temp = num(p.temperature, 0) / 100;
  const rGain = Math.pow(2, temp * 0.4);
  const bGain = Math.pow(2, -temp * 0.4);
  const shadows = num(p.shadows, 0) / 100;
  const highlights = num(p.highlights, 0) / 100;
  const cf = 1 + (num(p.contrast, 0) / 100) * 0.8;
  const sat = 1 + num(p.saturation, 0) / 100;
  const vib = num(p.vibrance, 0) / 100;

  // Đèn ảo: một vùng sáng (hoặc tối) hình tròn mềm đặt tại (lightX, lightY).
  const lStops = (num(p.lightIntensity, 0) / 100) * 2.5;
  const lightOn = !!p.lightOn && lStops !== 0;
  const lx = num(p.lightX, 0.5) * w;
  const ly = num(p.lightY, 0.4) * h;
  const sigmaL = Math.max(1, (num(p.lightRadius, 40) / 100) * Math.hypot(w, h) * 0.5);
  const inv2s = 1 / (2 * sigmaL * sigmaL);
  const lWarm = num(p.lightWarmth, 0) / 100;
  shoulder = expGain > 1 || (lightOn && lStops > 0);
  const vig = num(p.vignette, 0) / 100;
  const vcx = w / 2, vcy = h / 2;

  for (let y = 0, i = 0; y < h; y++) {
    const dy = y - ly;
    const dy2 = dy * dy;
    for (let x = 0; x < w; x++, i += 4) {
      let r = toLin[input[i]] * expGain * rGain;
      let g = toLin[input[i + 1]] * expGain;
      let b = toLin[input[i + 2]] * expGain * bGain;
      if (vig > 0) {
        const vx = (x - vcx) / vcx, vy = (y - vcy) / vcy;
        const vg = Math.exp(-vig * 2.2 * smooth(0.25, 1.8, vx * vx + vy * vy) * LN2);
        r *= vg; g *= vg; b *= vg;
      }
      if (lightOn) {
        const dx = x - lx;
        const f = Math.exp(-(dx * dx + dy2) * inv2s);
        const gain = Math.exp(lStops * f * LN2);
        r *= gain; g *= gain; b *= gain;
        if (lStops > 0 && lWarm !== 0) {
          r *= Math.exp(lWarm * f * 0.2);
          b *= Math.exp(-lWarm * f * 0.2);
        }
      }
      r = enc(r); g = enc(g); b = enc(b);

      if (shadows !== 0 || highlights !== 0) {
        const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const gain = 1 + shadows * 0.9 * (1 - L) * (1 - L) + highlights * 0.6 * L * L;
        const gg = gain < 0.1 ? 0.1 : gain;
        r *= gg; g *= gg; b *= gg;
      }
      if (cf !== 1) {
        r = (r - 0.5) * cf + 0.5;
        g = (g - 0.5) * cf + 0.5;
        b = (b - 0.5) * cf + 0.5;
      }
      if (sat !== 1 || vib !== 0) {
        const L2 = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        let kk = sat * (1 + vib * (1 - Math.min(1, Math.max(0, mx - mn))));
        if (kk < 0) kk = 0;
        r = L2 + (r - L2) * kk;
        g = L2 + (g - L2) * kk;
        b = L2 + (b - L2) * kk;
      }
      out[i] = r * 255;
      out[i + 1] = g * 255;
      out[i + 2] = b * 255;
      out[i + 3] = src[i + 3];
    }
  }

  // ---------- Bước 2: giảm nhiễu, làm nét, chi tiết (theo độ sáng, giữ nguyên màu) ----------
  const noise = num(p.noise, 0) / 100;
  const amount = num(p.sharpen, 0) / 100;
  const detail = num(p.detail, 0) / 100;
  if (noise > 0 || amount > 0 || detail !== 0) {
    const L = new Float32Array(n);
    const B = new Float32Array(n);
    const T = new Float32Array(n);
    const X = new Float32Array(n);
    const lumaFrom = () => {
      for (let j = 0, i = 0; j < n; j++, i += 4) L[j] = 0.2126 * out[i] + 0.7152 * out[i + 1] + 0.0722 * out[i + 2];
    };

    if (noise > 0) {
      // Giảm nhiễu chỉ ở vùng phẳng (ít chi tiết); vùng cạnh giữ nguyên để không bị nhòe.
      lumaFrom();
      B.set(L);
      gauss(B, T, Math.max(0.8, k));
      for (let j = 0; j < n; j++) X[j] = 1 - smooth(3, 20, Math.abs(L[j] - B[j]));
      for (let c = 0; c < 3; c++) {
        for (let j = 0, i = c; j < n; j++, i += 4) B[j] = out[i];
        gauss(B, T, Math.max(1, 1.6 * k));
        for (let j = 0, i = c; j < n; j++, i += 4) {
          const m = noise * X[j];
          out[i] = out[i] * (1 - m) + B[j] * m;
        }
      }
    }

    if (amount > 0 || detail !== 0) {
      lumaFrom();
      X.fill(0);
      if (amount > 0) {
        B.set(L);
        gauss(B, T, Math.max(0.5, num(p.sharpenRadius, 1) * k));
        const th = num(p.sharpenThreshold, 0); // bỏ qua chi tiết nhỏ hơn mức này (nhiễu)
        for (let j = 0; j < n; j++) {
          const d = L[j] - B[j];
          const gate = th > 0 ? smooth(0, th, Math.abs(d)) : 1;
          let a = amount * 1.5 * d * gate;
          if (a > 60) a = 60; else if (a < -60) a = -60; // hạn chế viền sáng (halo)
          X[j] = a;
        }
      }
      if (detail !== 0) {
        B.set(L);
        gauss(B, T, Math.max(2, 0.012 * Math.max(w, h)));
        for (let j = 0; j < n; j++) {
          const t = (2 * L[j]) / 255 - 1;
          X[j] += detail * 0.8 * (L[j] - B[j]) * (1 - t * t); // mạnh ở vùng tông giữa
        }
      }
      for (let j = 0, i = 0; j < n; j++, i += 4) {
        const v = X[j];
        out[i] += v;
        out[i + 1] += v;
        out[i + 2] += v;
      }
    }
  }
  return out;
}

// Trung bình và độ lệch chuẩn của ảnh trong không gian Lab: { m:[L,a,b], s:[L,a,b] }
function labStats(src, w, h) {
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 120000)));
  const lin = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const sum = [0, 0, 0], sq = [0, 0, 0];
  let cnt = 0;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      const r = lin(src[i]), g = lin(src[i + 1]), b = lin(src[i + 2]);
      const fx = f((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047);
      const fy = f(0.2126729 * r + 0.7151522 * g + 0.072175 * b);
      const fz = f((0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883);
      const v = [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
      for (let c = 0; c < 3; c++) { sum[c] += v[c]; sq[c] += v[c] * v[c]; }
      cnt++;
    }
  }
  const m = sum.map((v) => v / cnt);
  const sd = sq.map((v, c) => Math.sqrt(Math.max(0, v / cnt - m[c] * m[c])));
  return { m, s: sd };
}

// Phân tích ảnh và gợi ý các thông số cơ bản (nút "Tự động").
function autoParams(src, w, h) {
  const hist = new Uint32Array(256);
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 250000)));
  let cnt = 0;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      hist[Math.round(0.2126 * src[i] + 0.7152 * src[i + 1] + 0.0722 * src[i + 2])]++;
      cnt++;
    }
  }
  const pct = (q) => {
    let acc = 0;
    for (let i = 0; i < 256; i++) {
      acc += hist[i];
      if (acc >= q * cnt) return i / 255;
    }
    return 1;
  };
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const r0 = (v) => Math.round(v);
  const r2 = (v) => Math.round(v * 100) / 100;
  const p05 = pct(0.05), p50 = pct(0.5), p95 = pct(0.95);

  let exposure = p50 > 0.01 ? 2.2 * Math.log2(0.46 / p50) : 1.5;
  exposure = clamp(exposure * 0.75, -1.5, 1.5);
  const gm = Math.pow(2, exposure / 2.2); // gần đúng ảnh hưởng của độ sáng lên percentile (không gian gamma)
  const q05 = Math.min(1, p05 * gm);
  const q95 = Math.min(1, p95 * gm);
  const shadows = clamp((0.14 - q05) * 400, 0, 70);
  const highlights = -clamp((q95 - 0.88) * 600, 0, 60);
  const spread = q95 - q05;
  const contrast = spread < 0.65 ? clamp((0.65 - spread) * 100, 0, 30) : 0;
  return {
    exposure: r2(exposure),
    shadows: r0(shadows),
    highlights: r0(highlights),
    contrast: r0(contrast),
    vibrance: 18,
    sharpen: 50,
  };
}

if (typeof module !== 'undefined') module.exports = { processImage, autoParams, labStats };
