-- ==============================================================================================
-- 20260908_order_print_count.sql
-- Description: đếm số lần đã in hoá đơn cho một đơn/bàn.
--
-- "In lần" trên bill (PrintBill.jsx) trước đây đếm bằng useRef trong component — reset về 0
-- mỗi lần PrintBill unmount (đóng bàn rồi mở lại, hoặc in ở Nhật ký nơi PrintBill chỉ mount
-- khi bấm in — xem usePrintArmed), nên số hiện luôn sai/reset thay vì phản ánh đúng tổng số
-- lần đã in cho đơn đó.
--
--   orders.print_count — tăng dần mỗi lần in (web window.print() lẫn native captureImage()).
--
-- Bàn ngồi: mọi đợt của cùng 1 lần mở bàn dùng chung order_no, nhưng mỗi đợt là 1 dòng orders
-- riêng — đếm dồn vào ĐÚNG 1 dòng đại diện (đợt có order_no, xem TableDetailModal) để khớp với
-- "1 tờ bill = 1 số hoá đơn" thay vì rải đều/không nhất quán qua nhiều dòng.
--
-- KHÔNG đụng function nào → không có rủi ro rơi search_path (xem CLAUDE.md). Cập nhật đi qua
-- UPDATE thường của client (incrementOrderPrintCount), dùng lại policy sẵn có trên orders.
--
-- IDEMPOTENT — chạy lại an toàn.
-- ==============================================================================================

BEGIN;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS print_count INTEGER NOT NULL DEFAULT 0;

COMMIT;
