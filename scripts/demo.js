// Chạy thử toàn bộ web mà KHÔNG cần tài khoản Google: npm run demo
// Dùng Drive giả trong bộ nhớ. Sau khi gửi đơn trên trang, mở
//   http://localhost:3000/demo/muse   để giả lập Muse chỉnh xong và trả ảnh.
// Dữ liệu mất khi tắt chương trình. Đừng dùng để chạy thật.
process.env.DRIVE_ROOT_FOLDER_ID = 'ROOT';
process.env.AUTO_MUSE = 'true'; // thợ tự động chỉnh ảnh thật ngay sau khi khách gửi (cần: npm install)
const { makeDrive } = require('../server/fake-drive.js');
const { app, __setDrive } = require('../server/index.js');

const drive = makeDrive([{ id: 'ROOT', name: 'Đơn chỉnh ảnh AI', mime: 'application/vnd.google-apps.folder' }]);
__setDrive(drive);

// Giả lập Muse: với mọi đơn có yeu-cau.txt mà chưa có xong.txt, lấy ảnh gốc làm "kết quả".
app.get('/demo/muse', (req, res) => {
  const done = [];
  for (const folder of drive.store.filter((f) => /^DON-[a-f0-9]{16}$/.test(f.name))) {
    const kids = drive.store.filter((f) => f.parents.includes(folder.id));
    const src = kids.find((f) => /^anh\./.test(f.name));
    if (!src || !kids.some((f) => f.name === 'yeu-cau.txt') || kids.some((f) => f.name === 'xong.txt')) continue;
    const ext = src.name.split('.').pop();
    const now = new Date().toISOString();
    drive.store.push({ id: 'r' + folder.id, name: 'ket-qua.' + ext, parents: [folder.id], mime: '', content: src.content, createdTime: now });
    drive.store.push({ id: 'x' + folder.id, name: 'xong.txt', parents: [folder.id], mime: '', content: Buffer.from('ok'), createdTime: now });
    done.push(folder.name);
  }
  res.type('text').send(done.length ? 'Muse giả lập đã trả ảnh cho: ' + done.join(', ') : 'Không có đơn nào đang chờ.');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Chế độ thử: http://localhost:${PORT}  (Muse giả lập: /demo/muse)`));
