-- Đổi mặc định 'enabled' của discount_programs từ true → false.
--
-- Form tạo mới ở DiscountProgramsPage chỉ hỏi tên/kiểu/giá trị — lịch áp dụng (days_of_week/
-- khoảng ngày) chỉ chỉnh được sau, ở trang chi tiết. Với enabled=true mặc định + days_of_week
-- rỗng (=mọi ngày, xem 20260909_discount_programs.sql), 1 chương trình mới tạo xong + gắn món
-- xong là CHẠY NGAY MỌI NGÀY nếu quản lý quên bấm vào "Lịch áp dụng" để giới hạn lại — dễ gây
-- giảm giá nhầm cả tuần thay vì đúng 1 ngày định làm. false mặc định buộc phải chủ động bật
-- sau khi đã cấu hình lịch, an toàn hơn.
--
-- Không đụng function nào ở đây nên không vướng rule search_path.

ALTER TABLE discount_programs ALTER COLUMN enabled SET DEFAULT false;
