-- ============================================================
-- Admin Dashboard v6 — gỡ 3 key không còn ai đọc.
--
-- `ActivationBlock` trong AdminDashboardPage.jsx đã bị xoá (commit 290bef3):
-- khối đó trùng khối "Kẹt >3 ngày" của CohortFunnelCard mới, chỉ kém chi tiết
-- hơn (1 dòng vs 3 bucket). Ba key nó tiêu thụ thành payload chết:
--   activated_count           — count cộng dồn vĩnh viễn, đúng bệnh v3 đã cắt
--                               khỏi Subscription Health
--   pending_activation_count  — "trong 3 ngày đầu, chưa cần lo", tự khai là
--                               không actionable
--   never_activated_count     — khối "Kẹt" mới thay thế, tách làm 3 bucket
--
-- GIỮ CTE `unactivated_addresses`: reason 'never_activated' trong attention
-- list vẫn dùng nó, và AdminReconciliationPage.jsx vẫn render reason đó.
-- Chỉ CTE `activated_calc` bị gỡ (không còn ai gọi).
--
-- Không đổi signature → không cần REVOKE/GRANT lại, giữ nguyên cho nhất quán
-- với các migration trước.
--
-- ⚠️ PROD + DEV CHUNG 1 DB. IDEMPOTENT. Chỉ đọc, không ghi gì.
-- ============================================================

CREATE OR REPLACE FUNCTION admin_dashboard_overview()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_now          TIMESTAMPTZ := now();
    v_today        DATE := vn_business_date(v_now);
    v_month_start  DATE := date_trunc('month', v_today)::date;
    v_prev_end     DATE := v_month_start - 1; -- ngày cuối tháng trước, mốc so sánh "so với tháng trước"
    v_result       JSONB;
