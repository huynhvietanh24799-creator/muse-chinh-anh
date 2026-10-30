// Hiểu yêu cầu tiếng Việt (có dấu hoặc không dấu) về ánh sáng, màu sắc và độ nét,
// rồi đổi thành các thay đổi cho thanh chỉnh. Chạy hoàn toàn trên máy, không gọi AI nào bên ngoài.
//
// interpret(text) trả về:
//   delta       : { khóa: số } cộng thêm vào mức hiện tại
//   set         : { khóa: giá trị } đặt thẳng (vị trí đèn ảo...)
//   notes       : [chuỗi] những gì đã hiểu, để hiện cho người dùng
//   unsupported : [chuỗi] những việc yêu cầu mà app chưa làm được
function interpret(text) {
  let t = String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
  t = t.replace(/[^a-z0-9&\s,;.]/g, ' ').replace(/\s+/g, ' ');
  // "giảm nhiễu" không được hiểu nhầm là từ nhấn mạnh "nhiều"
  t = t.replace(/\b(giam|khu|bot|loai bo)\s+(nhieu|noise|hat)\b/g, ' khunhieu ').replace(/\bnhieu hat\b/g, ' khunhieu ');
  t = ' ' + t + ' ';

  const delta = {};
  const set = {};
  const notes = [];
  const unsupported = [];
  const add = (d, mod) => { for (const k in d) delta[k] = (delta[k] || 0) + d[k] * mod; };

  const UNSUPPORTED = [
    [/\b(doi nen|thay nen|xoa nen|tach nen|nen khac)\b/, 'đổi hoặc xóa nền'],
    [/\b(xoa|bo|go) (vat|nguoi|logo|chu|watermark|mun|tui|ban)\b/, 'xóa vật thể, người hoặc chữ'],
    [/\b(them|ghep) (vat|nguoi|chu|logo|hinh)\b/, 'thêm vật thể hoặc ghép ảnh'],
    [/\b(doi mat|thay mat|sua mat|lam dep da|lam dep mat|thon gon|thay quan ao|thay trang phuc)\b/, 'chỉnh khuôn mặt, dáng người hoặc trang phục'],
    [/\b(anime|hoat hinh|tranh ve|tranh son dau|ve lai|tao anh|bien thanh)\b/, 'biến ảnh thành tranh/hoạt hình hoặc tạo ảnh mới'],
    [/\b(upscale|phong to|4k|8k|tang do phan giai)\b/, 'phóng to tăng độ phân giải bằng AI'],
  ];
  for (const [re, label] of UNSUPPORTED) if (re.test(t)) unsupported.push(label);

  // Mức nhấn mạnh: nhìn vài từ trước/sau cụm khớp, trong cùng một vế câu.
  function modifier(idx, len) {
    const before = t.slice(Math.max(0, idx - 16), idx).split(/[,;.]/).pop();
    const after = t.slice(idx + len, idx + len + 14).split(/[,;.]/)[0];
    const near = before + ' ' + after;
    if (/\b(hoi|nhe|chut|chut xiu|it)\b/.test(near)) return 0.5;
    if (/\b(rat|nhieu|manh|cuc|sieu|qua|that)\b/.test(near)) return 1.6;
    return 1;
  }

  const RULES = [
    [/\b(sang hon|tang sang|lam sang|sang len|sang them|sang ra)\b/, 'Tăng độ sáng', { exposure: 0.5 }],
    [/\b(toi hon|giam sang|lam toi|toi bot|bot sang|toi di)\b/, 'Giảm độ sáng', { exposure: -0.5 }],
    [/\b(nguoc sang|cuu vung toi|vung toi|backlit|toi mat|toi mat nguoi)\b/, 'Cứu vùng tối, kéo lại vùng sáng gắt', { shadows: 55, highlights: -30, exposure: 0.15 }],
    [/\b(thieu sang|anh toi|chup dem|ban dem|low light|toi qua)\b/, 'Tăng sáng ảnh thiếu sáng và giảm nhiễu', { exposure: 0.7, shadows: 35, highlights: -15, noise: 35 }],
    [/\b(chay sang|bi chay|qua sang|thua sang|overexpos)\w*\b/, 'Hạ vùng quá sáng', { exposure: -0.4, highlights: -45 }],
    [/\b(sieu net|sac net|ro net|net hon|lam net|net len|net anh|bi mo|anh mo|mo qua|chi tiet hon|sharp)\w*\b/, 'Làm nét ảnh', { sharpen: 80, detail: 20, sharpenThreshold: 3 }],
    [/\b(khunhieu|min mang|sach hat|bot hat|giam noise|hat li ti)\b/, 'Giảm nhiễu hạt', { noise: 50 }],
    [/\b(am ap|am hon|tong am|nang vang|hoang hon|golden|mau am|am)\b/, 'Tông màu ấm hơn', { temperature: 30, saturation: 6 }],
    [/\b(lanh hon|mat mat|tong lanh|tong mat|mau lanh|lanh|xanh lanh)\b/, 'Tông màu lạnh hơn', { temperature: -30 }],
    [/\b(tuoi hon|ruc ro|sac so|bao hoa|mau dam|dam mau|tuoi tan|mau sac hon|vibrant)\b/, 'Màu tươi hơn', { saturation: 18, vibrance: 25 }],
    [/\b(nhat mau|phai mau|bot mau|giam mau|mau nhat|diu mau|bot sac so)\b/, 'Màu dịu hơn', { saturation: -22 }],
    [/\b(den trang|trang den|b&w|bw|monochrome|mono)\b/, 'Chuyển đen trắng', { saturation: -100 }],
    [/\b(vintage|co dien|hoai co|film|phim cu|retro)\b/, 'Phong cách cổ điển', { saturation: -15, temperature: 20, contrast: -8, highlights: -10 }],
    [/\b(dien anh|cinematic|phim dien anh|kieu phim)\b/, 'Phong cách điện ảnh', { contrast: 25, saturation: -8, temperature: -8, highlights: -15, shadows: 10, vignette: 25 }],
    [/\b(tuong phan|noi bat|co chieu sau|dam net|contrast)\b/, 'Tăng tương phản', { contrast: 25 }],
    [/\b(it tuong phan|diu hon|mem hon|phang|bot tuong phan|giam tuong phan)\b/, 'Giảm tương phản', { contrast: -22 }],
    [/\b(chan dung|portrait|selfie|da dep|gia?m da|ve nguoi)\b/, 'Tối ưu cho ảnh chân dung (sáng da, nhẹ nhàng)', { exposure: 0.2, shadows: 20, highlights: -10, noise: 20, vibrance: 10, sharpen: 25 }],
    [/\b(vignette|toi vien|toi goc|tap trung vao giua|lam toi vien|toi xung quanh)\b/, 'Tối viền, dồn mắt vào giữa', { vignette: 45 }],
  ];
  for (const [re, label, d] of RULES) {
    const g = new RegExp(re.source, 'g');
    let m, best = 0;
    while ((m = g.exec(t))) best = Math.max(best, modifier(m.index, m[0].length));
    if (best) {
      add(d, best);
      notes.push(label);
    }
  }

  // Ánh sáng theo hướng: chia theo vế câu, vế nào nhắc tới nguồn sáng + hướng thì đặt đèn ảo.
  const clauses = t.split(/[,;.]|\bva\b|\broi\b|\bcon\b/);
  for (const c of clauses) {
    if (!/\b(anh sang|den|nang|cua so|chieu|spotlight|rim|dien)\b/.test(c)) continue;
    const L = /\btrai\b/.test(c), R = /\bphai\b/.test(c), U = /\b(tren|dinh|tu tren)\b/.test(c), D = /\b(duoi|tu duoi)\b/.test(c);
    const C = /\b(giua|tam|chinh dien|truc dien|vao mat|chieu vao)\b/.test(c);
    if (!(L || R || U || D || C)) continue;
    let x = 0.5, y = 0.42;
    if (L) x = 0.12;
    if (R) x = 0.88;
    if (U) y = 0.12;
    if (D) y = 0.88;
    if (C && !(L || R || U || D)) { x = 0.5; y = 0.42; }
    const mod = modifier(c.search(/\S/), 0);
    set.lightOn = 1;
    set.lightX = x;
    set.lightY = y;
    set.lightRadius = 45;
    set.lightIntensity = Math.min(100, Math.round(60 * mod));
    set.lightWarmth = /\b(am|nang|vang|hoang hon|golden)\b/.test(c) ? 60 : /\b(lanh|mat|xanh)\b/.test(c) ? -40 : 20;
    const where = (U ? 'trên ' : D ? 'dưới ' : '') + (L ? 'bên trái' : R ? 'bên phải' : C ? 'giữa' : '');
    notes.push('Thêm đèn ảo chiếu từ ' + where.trim());
    break;
  }

  return { delta, set, notes, unsupported };
}

if (typeof module !== 'undefined') module.exports = { interpret };
