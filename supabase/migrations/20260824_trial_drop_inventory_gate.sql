-- ============================================================
-- Bỏ cổng 2 (kiểm kho phủ hết nguyên liệu) khỏi điều kiện cấp trial, thay bằng
-- 2 điều kiện chống "nhập bừa". Từ nay trial bắt đầu ở lần lưu thực thu đầu tiên
-- mà: (a) tiền thực nhận > 0, và (b) ngày đó có đơn thật.
--
-- Khác biệt cốt lõi so với cổng vừa bỏ: 2 điều kiện mới được thoả **bằng việc
-- bán hàng**, không đòi thêm thao tác nhập liệu nào. Cổng kiểm kho cũ đòi gõ số
-- cho cả chục nguyên liệu — một công việc RIÊNG nằm ngoài việc bán. Vẫn là
-- return im lặng, nhưng ai bán được hàng thật thì không bao giờ chạm tới nó.
--
-- Vì sao bỏ:
-- 1. Động lực đang NGƯỢC. `get_address_entitlement` (20260717_trial_4) trả
--    'all' tới 2099-12-31 cho địa chỉ chưa có row sub nào. Nên người trượt cổng
--    2 KHÔNG bị chặn — họ dùng full app miễn phí vĩnh viễn. Ai chốt ca cho đủ
--    thì bị tính giờ, ai bỏ dở khâu kiểm kho thì xài free mãi.
-- 2. Cổng gác một thứ MIỄN PHÍ. Mục đích ban đầu ("owner phải thực sự vận hành
--    đủ trước khi tính phí") đã được paywall sau 14 ngày lo rồi.
-- 3. Cổng lệch với chính onboarding guide: guide cố ý chỉ dạy 1-2 nguyên liệu
--    mẫu (ingredientSetupStep.jsx: "thay vì bắt gõ số cho cả chục dòng"), trong
--    khi cổng đòi phủ HẾT. Làm đúng 100% guide vẫn trượt.
-- 4. Trượt là IM LẶNG — RETURN NEW, không lỗi, không UI nào báo. Owner làm xong
--    95% việc và không biết vì sao chẳng có gì xảy ra.
--
-- KHÔNG backfill: trigger chỉ chạy trên INSERT/UPDATE shift_closings, nên địa
-- chỉ đang ở diện free-vĩnh-viễn giữ nguyên cho tới lần lưu thực thu kế tiếp
-- của chính họ. Cố ý — bắn trial hàng loạt cho người đang dùng free là dựng
-- paywall bất ngờ trước mặt họ.
--
-- Giữ nguyên phần còn lại của body (nhánh reanchor data cũ, ghi trial_grants
-- lịch sử) + SET search_path + REVOKE theo CLAUDE.md (hàm trigger → revoke cả
-- authenticated). Signature không đổi.
--
-- ⚠️ PROD + DEV CHUNG 1 DB. IDEMPOTENT.
-- ============================================================

CREATE OR REPLACE FUNCTION grant_trial_on_first_full_shift_close()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_phone      TEXT;
    v_close_date DATE;
    v_day_start  TIMESTAMPTZ;
BEGIN
    IF NEW.cash_closed_at IS NULL THEN
        RETURN NEW;  -- chưa lưu thực thu → chưa tính là chốt ca
    END IF;

    -- Chống nhập bừa (1/2): "Lưu thực thu" đặt cash_closed_at kể cả khi cả 2 ô = 0
    -- (reportService.ts buildCashPayload) — người vào nghịch thử bấm lưu cho biết
    -- thì không nên bị đốt 14 ngày trial.
    IF COALESCE(NEW.actual_cash, 0) + COALESCE(NEW.actual_transfer, 0) <= 0 THEN
        RETURN NEW;
    END IF;

    v_close_date := vn_business_date(NEW.closed_at);
    v_day_start  := (v_close_date::TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh');

    -- Chống nhập bừa (2/2): ngày đó phải có đơn thật. Range trên created_at (không
    -- phải vn_business_date(created_at) = ...) để dùng được idx_orders_address_created.
    -- ponytail: chỉ cần TỒN TẠI đơn chưa xoá, không cộng doanh thu — đã có điều kiện
    -- tiền thực nhận > 0 ở trên gác phần "có tiền". Thêm tổng tiền đơn khi nào thấy
    -- có người lách được bằng đơn 0đ.
    IF NOT EXISTS (
        SELECT 1 FROM orders
        WHERE address_id = NEW.address_id
          AND deleted_at IS NULL
          AND created_at >= v_day_start
          AND created_at <  v_day_start + INTERVAL '1 day'
    ) THEN
        RETURN NEW;
    END IF;

    -- Data cũ: địa chỉ đã có sub (trial cấp lúc tạo theo cơ chế trước
    -- 2026-07-17, hoặc đã paid) → chỉ reanchor 1 lần, không tạo thêm.
    IF EXISTS (SELECT 1 FROM address_subscriptions WHERE address_id = NEW.address_id) THEN
        UPDATE address_subscriptions
           SET valid_to = GREATEST(valid_to, v_close_date + 14),
               trial_reanchored_at = COALESCE(trial_reanchored_at, now())
         WHERE address_id = NEW.address_id
           AND note = 'trial'
           AND trial_reanchored_at IS NULL;
        RETURN NEW;
    END IF;

    -- Địa chỉ CHƯA từng có sub nào — ca này chính là mốc trial bắt đầu.
    INSERT INTO address_subscriptions
        (address_id, tier, valid_from, valid_to, amount_paid, note, trial_reanchored_at)
    VALUES
        (NEW.address_id, 'all', v_close_date, v_close_date + 14, 0, 'trial', now());

    -- Ghi trial_grants cho mục đích lịch sử/tham khảo (KHÔNG dùng để gate) —
    -- chỉ ghi được khi owner có SĐT; PK là phone nên NULL phải bỏ qua.
    SELECT u.phone INTO v_phone
    FROM addresses a JOIN users u ON u.id = a.manager_id
    WHERE a.id = NEW.address_id;

    IF v_phone IS NOT NULL THEN
        INSERT INTO trial_grants (phone, address_id, expires_at)
        VALUES (v_phone, NEW.address_id, (v_close_date + 14)::timestamptz)
        ON CONFLICT (phone) DO NOTHING;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.grant_trial_on_first_full_shift_close() FROM PUBLIC, anon, authenticated;