BEGIN
    IF NOT public.is_admin_auth(auth.uid()) THEN
        RAISE EXCEPTION 'Chỉ admin được xem dashboard'
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    WITH first_paid AS (
        SELECT address_id, MIN(created_at) AS first_paid_at
        FROM address_subscriptions
        WHERE payment_intent_id IS NOT NULL
        GROUP BY address_id
    ),
    new_paid_this_month AS (
        SELECT COUNT(*) AS n FROM first_paid WHERE vn_business_date(first_paid_at) >= v_month_start
    ),
    active_rows AS (
        SELECT * FROM address_subscriptions
        WHERE valid_from <= v_today AND valid_to >= v_today
    ),
    dominant AS (
        SELECT DISTINCT ON (address_id) address_id, note, valid_from, valid_to
        FROM active_rows
        ORDER BY address_id, valid_to DESC
    ),
    paid_addresses AS (
        SELECT address_id, valid_from, valid_to FROM dominant WHERE note <> 'trial'
    ),
    trial_addresses AS (
        SELECT address_id, valid_to FROM dominant WHERE note = 'trial'
    ),
    churned_addresses AS (
        SELECT fp.address_id
        FROM first_paid fp
        WHERE NOT EXISTS (SELECT 1 FROM dominant d WHERE d.address_id = fp.address_id)
    ),
    -- Snapshot "như hôm nay" nhưng chốt tại ngày cuối tháng trước, để tính
    -- delta thật cho tổng số địa chỉ và số đang trả phí (thay vì chỉ show
    -- con số hiện tại không có gì so sánh).
    addresses_now AS (
        SELECT COUNT(*) AS n FROM addresses
    ),
    addresses_prev AS (
        SELECT COUNT(*) AS n FROM addresses WHERE created_at < v_month_start
    ),
    dominant_prev AS (
        SELECT DISTINCT ON (address_id) address_id, note
        FROM address_subscriptions
        WHERE valid_from <= v_prev_end AND valid_to >= v_prev_end
        ORDER BY address_id, valid_to DESC
    ),
    paid_prev AS (
        SELECT COUNT(*) AS n FROM dominant_prev WHERE note <> 'trial'
    ),
    expiring_soon AS (
        SELECT address_id, valid_to FROM paid_addresses WHERE valid_to <= v_today + 7
    ),
    trial_ending AS (
        -- Trial tối đa 7 ngày → "sắp hết" phải chặt hơn ngưỡng renewal (≤7 ngày sẽ
        -- luôn đúng với MỌI trial). ≤3 ngày = còn chưa tới nửa thời gian, đây là lúc
        -- gọi chốt chuyển đổi trước khi trial rơi mất, không phải renewal reminder.
        SELECT address_id, valid_to FROM trial_addresses WHERE valid_to <= v_today + 3
    ),
    trial_starts AS (
        SELECT address_id, MIN(valid_from) AS trial_start
        FROM address_subscriptions WHERE note = 'trial'
        GROUP BY address_id
    ),
    conversion AS (
        SELECT
            COUNT(*) FILTER (WHERE trial_start >= v_today - 30) AS trial_30d,
            COUNT(*) FILTER (
                WHERE trial_start >= v_today - 30
                  AND ts.address_id IN (SELECT address_id FROM first_paid)
            ) AS converted_30d
        FROM trial_starts ts
    ),
    last_active AS (
        SELECT
            COALESCE(ao.address_id, ashi.address_id) AS address_id,
            GREATEST(ao.last_order, ashi.last_shift) AS last_active_at
        FROM (SELECT address_id, MAX(created_at) AS last_order FROM orders WHERE deleted_at IS NULL GROUP BY address_id) ao
        FULL JOIN (SELECT address_id, MAX(closed_at) AS last_shift FROM shift_closings GROUP BY address_id) ashi
            ON ashi.address_id = ao.address_id
    ),
    -- Chi nhánh đã từng trả tiền thật, hết hạn không gia hạn trong N ngày gần
    -- đây — nhóm dễ cứu nhất (đã có willingness-to-pay) nhưng trước đây không
    -- xuất hiện ở đâu trong "cần chú ý" một khi rớt khỏi "expiring".
    churned_last_sub AS (
        SELECT DISTINCT ON (address_id) address_id, valid_to
        FROM address_subscriptions
        WHERE note <> 'trial'
        ORDER BY address_id, valid_to DESC
    ),
    churned_recent AS (
        SELECT cls.address_id, cls.valid_to
        FROM churned_addresses ca
        JOIN churned_last_sub cls ON cls.address_id = ca.address_id
        WHERE cls.valid_to >= v_today - 30
    ),
    -- Rate 30 ngày thay cho churned_count cộng dồn vĩnh viễn: mẫu số là "đã trả
    -- phí gần đây" (đang paid + vừa rời bỏ), không phải tổng addresses lịch sử.
    churn_calc AS (
        SELECT
            (SELECT COUNT(*) FROM churned_recent) AS churned_recent_n,
            (SELECT COUNT(*) FROM paid_addresses) AS paid_n
    ),
    -- % chi nhánh ĐANG trả phí có hoạt động (đơn hoặc ca) trong 7 ngày qua —
    -- tín hiệu sớm hơn ngưỡng "inactive" (14 ngày) trong attention list.
    active_calc AS (
        SELECT COUNT(*) AS n
        FROM paid_addresses pa
        JOIN last_active la ON la.address_id = pa.address_id
        WHERE la.last_active_at >= v_now - INTERVAL '7 days'
    ),
    -- v5: mốc tín hiệu hoạt động cuối cùng của địa chỉ đang trả phí — dùng
    -- last_active_at nếu có, không thì dùng valid_from của gói hiện tại (trả
    -- phí mà 0 đơn/ca từ lúc mua cũng phải tính "im lặng từ lúc đó").
    paid_signal AS (
        SELECT pa.address_id, pa.valid_to,
               COALESCE(la.last_active_at, pa.valid_from::timestamptz) AS effective_signal_at,
               la.last_active_at
        FROM paid_addresses pa
        LEFT JOIN last_active la ON la.address_id = pa.address_id
    ),
    -- v5: im lặng ≥90 ngày — gần như chắc chắn đã dẹp tiệm, gọi lại không còn
    -- ích lợi thật. Tách khỏi 'inactive' (14-90 ngày, còn cứu được) để không
    -- kéo phồng KPI "Cần chú ý" bằng case coi như đã mất.
    dormant_paid AS (
        SELECT address_id, valid_to, last_active_at
        FROM paid_signal
        WHERE effective_signal_at < v_now - INTERVAL '90 days'
    ),
    -- Trial đã chạy ≥2 ngày mà chưa từng phát sinh đơn/ca nào — bắt sớm hơn
    -- "trial_ending" (chỉ bắn ở ≤3 ngày cuối) để còn kịp gọi hỗ trợ chuyển đổi.
    trial_inactive AS (
        SELECT ta.address_id, ta.valid_to
        FROM trial_addresses ta
        JOIN trial_starts ts ON ts.address_id = ta.address_id
        LEFT JOIN last_active la ON la.address_id = ta.address_id
        WHERE ts.trial_start <= v_today - 2
          AND la.last_active_at IS NULL
    ),
    -- v4: khúc mù nhất của phễu — trial CHỈ bắt đầu ở ca chốt full đầu tiên
    -- (docs/MONETIZATION.md §1), không phải lúc đăng ký. Trước mốc đó địa chỉ
    -- có 0 dòng address_subscriptions, không rơi vào paid/trial/churned nào ở
    -- trên. is_stuck = đã tạo ≥3 ngày mà vẫn 0 dòng — kẹt thật, đáng gọi. Còn lại
    -- (0 dòng nhưng mới tạo <3 ngày) là "đang trong thời gian ân hạn", chưa cần lo.
    unactivated_addresses AS (
        SELECT a.id AS address_id, a.name, a.created_at,
               a.created_at <= v_now - INTERVAL '3 days' AS is_stuck
        FROM addresses a
        WHERE NOT EXISTS (SELECT 1 FROM address_subscriptions s WHERE s.address_id = a.id)
    ),
    attention_raw AS (
        SELECT
            a.id AS address_id, a.name, u.name AS owner_name, u.phone AS owner_phone,
            'expiring'::text AS reason, es.valid_to, la.last_active_at,
            NULL::text AS reference, NULL::bigint AS amount,
            NULL::uuid AS intent_id, NULL::timestamptz AS intent_created_at, NULL::int AS branch_extra
        FROM expiring_soon es
        JOIN addresses a ON a.id = es.address_id
        LEFT JOIN users u ON u.id = a.manager_id
        LEFT JOIN last_active la ON la.address_id = es.address_id

        UNION ALL

        -- v5: 'inactive' giờ chỉ còn khoảng 14-90 ngày (≥90 ngày → 'dormant' riêng,
        -- xem dormant_paid ở trên).
        SELECT
            a.id, a.name, u.name, u.phone,
            'inactive', ps.valid_to, ps.last_active_at,
            NULL, NULL, NULL, NULL, NULL
        FROM paid_signal ps
        JOIN addresses a ON a.id = ps.address_id
        LEFT JOIN users u ON u.id = a.manager_id
        WHERE ps.effective_signal_at < v_now - INTERVAL '14 days'
          AND ps.effective_signal_at >= v_now - INTERVAL '90 days'

        UNION ALL

        SELECT
            a.id, a.name, u.name, u.phone,
            'trial_ending', te.valid_to, la.last_active_at,
            NULL, NULL, NULL, NULL, NULL
        FROM trial_ending te
        JOIN addresses a ON a.id = te.address_id
        LEFT JOIN users u ON u.id = a.manager_id
        LEFT JOIN last_active la ON la.address_id = te.address_id

        UNION ALL

        SELECT
            a.id, a.name, u.name, u.phone,
            'churned_recent', cr.valid_to, la.last_active_at,
            NULL, NULL, NULL, NULL, NULL
        FROM churned_recent cr
        JOIN addresses a ON a.id = cr.address_id
        LEFT JOIN users u ON u.id = a.manager_id
        LEFT JOIN last_active la ON la.address_id = cr.address_id

        UNION ALL

        SELECT
            a.id, a.name, u.name, u.phone,
            'trial_inactive', ti.valid_to, la.last_active_at,
            NULL, NULL, NULL, NULL, NULL
        FROM trial_inactive ti
        JOIN addresses a ON a.id = ti.address_id
        LEFT JOIN users u ON u.id = a.manager_id
        LEFT JOIN last_active la ON la.address_id = ti.address_id

        UNION ALL

        -- v4: valid_to tái dùng để chứa NGÀY TẠO địa chỉ (không phải ngày hết hạn
        -- như các reason khác) — client tự diễn giải theo reason, xem attentionDetail().
        SELECT
            a.id, a.name, u.name, u.phone,
            'never_activated', na.created_at::date, la.last_active_at,
            NULL, NULL, NULL, NULL, NULL
        FROM unactivated_addresses na
        JOIN addresses a ON a.id = na.address_id
        LEFT JOIN users u ON u.id = a.manager_id
        LEFT JOIN last_active la ON la.address_id = na.address_id
        WHERE na.is_stuck

        UNION ALL

        SELECT
            a.id, COALESCE(a.name, 'SP' || pi.reference), u.name, u.phone,
            'payment_review', NULL, NULL,
            pi.reference, pi.amount, pi.id, pi.created_at,
            COALESCE(array_length(pi.address_ids, 1), 1) - 1
        FROM payment_intents pi
        LEFT JOIN addresses a ON a.id = pi.address_id
        LEFT JOIN users u ON u.id = a.manager_id
        WHERE pi.status = 'manual_review'

        UNION ALL

        -- Pending > 30' (nghi webhook miss/mất mạng — xem docs/MONETIZATION.md §7
        -- edge cases): khách có thể đã CK đúng nhưng chưa được server ghi nhận,
        -- cần admin đối chiếu sao kê thủ công, không tự động resolve.
        SELECT
            a.id, COALESCE(a.name, 'SP' || pi.reference), u.name, u.phone,
            'payment_stale', NULL, NULL,
            pi.reference, pi.amount, pi.id, pi.created_at,
            COALESCE(array_length(pi.address_ids, 1), 1) - 1
        FROM payment_intents pi
        LEFT JOIN addresses a ON a.id = pi.address_id
        LEFT JOIN users u ON u.id = a.manager_id
        WHERE pi.status = 'pending' AND pi.created_at < v_now - INTERVAL '30 minutes'
    ),
    -- Dedupe: 1 chi nhánh chỉ giữ 1 dòng cho các reason KHÔNG phải payment
    -- (expiring/inactive/trial_ending/churned_recent/trial_inactive/never_activated
    -- — tránh đếm trùng khi 1 địa chỉ rơi vào nhiều reason cùng lúc, vd vừa expiring
    -- vừa inactive). Khóa dedupe ưu tiên intent_id trước address_id: 2 payment_intent
    -- KHÁC NHAU của cùng 1 địa chỉ (vd 1 manual_review cũ + 1 pending mới do khách
    -- thử lại) PHẢI giữ cả 2 dòng — mỗi intent cần Cấp gói/Bỏ qua riêng theo
    -- intent_id, gộp theo address_id sẽ làm biến mất 1 giao dịch tiền thật.
    attention_dedup AS (
        SELECT DISTINCT ON (COALESCE(intent_id::text, address_id::text)) *
        FROM attention_raw
        ORDER BY
            COALESCE(intent_id::text, address_id::text),
            CASE reason
                WHEN 'payment_review' THEN 0
                WHEN 'payment_stale' THEN 1
                WHEN 'trial_ending' THEN 2
                WHEN 'expiring' THEN 3
                WHEN 'churned_recent' THEN 4
                WHEN 'inactive' THEN 5
                WHEN 'trial_inactive' THEN 6
                WHEN 'never_activated' THEN 7
                ELSE 8
            END,
            valid_to ASC NULLS LAST
    ),
    attention_ranked AS (
        SELECT *
        FROM attention_dedup
        ORDER BY
            CASE reason
                WHEN 'payment_review' THEN 0
                WHEN 'payment_stale' THEN 1
                WHEN 'trial_ending' THEN 2
                WHEN 'expiring' THEN 3
                WHEN 'churned_recent' THEN 4
                WHEN 'inactive' THEN 5
                WHEN 'trial_inactive' THEN 6
                WHEN 'never_activated' THEN 7
                ELSE 8
            END,
            valid_to ASC NULLS LAST,
            last_active_at ASC NULLS FIRST
        LIMIT 20
    ),
    -- v5: danh sách riêng, KHÔNG qua attention_dedup/ranked → không kéo
    -- attention_total_count. Sắp xếp im lặng lâu nhất lên đầu (mất nhiều nhất).
    dormant_list AS (
        SELECT a.id AS address_id, a.name, u.name AS owner_name, u.phone AS owner_phone,
               dp.valid_to, dp.last_active_at
        FROM dormant_paid dp
        JOIN addresses a ON a.id = dp.address_id
        LEFT JOIN users u ON u.id = a.manager_id
        ORDER BY dp.last_active_at ASC NULLS FIRST
        LIMIT 20
    ),
    recent_payments AS (
        SELECT
            'payment'::text AS type, a.name AS address_name,
            CASE WHEN fp.first_paid_at = s.created_at THEN 'Thanh toán lần đầu' ELSE 'Gia hạn ' || s.months || ' tháng' END AS detail,
            s.created_at AS at
        FROM address_subscriptions s
        JOIN addresses a ON a.id = s.address_id
        LEFT JOIN first_paid fp ON fp.address_id = s.address_id
        WHERE s.payment_intent_id IS NOT NULL
        ORDER BY s.created_at DESC LIMIT 5
    ),
    recent_reviews AS (
        SELECT 'review'::text, COALESCE(a.name, 'SP' || pi.reference), 'Lệch tiền'::text, pi.created_at
        FROM payment_intents pi
        LEFT JOIN addresses a ON a.id = pi.address_id
        WHERE pi.status = 'manual_review'
        ORDER BY pi.created_at DESC LIMIT 3
    ),
    -- Đánh giá app (SupportModal, app_ratings) — không gắn address_id (rating
    -- theo tài khoản) nên "address_name" tái dùng để chứa tên người đánh giá.
    -- Comment cắt 80 ký tự để không phá layout thẻ hoạt động.
    recent_ratings AS (
        SELECT
            'rating'::text, u.name,
            repeat('★', r.rating) || repeat('☆', 5 - r.rating) ||
                CASE WHEN r.comment IS NOT NULL AND r.comment <> ''
                    THEN ' — "' || LEFT(r.comment, 80) || CASE WHEN LENGTH(r.comment) > 80 THEN '…' ELSE '' END || '"'
                    ELSE ''
                END,
            r.created_at
        FROM app_ratings r
        JOIN users u ON u.id = r.user_id
        ORDER BY r.created_at DESC LIMIT 5
    ),
    activity_feed AS (
        SELECT * FROM recent_payments
        UNION ALL SELECT * FROM recent_reviews
        UNION ALL SELECT * FROM recent_ratings
        ORDER BY 4 DESC
        LIMIT 20
    )
    SELECT jsonb_build_object(
        'generated_at', v_now,
        'subscription', jsonb_build_object(
            'paid_count', (SELECT COUNT(*) FROM paid_addresses),
            'paid_count_prev', (SELECT n FROM paid_prev),
            'trial_count', (SELECT COUNT(*) FROM trial_addresses),
            'churned_count', (SELECT COUNT(*) FROM churned_addresses),
            'expiring_soon_count', (SELECT COUNT(*) FROM expiring_soon),
            'total_addresses', (SELECT n FROM addresses_now),
            'total_addresses_prev', (SELECT n FROM addresses_prev),
            'new_paid_this_month', (SELECT n FROM new_paid_this_month),
            'conversion_rate_30d', (
                SELECT CASE WHEN trial_30d = 0 THEN NULL ELSE ROUND(converted_30d::numeric / trial_30d * 100, 1) END
                FROM conversion
            ),
            'trial_30d', (SELECT trial_30d FROM conversion),
            'converted_30d', (SELECT converted_30d FROM conversion),
            'churn_rate_30d', (
                SELECT CASE WHEN paid_n + churned_recent_n = 0 THEN NULL
                       ELSE ROUND(churned_recent_n::numeric / (paid_n + churned_recent_n) * 100, 1) END
                FROM churn_calc
            ),
            'churned_recent_count', (SELECT churned_recent_n FROM churn_calc),
            'active_rate_7d', (
                SELECT CASE WHEN (SELECT paid_n FROM churn_calc) = 0 THEN NULL
                       ELSE ROUND(active_calc.n::numeric / (SELECT paid_n FROM churn_calc) * 100, 1) END
                FROM active_calc
            )
        ),
        'attention', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'address_id', address_id, 'name', name, 'owner_name', owner_name, 'owner_phone', owner_phone,
            'reason', reason, 'valid_to', valid_to, 'last_active_at', last_active_at,
            'reference', reference, 'amount', amount,
            'intent_id', intent_id, 'intent_created_at', intent_created_at, 'branch_extra', branch_extra
        )), '[]'::jsonb) FROM attention_ranked),
        'attention_total_count', (SELECT COUNT(*) FROM attention_dedup),
        'payment_issue_total_count', (SELECT COUNT(*) FROM attention_dedup WHERE reason IN ('payment_review', 'payment_stale')),
        -- v5: KHÔNG cộng vào attention_total_count — đã bỏ hẳn, không còn actionable.
        'dormant_count', (SELECT COUNT(*) FROM dormant_paid),
        'dormant_addresses', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'address_id', address_id, 'name', name, 'owner_name', owner_name, 'owner_phone', owner_phone,
            'reason', 'dormant', 'valid_to', valid_to, 'last_active_at', last_active_at
        )), '[]'::jsonb) FROM dormant_list),
        'activity', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'type', type, 'address_name', address_name, 'detail', detail, 'at', at
        )), '[]'::jsonb) FROM activity_feed)
    ) INTO v_result;

    RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_dashboard_overview() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_dashboard_overview() FROM anon;
GRANT  EXECUTE ON FUNCTION public.admin_dashboard_overview() TO authenticated;
