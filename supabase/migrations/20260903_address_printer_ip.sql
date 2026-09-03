-- ==============================================================================================
-- 20260903_address_printer_ip.sql
-- Description: IP máy in ESC/POS (quầy + bếp) theo từng địa chỉ, cho app native
-- (Capacitor) in bitmap thẳng qua mạng — thay window.print() trên thiết bị native.
--
--   addresses.counter_printer_ip — máy in hoá đơn ở quầy (bấm Tính tiền).
--   addresses.kitchen_printer_ip — máy in bếp (lúc tạo đơn).
-- NULL = chưa cấu hình, client fallback về window.print() như cũ.
--
-- Chỉ thêm cột, không đụng function nào — không cần khai lại search_path/REVOKE-GRANT
-- (đọc/ghi qua REST update thường, RLS addresses hiện có đã đủ chặn theo owner).
--
-- IDEMPOTENT — chạy lại an toàn.
-- ==============================================================================================

BEGIN;

ALTER TABLE addresses ADD COLUMN IF NOT EXISTS counter_printer_ip TEXT;
ALTER TABLE addresses ADD COLUMN IF NOT EXISTS kitchen_printer_ip TEXT;

COMMIT;
