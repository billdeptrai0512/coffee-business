-- ============================================================
-- Funnel cohort theo tuần — vá điểm mù của admin_dashboard_overview().
--
-- overview() v4/v5 đã đo khúc trước trial (activated/pending/never_activated),
-- nhưng toàn bộ là ẢNH CHỤP HÔM NAY: không có cohort, không đọc được xu hướng,
-- và `unactivated_addresses` gộp mọi địa chỉ chưa có sub vào 1 rổ dán nhãn
-- "chưa chốt ca nào". Hàm này thêm đúng 2 thứ overview() không có:
--   1. cohort theo tuần → so được tuần này với tuần đã chín.
--   2. tách rổ "kẹt" làm 3 — overview() gộp tất cả vào 1 dòng dán nhãn "chưa
--      chốt ca nào", sai với nhóm đã nhập thực thu. cash_closed_no_trial là
--      nhóm gần tiền nhất: chỉ thiếu một điều kiện là được cấp trial.
--
-- 5 mốc, cohort = TUẦN TẠO ĐỊA CHỈ:
--   created → first_order → trial_started → paid
--
-- ponytail: đếm luỹ kế tới hôm nay, không time-box theo tuổi cohort → tuần gần
-- nhất luôn thấp giả. Đọc các tuần đã chín. Time-box khi cần so cohort mới với
-- cohort cũ ở cùng độ tuổi.
-- ponytail: cohort trước 2026-07-17 chạy mô hình cũ (trial cấp lúc TẠO địa chỉ)
-- → trial_started trùng created, đừng suy ra hành vi chốt ca từ nó ở đoạn đó.
--
-- ⚠️ PROD + DEV CHUNG 1 DB. IDEMPOTENT. Chỉ đọc, không ghi gì.
-- ============================================================

CREATE OR REPLACE FUNCTION admin_funnel_cohorts(p_weeks INT DEFAULT 12)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_today  DATE := vn_business_date(now());
    v_from   DATE := (date_trunc('week', v_today) - make_interval(weeks => p_weeks - 1))::date;
    v_result JSONB;
BEGIN
    IF NOT public.is_admin_auth(auth.uid()) THEN
        RAISE EXCEPTION 'Chỉ admin được xem funnel'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    WITH cohort AS (
        SELECT id AS address_id,
               date_trunc('week', vn_business_date(created_at))::date AS week
        FROM addresses
        WHERE vn_business_date(created_at) >= v_from
    ),
    ord AS (
        SELECT address_id FROM orders
        WHERE deleted_at IS NULL GROUP BY address_id
    ),
    cash_closed AS (
        SELECT address_id FROM shift_closings
        WHERE cash_closed_at IS NOT NULL GROUP BY address_id
    ),
    trials AS (
        SELECT address_id FROM address_subscriptions
        WHERE note = 'trial' GROUP BY address_id
    ),
    paid AS (
        SELECT address_id FROM address_subscriptions
        WHERE payment_intent_id IS NOT NULL GROUP BY address_id
    ),
    per_week AS (
        SELECT
            c.week,
            COUNT(*)                                          AS created,
            COUNT(*) FILTER (WHERE o.address_id  IS NOT NULL) AS first_order,
            COUNT(*) FILTER (WHERE t.address_id  IS NOT NULL) AS trial_started,
            COUNT(*) FILTER (WHERE p.address_id  IS NOT NULL) AS paid
        FROM cohort c
        LEFT JOIN ord         o  ON o.address_id  = c.address_id
        LEFT JOIN trials      t  ON t.address_id  = c.address_id
        LEFT JOIN paid        p  ON p.address_id  = c.address_id
        GROUP BY c.week
    ),
    -- Tách rổ "kẹt" của overview() làm 3. Ngưỡng 3 ngày lấy theo `is_stuck` của v5.
    -- Không giới hạn theo p_weeks — tồn đọng toàn hệ thống, không phải cohort.
    -- 3 bucket phân hoạch kín tập hợp → client cộng lại ra tổng.
    stuck AS (
        SELECT
            COUNT(*) FILTER (WHERE o.address_id IS NULL)       AS never_ordered,
            COUNT(*) FILTER (WHERE o.address_id IS NOT NULL
                             AND cc.address_id IS NULL)        AS ordered_no_cash_close,
            COUNT(*) FILTER (WHERE cc.address_id IS NOT NULL)  AS cash_closed_no_trial
        FROM addresses a
        LEFT JOIN ord         o  ON o.address_id  = a.id
        LEFT JOIN cash_closed cc ON cc.address_id = a.id
        LEFT JOIN trials      t  ON t.address_id  = a.id
        WHERE t.address_id IS NULL
          AND vn_business_date(a.created_at) <= v_today - 3
    )
    SELECT jsonb_build_object(
        'weeks', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'week', week,
            'created', created,
            'first_order', first_order,
            'trial_started', trial_started,
            'paid', paid
        ) ORDER BY week), '[]'::jsonb) FROM per_week),
        'stuck', (SELECT to_jsonb(stuck) FROM stuck)
    ) INTO v_result;

    RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_funnel_cohorts(INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_funnel_cohorts(INT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.admin_funnel_cohorts(INT) TO authenticated;
