// Drive giả lưu trong bộ nhớ, đủ để chạy bài kiểm tra và chế độ thử (npm run demo).
// Chỉ hiểu các truy vấn mà server/index.js dùng.
const { Readable } = require('node:stream');

function makeDrive(seed = []) {
  const store = seed.map((f, i) => ({ id: 'f' + i, parents: [], mime: '', content: Buffer.alloc(0), ...f }));
  const created = [];
  const deleted = [];
  let n = 1000;
  const files = {
    async create({ requestBody, media }) {
      let content = Buffer.alloc(0);
      if (media) { const parts = []; for await (const c of media.body) parts.push(Buffer.from(c)); content = Buffer.concat(parts); }
      const f = { id: 'n' + n++, name: requestBody.name, parents: requestBody.parents || [], mime: requestBody.mimeType || media?.mimeType || '', content, createdTime: new Date().toISOString() };
      store.push(f);
      created.push(f.name);
      return { data: { id: f.id } };
    },
    async list({ q }) {
      const parent = q.match(/'([^']+)' in parents/)?.[1];
      const name = q.match(/name = '([^']+)'/)?.[1];
      const contains = q.match(/name contains '([^']+)'/)?.[1];
      const folderOnly = q.includes("mimeType = 'application/vnd.google-apps.folder'");
      return { data: { files: store.filter((f) =>
        (!parent || f.parents.includes(parent)) &&
        (!name || f.name === name) &&
        (!contains || f.name.includes(contains)) &&
        (!folderOnly || f.mime === 'application/vnd.google-apps.folder')) } };
    },
    async delete({ fileId }) {
      deleted.push(fileId);
      for (let i = store.length - 1; i >= 0; i--) if (store[i].id === fileId || store[i].parents.includes(fileId)) store.splice(i, 1);
    },
    async get({ fileId }) {
      return { data: Readable.from([store.find((x) => x.id === fileId).content]) };
    },
  };
  return { files, store, created, deleted };
}

module.exports = { makeDrive };
