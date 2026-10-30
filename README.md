# Muse Chỉnh ảnh — web nhận ảnh, giao ảnh đã chỉnh (miễn phí, file tự xóa sau 2 ngày)

Web chỉ làm **người giao hàng**, không tự chỉnh ảnh:

1. Khách vào trang, gửi **ảnh cần chỉnh** kèm **yêu cầu bằng chữ** và/hoặc **ảnh phong cách muốn giống**.
2. Web đưa vào thư mục **Đơn chỉnh ảnh AI** trên Google Drive của bạn, mỗi đơn một thư mục `DON-<mã ngẫu nhiên>`.
3. **Muse của bạn (bên ngoài)** lấy ảnh xuống, chỉnh xong, thả ảnh đã chỉnh vào **đúng thư mục đơn đó**.
4. Web thấy ảnh mới, hiện ảnh và nút tải cho **đúng khách có mã đơn đó**.
5. **Cả thư mục tự bị xóa vĩnh viễn sau 48 giờ.**

Toàn bộ chạy miễn phí: Drive, Render gói miễn phí, dịch vụ ping miễn phí. Trang làm ưu tiên điện thoại.

## Muse của bạn cần làm gì (hợp đồng duy nhất)

Trong mỗi thư mục `DON-…` có:

| File | Ý nghĩa |
|---|---|
| `anh.jpg` / `anh.png` / `anh.webp` | Ảnh khách cần chỉnh |
| `anh-mau.*` | (có thể không có) ảnh phong cách khách muốn giống |
| `yeu-cau.txt` | Yêu cầu chữ, tên và số Zalo của khách. **Được tải lên cuối cùng**: thấy file này nghĩa là ảnh đã đủ, Muse nên bắt đầu |

Muse chỉ cần **thả ảnh đã chỉnh vào cùng thư mục đó**, định dạng JPG, PNG hoặc WEBP, **tên gì cũng được** (nếu đặt `ket-qua.jpg` thì được ưu tiên). Web tự nhận ra đó là ảnh kết quả vì nó không phải `anh.*` hay `anh-mau.*`. Ảnh cần nằm yên khoảng 10 giây rồi web mới giao (tránh giao ảnh còn đang tải); muốn giao ngay thì tạo thêm một file `xong.txt` rỗng sau khi ảnh đã tải xong. Muốn từ chối đơn thì tạo `tu-choi.txt`: khách sẽ thấy "chưa thể thực hiện".

Mã đơn là thư mục: Muse **không cần biết khách là ai**, chỉ cần ảnh về đúng thư mục thì web giao đúng người.

## Xem thử ngay, không cần tài khoản Google

```sh
npm install
npm run demo        # mở http://localhost:3000
```

Gửi một đơn trên trang: thợ tự động chỉnh ánh sáng thật cho ảnh và trả về trong vài giây (dùng Drive giả trong bộ nhớ, chỉ để xem luồng chạy). Cần đã chạy `npm install` để có công cụ xử lý ảnh.

## Đặc điểm

- **Thợ tự động có sẵn (tùy chọn, mặc định tắt).** Nếu bạn chưa có Muse riêng, đặt `AUTO_MUSE=true` để máy chủ web có sẵn một "thợ tự động": khách gửi đơn xong là thợ tự đọc yêu cầu, chỉnh ánh sáng, nộp ảnh và báo xong, thường trong khoảng nửa phút. Thợ đọc yêu cầu bằng bộ luật tiếng Việt (sáng/tối, ấm/lạnh, ánh sáng từ trái/phải/trên/dưới, ngược sáng, điện ảnh, đen trắng, tối viền) và dùng ảnh phong cách nếu có; không dùng AI nên không tốn lượt, và không làm theo bất kỳ câu "ra lệnh" nào trong yêu cầu.

- **Chỉ chỉnh ánh sáng**: trang, lời nhắc Muse và chính sách đều theo hướng này.
- **Cài như ứng dụng**: trên Android bấm "Thêm vào màn hình chính" ngay trên trang; iPhone bấm Chia sẻ → Thêm vào MH chính (trang có hướng dẫn). Mở bằng một chạm, không thanh địa chỉ.
- **Link theo dõi từng đơn** (`/?don=<mã>`) và nút sao chép link: khách lưu hoặc gửi lại là thấy đúng đơn.
- **Báo khi xong qua Zalo do bạn nhắn**: Muse ghi sẵn tên, số Zalo và link vào `muse-work/CAN-NHAN-ZALO.txt` (xem MUSE.md).

