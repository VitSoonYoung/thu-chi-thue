# Sao lưu lên Google Drive

Ứng dụng kết nối trực tiếp với tài khoản Google của bạn. Sau khi thiết lập, vào Cài đặt → Google Drive → Sao lưu lên Google Drive. Mỗi lần bấm tạo một bản SQLite mới trong thư mục “Thu Chi & Thuế Backups”. Thư mục và tệp không được chia sẻ công khai.

## Thiết lập lần đầu

1. Mở [Google Cloud Console](https://console.cloud.google.com/), tạo hoặc chọn project riêng.
2. Bật Google Drive API trong API Library.
3. Trong Google Auth Platform, thiết lập tên ứng dụng và thông tin liên hệ. Nếu ứng dụng đang ở chế độ Testing, thêm tài khoản của bạn vào Test users trong Audience.
4. Tạo OAuth client loại Web application trong Clients. Thêm Authorized redirect URI đúng với địa chỉ bạn dùng để kết nối:

```text
http://localhost:3210/api/drive/callback
```

Bạn cũng có thể dùng tên miền HTTPS của ứng dụng:

```text
https://vits-mac-mini.taila2e14b.ts.net/api/drive/callback
```

5. Tải tệp JSON của OAuth client từ Google Cloud.
6. Mở ứng dụng tại cùng địa chỉ đã đăng ký, ví dụ http://localhost:3210 trên Mac. Mở khóa rồi vào Cài đặt → Google Drive, chọn tệp JSON và lưu thiết lập.
7. Bấm Kết nối Google Drive, chọn tài khoản và chấp nhận quyền sao lưu. Sau khi Google đưa bạn về ứng dụng, tài khoản đã kết nối sẽ hiện trong Cài đặt.

Địa chỉ trả về phải khớp hoàn toàn, kể cả tên miền, cổng và đường dẫn. Khi HTTPS Tailscale chưa hoạt động, hãy kết nối trên Mac bằng localhost; sau đó điện thoại vẫn có thể bấm sao lưu qua địa chỉ Tailscale đang dùng.

## Sử dụng

Bấm “Sao lưu lên Google Drive” khi muốn tạo bản sao lưu. Ứng dụng tạo snapshot SQLite nhất quán, tải lên và đối chiếu kích thước cùng checksum trước khi báo thành công. Liên kết bản sao lưu gần nhất và thư mục sẽ xuất hiện sau khi tải lên.

Để khôi phục, tải tệp `.db` từ Google Drive rồi dùng “Khôi phục” trong Cài đặt. Giới hạn khôi phục hiện tại là 50 MB. Dữ liệu sao lưu gồm giao dịch, chứng từ, danh mục, cài đặt tài chính, quy tắc thuế và lịch sử; không gồm mật khẩu truy cập, passkey hoặc thông tin đăng nhập Google.

Bấm “Ngắt kết nối” để xóa phiên Google trên máy chủ và thu hồi token. Các bản sao lưu đã tải lên vẫn nằm trong Drive. Nếu máy chủ không kết nối được Google khi ngắt, bạn có thể thu hồi quyền trong trang ứng dụng được kết nối của tài khoản Google.

Không tự động tải lên theo lịch. Mọi thiết bị đã mở khóa dùng chung tài khoản Drive được kết nối trên máy chủ.

## Cấu hình và lưu trữ

OAuth client và token được lưu ở `drive_config.json` và `drive_tokens.json` trong thư mục dữ liệu của ứng dụng, chỉ cho chủ sở hữu máy đọc và ghi. Các tệp này được Git bỏ qua. Không đưa tệp OAuth client hoặc token vào repository.

Có thể cấu hình trực tiếp trong `config.local.json` thay cho việc nhập tệp bằng giao diện:

```json
{
  "google_drive": {
    "client_id": "your_client_id.apps.googleusercontent.com",
    "client_secret": "your_client_secret",
    "redirect_url": "http://localhost:3210/api/drive/callback"
  }
}
```

Thêm mục này vào cấu hình truy cập hiện có rồi khởi động lại máy chủ. Thiết lập đã lưu từ giao diện sẽ được ưu tiên nếu tồn tại.

Ứng dụng chỉ yêu cầu scope `drive.file`, cho phép quản lý tệp do ứng dụng tạo. Google có thể yêu cầu kết nối lại khi quyền hết hạn hoặc bị thu hồi; thời hạn token của ứng dụng Testing phụ thuộc thiết lập Google OAuth.

Tài liệu tham khảo: [Google OAuth cho web server](https://developers.google.com/identity/protocols/oauth2/web-server), [Drive API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [Drive uploads](https://developers.google.com/workspace/drive/api/guides/manage-uploads).