- **Mã đơn ngẫu nhiên, không đoán được** (`DON-` + 16 ký tự): là "chìa khóa" xem và tải ảnh, backend không bao giờ liệt kê mã.
- **Tự xóa**: đơn chưa xong xóa sau 48 giờ kể từ lúc tạo; đơn xong xóa sau 48 giờ kể từ lúc xong. Ảnh gốc, ảnh phong cách và số điện thoại bị xóa ngay khi có ảnh kết quả. Xóa vĩnh viễn, không qua thùng rác.
- Giới hạn 5 đơn/giờ/IP, chỉ nhận ảnh JPG/PNG/WEBP ≤ 20MB, ô xác nhận quyền dùng ảnh.
- Đăng nhập Drive bằng OAuth tài khoản Gmail của bạn (tài khoản dịch vụ không tải file lên Drive cá nhân được).

## Bước 1 — Tạo khóa OAuth (một lần, miễn phí)

1. Vào https://console.cloud.google.com/ → tạo Project mới.
2. **APIs & Services → Library** → tìm **Google Drive API** → **Enable**.
3. **APIs & Services → OAuth consent screen** (hoặc *Google Auth Platform*): chọn **External**, điền tên ứng dụng và email của bạn.
4. **Credentials → Create Credentials → OAuth client ID** → loại **Desktop app** → Create. Copy **Client ID** và **Client secret**.
5. **Quan trọng:** ở màn hình OAuth consent, bấm **Publish app** để chuyển sang *In production*.
   Nếu để *Testing*, khóa đăng nhập hết hạn sau **7 ngày** và web sẽ ngừng tải được file.
   Dùng một mình thì không cần Google xét duyệt; lúc cấp quyền ở bước 3 bạn sẽ thấy cảnh báo "chưa xác minh" — chọn *Advanced → Go to (tên app)*.

## Bước 2 — Thư mục Drive

1. Trên Drive của bạn, tạo thư mục **Đơn chỉnh ảnh AI**.
2. Mở thư mục, lấy ID ở thanh địa chỉ: đoạn sau `/folders/`. Đó là `DRIVE_ROOT_FOLDER_ID`.
   (Không cần chia sẻ cho ai: backend dùng chính tài khoản của bạn.)

## Bước 3 — Điền khóa vào máy và lấy GOOGLE_REFRESH_TOKEN (cần Node 22 trở lên)

```sh
npm install
npm run setup        # hỏi Client ID, Client secret (ẩn khi dán), link thư mục Drive; tự ghi vào .env
npm run get-token    # mở link in ra, đăng nhập Gmail, cho phép; khóa tự ghi vào .env, không in ra màn hình
```

Lúc cho phép, Google cảnh báo "chưa xác minh": bấm **Advanced → Go to ... (unsafe) → Continue/Allow**.
Khóa là bí mật như mật khẩu. Khi đưa lên Render, mở file `.env` và copy các dòng vào mục Environment.

Chạy thử trên máy: `npm start` rồi mở http://localhost:3000.

### Khóa Drive hết hạn sau 7 ngày (chế độ Testing)

Ứng dụng Google của bạn đang ở chế độ **Testing** (chưa Publish được vì Google đòi trang chủ và chính sách quyền riêng tư trên tên miền bạn sở hữu). Ở chế độ này khóa đăng nhập Drive **hết hạn sau 7 ngày**. Khi đó web báo lỗi gửi đơn và lệnh `muse` báo "khóa đăng nhập Drive đã hết hạn". Cách xử lý: chạy lại `npm run get-token` (khoảng 1 phút) rồi cập nhật `GOOGLE_REFRESH_TOKEN` trên Render. Muốn hết phiền thì dùng tên miền riêng để Publish ứng dụng.

## Bước 4 — Đưa lên Render

1. Đẩy thư mục này lên GitHub (repo **Private**; file `.env` đã nằm trong `.gitignore`).
2. https://render.com/ → đăng nhập bằng GitHub → **New → Blueprint** → chọn repo. Render đọc `render.yaml`.
3. Vào service → **Environment**, điền: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `DRIVE_ROOT_FOLDER_ID`, `CLEANUP_KEY` (chuỗi ngẫu nhiên dài, ví dụ `openssl rand -hex 24`). Save.
4. Mở link Render cấp. Gói miễn phí ngủ khi không ai dùng; lần mở đầu có thể chờ 30–60 giây.

## Bước 5 — Giữ máy chủ thức và dọn dẹp (miễn phí)

Render gói miễn phí tự ngủ sau 15 phút không ai truy cập, và khi ngủ thì thợ tự động không chạy. Một "chuông báo" miễn phí gọi mỗi 5 phút sẽ giữ máy chủ thức, cho thợ làm các đơn còn sót và dọn dẹp:

1. Tạo tài khoản miễn phí ở https://cron-job.org
2. Tạo job gọi mỗi **5 phút** tới: `https://<tên-của-bạn>.onrender.com/api/cleanup?key=<CLEANUP_KEY>`
   Đường dẫn trả `{"ok":true,"checked":..,"deleted":..,"muse":..}` khi chạy đúng.

Gói miễn phí của Render có 750 giờ chạy mỗi tháng, vừa đủ cho một dịch vụ chạy liên tục. Khi khách gửi đơn lúc máy chủ đang ngủ, trang chờ khoảng 30–60 giây để máy chủ thức dậy rồi thợ làm ngay.

## Bước 6 — Kiểm tra bằng đơn thật

1. Gửi một đơn trên web (ảnh + ảnh phong cách + yêu cầu). Drive phải có `Đơn chỉnh ảnh AI/DON-.../` với `anh.*`, `anh-mau.*`, `yeu-cau.txt`.
2. Muse của bạn thả ảnh đã chỉnh vào thư mục đơn: trang web tự hiện ảnh và nút tải; ảnh gốc, ảnh mẫu và số điện thoại biến mất khỏi thư mục đơn. (Muốn thử mà chưa có Muse thì đặt `AUTO_MUSE=true`: thợ tự động có sẵn sẽ làm trong khoảng nửa phút.) Trong thư mục Drive gốc có thêm file `ZALO-DON-….txt` (tên, số Zalo, link) để bạn nhắn khách; file này tự xóa sau 2 ngày.
3. Muốn thử xóa nhanh: đặt `RETENTION_HOURS=0.01` trên Render, tạo đơn, gọi link `/api/cleanup`, xong nhớ trả về `48`.

## Điền thông tin thật

Trong `public/index.html` tìm dòng có `TODO`: số Zalo, email, **giá bán** (tự quyết theo công sức của Muse), và chính sách. Bản chính sách có sẵn đã ghi: xóa sau 2 ngày, chỉ gửi ảnh của mình hoặc có sự đồng ý của người trong ảnh. Hãy đọc và chỉnh cho đúng cách bạn làm.

## Chuẩn bị cho đăng nhập + nạp điểm

Mã đơn đã không đoán được và backend không có thao tác nào "liệt kê đơn", nên khi thêm tài khoản bạn chỉ cần:
- Thêm bảng người dùng và điểm (ví dụ Supabase miễn phí), gắn `userId` vào `yeu-cau.txt`.
- Trước khi tạo thư mục đơn, trừ điểm; sau đó tự tạo `da-duyet.txt` rồi bật `REQUIRE_APPROVAL=true`. Muse chỉ làm các đơn đã trừ điểm.
- "Mã khách hàng ẩn" là ID người dùng trong bảng đó, không xuất hiện trên trang.

Cần thêm lúc đó: chống gian lận điểm (trừ điểm phía máy chủ, không tin trình duyệt) và cổng nạp tiền thật (ví dụ chuyển khoản có đối soát). Bước này nên làm riêng.

## Giới hạn cần biết

- Render miễn phí ngủ khi vắng khách; tra cứu lần đầu hơi chậm.
- Video lớn tải lên chậm với đường truyền yếu; trang hiện phần trăm và dặn khách đừng đóng.
- Drive 15GB dùng chung với Gmail. Giữ 2 ngày và xóa ảnh nguồn sớm thì đủ dùng cho vài chục đơn mỗi ngày.
- Nếu Muse là trợ lý chạy trên máy bạn, nó chỉ làm khi máy bật và không ngủ. Lệnh `muse` mới chỉ được kiểm tra bằng Drive giả, chưa thử với Drive thật.
- Backend chưa chạy thử với Drive thật. Phần xóa tự động và kiểm tra API đã có bài kiểm tra tự động (`npm test`) dùng Drive giả; **đơn thật đầu tiên là bài kiểm tra cuối**.

## Cấu trúc

- `public/index.html` — trang khách: form gửi ảnh, tra cứu, xem và tải ảnh kết quả.
- `server/index.js` — backend: nhận file, ghi Drive, trả trạng thái, dọn dẹp.
- `server/index.test.js` — bài kiểm tra tự động.
- `scripts/get-refresh-token.js` — lấy khóa đăng nhập Drive một lần.
- `MUSE.md`, `LOI-NHAC-MUSE.md` — quy ước và lời nhắc cho Muse.
- `scripts/muse.js`, `scripts/muse-lib.js` — lệnh Muse dùng để lấy đơn, trả ảnh, từ chối.
- `scripts/relight.js` (+ `scripts/lib/pipeline.js`) — công cụ chỉnh ánh sáng cho Muse: `npm run relight -- <ảnh vào> <ảnh ra> '<JSON>' [--style <ảnh mẫu>]`.
- `server/fake-drive.js`, `scripts/demo.js` — chế độ thử không cần Google.
- `render.yaml`, `.env.example`, `package.json`.
