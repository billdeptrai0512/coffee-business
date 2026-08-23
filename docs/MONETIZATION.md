# Monetization — System Design

Source of truth cho cách tính phí, gate feature, và xử lý thanh toán.
Mọi feature mới phải follow doc này thay vì nghĩ lại từ đầu.

---

## 1. Mô hình tính phí

> **🔄 ĐỔI MÔ HÌNH 2026-06-09: gộp về 1 gói all-access duy nhất.** Bỏ bán lẻ từng báo cáo,
> bỏ chu kỳ tháng/năm. Phần "2 module" bên dưới là lịch sử, KHÔNG còn áp dụng.

**Trục tính phí**: theo `address_id`. Một owner có nhiều xe (address) → mỗi xe 1 gói riêng.

### 1 gói all-access

**1 sản phẩm duy nhất.** Mua = mở khoá CẢ 3 view báo cáo:

| Tier (DB) | Tên hiển thị | Mở khoá |
|-----------|--------------|---------|
| `all`     | Trọn bộ báo cáo | Dòng tiền (`cashflow`) + Lợi nhuận (`profit`) + Tồn kho (`inventory`, gồm hao hụt) |

- **1 row `tier='all'`/address** = mở cả 3 view. Gate chỉ hỏi "address có sub active?" (`hasModule(activeModules, 'all')`), không phân biệt view.
- POS/chốt ca/kho/công thức luôn **free** (không gate); chỉ 3 view báo cáo bị gate.

### Bảng giá

| SKU | Giá | Chu kỳ |
|-----|----:|--------|
| 1 gói / 1 chi nhánh | **888,888đ** | **6 tháng** (`months=6`) |
| Nhiều chi nhánh | × số chi nhánh | 1 lần trả → 1 row/address |

- **Chỉ 1 mức giá, 1 chu kỳ 6 tháng.** Không tháng/năm, không bundle/chiết khấu, không bán lẻ module.
- **Multi-branch chỉ là tiện ích checkout**: 1 lần trả → tạo nhiều `address_subscriptions` row (1 row `'all'`/address). Entitlement check **per-address**.

**Không có "Free tier" vĩnh viễn có chủ đích cho báo cáo** — ngoại lệ DUY NHẤT là giai đoạn "chưa từng chốt ca full lần nào" ở dưới (cố ý, không phải bug). Ngoài giai đoạn đó: sub hết hạn → cả 3 view khoá; POS/chốt ca/kho/công thức vẫn luôn chạy free.

### Trial

**✅ AS-BUILT 2026-07-17, sửa 2026-08-02 (7 → 14 ngày) — trial KHÔNG cấp lúc tạo địa chỉ nữa, và KHÔNG còn giới hạn theo SĐT.** Chỉ cấp (và bắt đầu đếm 14 ngày) ở **lần chốt ca FULL đầu tiên** — mỗi ĐỊA CHỈ (không phải account/SĐT) có 1 vòng đời trial độc lập: free tới ca full đầu tiên → 14 ngày → paywall. Trước ca full đầu tiên, địa chỉ dùng **full tính năng báo cáo, không đếm ngược gì cả** — dù setup mất bao lâu.
Lý do: mục tiêu là owner phải THỰC SỰ vận hành đủ (nhập thực thu + kiểm kho) trước khi tính phí; chưa vận hành đủ thì không có cơ sở gì để bắt đầu đếm ngược. Không giới hạn theo SĐT vì billing vốn đã tính theo TỪNG `address_id` (§1 "mỗi xe 1 gói riêng") — không có lý do trial lại siết chặt hơn billing.

- **Lịch sử (KHÔNG còn hiệu lực)**: trước đó có ràng buộc `trial_grants(phone PK)` "1 SĐT = 1 trial trọn đời" — chỉ 1 địa chỉ/SĐT được hưởng free-tới-full-close, các chi nhánh sau bị khoá ngay từ đầu. Bỏ ở migration `20260717_trial_4_per_address_not_per_phone.sql` theo yêu cầu: đơn giản hoá setup nhiều chi nhánh, để mỗi chi nhánh mới đều có đủ thời gian trải nghiệm trước khi trả phí.
- **⚠️ Đánh đổi đã cân nhắc & chấp nhận có chủ đích**: xoá 1 địa chỉ (sau khi hết trial) rồi tạo lại → được 1 vòng trial mới (lỗ hổng mà `20260622_fix_trial_phone_change_loophole.sql` từng vá cho mô hình CŨ, nay mở lại có chủ đích). Chấp nhận vì lặp lại thao tác này vô nghĩa với 1 quán thật — mỗi lần phải xoá sạch dữ liệu bán hàng + giả vờ chốt ca full lại từ đầu, friction thật không đáng để lách.
- Owner vẫn cần nhập SĐT trước khi được cấp trial thật ở ca full đầu tiên (mồi UX thu thập liên hệ, KHÔNG còn phải là anti-abuse). Xác thực SĐT thật bằng OTP (Giai đoạn B — Zalo Mini App / Twilio fallback) **chưa build**, xem `docs/phoneAuth.md`.
- **Cơ chế cấp trial** (tiến hoá qua nhiều migration cùng ngày — `20260717_trial_1_reanchor_requires_full_close.sql` → `20260717_trial_2_deferred_until_first_full_close.sql` → `20260717_trial_4_per_address_not_per_phone.sql`, bản có hiệu lực CUỐI CÙNG là file `_4_`; 1 file trung gian từng thêm RPC `list_pending_trial_addresses` cho UI rồi bị chính file `_4_` DROP luôn vì hết cần thiết sau khi bỏ check SĐT — xem §6):
  - "Full" = đã bấm "Lưu thực thu" (`cash_closed_at IS NOT NULL`) **và** kiểm kho phủ hết mọi nguyên liệu active (`ingredient_costs`) trong `inventory_report`. Địa chỉ chưa cấu hình nguyên liệu nào → coi như đủ.
  - **Trước ca full đầu tiên**: địa chỉ **chưa có row `address_subscriptions` nào** → `get_address_entitlement()` bypass trả `'all'` (free, không hạn). Không check SĐT.
  - **Ca full đầu tiên xảy ra**: trigger `grant_trial_on_first_full_shift_close` INSERT row `note='trial', valid_from=ngày_chốt, valid_to=ngày_chốt+14` — từ đây trial mới thật sự bắt đầu đếm 14 ngày. **KHÔNG còn điều kiện nào về SĐT** (bỏ 2026-08-02 cùng lúc form đăng ký đổi SĐT → email, xem `20260802_trial_no_phone_requirement.sql`). Sub `'trial'` cấp TRƯỚC 2026-08-02 vẫn giữ mốc 7 ngày cũ.
  - Data lịch sử (địa chỉ đã có sub từ cơ chế cũ trước 2026-07-17) vẫn dùng đường reanchor cũ (`GREATEST(valid_to, ngày_chốt+7)`, chỉ 1 lần qua cờ `trial_reanchored_at`) — không bị rút ngắn.
- Hết trial (sau khi ĐÃ cấp): cả 3 view báo cáo rớt về khoá cho tới khi thanh toán.

---

## 2. Feature Matrix

1 gói `all` mở khoá **cả 3 view báo cáo**. Gate chỉ hỏi "address có sub `all` active?" — không phân biệt view.

| Feature                                  | free | `all` |
|------------------------------------------|:----:|:-----:|
| Tạo đơn, menu, recipe, nguyên liệu       |  ✓   |   ✓   |
| Chốt ca (shift closing)                  |  ✓   |   ✓   |
| Lịch sử đơn (HistoryPage)                |  ✓   |   ✓   |
| View **Dòng tiền** — CashFlowCard + SalesCard + Day Performance |  |  ✓  |
| View **Lợi nhuận** — FinanceCards / P&L / COGS |  |  ✓  |
| View **Tồn kho** — InventoryReportCard / Refill / Gợi ý đi chợ |  |  ✓  |
| View **Tồn kho** — Audit tab + RangeLossCard (hao hụt) |  |  ✓  |

Khi quyết định feature mới:
- Bất kỳ view báo cáo nào (tiền mặt/thu chi/lãi-lỗ/COGS/tồn/hao hụt/đi chợ) → thuộc gói **`all`** (gate).
- Tác vụ vận hành thiết yếu (POS/chốt ca/kho/công thức — không xem được dữ liệu vẫn bán được hàng) → **free** (không gate).

---

## 3. Phone OTP (chống trial abuse)

**Bắt buộc** verify phone qua OTP khi signup. Bind trial vào phone — owner tạo
account mới hoặc address mới đều không nhận trial nếu phone đã từng nhận.

### Provider

| Phase | Provider | Cost / SMS | Khi nào dùng |
|---|---|---:|---|
| Khởi đầu | Twilio (native Supabase Auth) | ~1,200đ | Volume < 100 OTP/tháng |
| Khi scale | eSMS / Stringee qua Edge Function | ~600-800đ | Khi OTP volume > 100/tháng — saving ~50% |

Native Twilio dùng được ngay với `supabase.auth.signInWithOtp({ phone })`.
Khi cần migrate: viết Edge Function gửi OTP qua VN provider, generate token thủ công, lưu
vào bảng `phone_otp_codes` với TTL 5 phút.

### Schema

```sql
CREATE TABLE trial_grants (
    phone        TEXT PRIMARY KEY,           -- E.164 normalized: +84xxxxxxxxx
    address_id   UUID NOT NULL REFERENCES addresses(id),
    granted_at   TIMESTAMPTZ DEFAULT now(),
    expires_at   TIMESTAMPTZ NOT NULL        -- granted_at + 14 days (7 trước 2026-08-02)
);

-- Mở rộng addresses: cần biết owner để check trial khi tạo address mới
ALTER TABLE addresses ADD COLUMN owner_phone TEXT;
CREATE INDEX idx_addresses_owner_phone ON addresses(owner_phone);
```

**✅ AS-BUILT (khác thiết kế mẫu ở trên):** SĐT lưu ở `users.phone` (UNIQUE index bỏ qua NULL), **không phải** `addresses.owner_phone` — trigger tra `users.phone` qua `addresses.manager_id` thay vì cột riêng trên `addresses`. RPC thật là `set_my_phone(p_phone)`, không phải qua `create_address()`. `trial_grants.address_id` đã đổi thành **nullable + `ON DELETE SET NULL`** (migration `20260622_fix_trial_phone_change_loophole.sql`) — xem §1.

### Trial grant flow

```
User signup → verify OTP → INSERT auth.users với phone confirmed
  ↓
User tạo address đầu tiên
  ↓
RPC create_address():
    INSERT trial_grants(address_id, expires_at = now() + interval '3 days');
    INSERT address_subscriptions(tier='basic', valid_from=today, valid_to=today+3, amount_paid=0);
    INSERT address_subscriptions(tier='pro', valid_from=today, valid_to=today+3, amount_paid=0);
```

**Edge case**: user xoá address rồi tạo lại — `trial_grants.phone` đã tồn tại, không trial lại.

---

## 4. Schema

### Table: `address_subscriptions`

Mỗi record = 1 lần thanh toán → 1 khoảng hiệu lực.
Nhiều record / address để giữ history (audit, refund, gia hạn nối tiếp).

```sql
CREATE TABLE address_subscriptions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    address_id      UUID NOT NULL REFERENCES addresses(id) ON DELETE CASCADE,
    tier            TEXT NOT NULL CHECK (tier IN ('cashflow', 'inventory', 'finance')),
    valid_from      DATE NOT NULL,
    valid_to        DATE NOT NULL,
    months          INT  NOT NULL CHECK (months >= 1),
    amount_paid     INT  NOT NULL,
    payment_intent_id UUID REFERENCES payment_intents(id),
    created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_addr_sub_lookup ON address_subscriptions(address_id, valid_to DESC);
```

**Quy tắc gia hạn**: `valid_from = max(CURRENT_DATE, COALESCE(latest.valid_to, CURRENT_DATE - 1) + 1)`.
- Nếu trả trước khi hết hạn → nối tiếp ngay sau ngày hết hạn cũ (không mất ngày).
- Nếu trả sau khi hết hạn → tính từ hôm nay (không backfill quãng gap).

### Table: `payment_intents`

Generate ref code khi user click "Gia hạn"; webhook match bằng ref này.

```sql
CREATE TABLE payment_intents (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    address_id   UUID NOT NULL REFERENCES addresses(id),  -- = address_ids[1], giữ cho RLS/back-compat
    address_ids  UUID[],                -- AS-BUILT: multi-branch → 1 CK mở N chi nhánh
    tier         TEXT NOT NULL,         -- AS-BUILT = 'all' (single all-access plan, §1)
    months       INT  NOT NULL,
    amount       INT  NOT NULL,
    reference    TEXT NOT NULL UNIQUE,   -- AS-BUILT: số 12 chữ số; nội dung CK = 'SP' || reference
    status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','paid','expired','cancelled','manual_review')),
    expires_at   TIMESTAMPTZ NOT NULL,   -- AS-BUILT: hết hạn sau 24h (user hay CK muộn)
    paid_at      TIMESTAMPTZ,
    sepay_tx_id  TEXT,                   -- UNIQUE-ish: dedup webhook retry (idempotent)
    created_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_intent_ref ON payment_intents(reference) WHERE status = 'pending';
```

**Reference format (AS-BUILT)**: chuỗi **số 12 chữ số** ngẫu nhiên (unique-check khi sinh), không phải base58. Nội dung CK = `SP` + reference (webhook regex `/SP(\d{3,30})/i`). Số thuần → mọi app ngân hàng nhập/quét không lỗi ký tự.

---

## 5. Entitlement check

### RPC

Bản mẫu ban đầu (`SECURITY INVOKER`, chỉ query `address_subscriptions`):

```sql
CREATE OR REPLACE FUNCTION get_address_entitlement(p_address_id UUID)
RETURNS TABLE(tier TEXT, valid_to DATE)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
    SELECT tier, MAX(valid_to) as valid_to
    FROM address_subscriptions
    WHERE address_id = p_address_id
      AND valid_from <= CURRENT_DATE
      AND valid_to   >= CURRENT_DATE
    GROUP BY tier;
$$;
```

Trả NULL row khi không có sub active.

**✅ AS-BUILT 2026-07-17 (bản cuối cùng — `20260717_trial_4_per_address_not_per_phone.sql`) — đổi sang `SECURITY DEFINER` + ownership guard + bypass "chưa full-close lần nào", KHÔNG check SĐT:**

```sql
-- plpgsql, SECURITY DEFINER (cần bypass RLS để guard tự tay). REVOKE EXECUTE khỏi
-- anon bắt buộc vì guard skip khi auth.uid() IS NULL (chừa cho service_role/cron).
CREATE OR REPLACE FUNCTION get_address_entitlement(p_address_id UUID)
RETURNS TABLE(tier TEXT, valid_to DATE)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF auth.uid() IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM addresses WHERE id = p_address_id AND (
            public.is_admin_auth(auth.uid())
            OR manager_id = public.auth_owner_id(auth.uid())
            OR id IN (SELECT address_id FROM user_address_access WHERE auth_id = auth.uid())
        )
    ) THEN RAISE EXCEPTION 'Permission denied for address %', p_address_id USING ERRCODE = 'insufficient_privilege'; END IF;

    IF EXISTS (SELECT 1 FROM address_subscriptions s WHERE s.address_id = p_address_id
               AND s.valid_from <= CURRENT_DATE AND s.valid_to >= CURRENT_DATE) THEN
        RETURN QUERY SELECT s.tier, MAX(s.valid_to) FROM address_subscriptions s
            WHERE s.address_id = p_address_id AND s.valid_from <= CURRENT_DATE AND s.valid_to >= CURRENT_DATE
            GROUP BY s.tier;
        RETURN;
    END IF;

    -- Chưa từng có sub nào (chưa full-close lần nào) → free tạm, không đếm
    -- ngược (xem §1 Trial). KHÔNG check SĐT — mỗi địa chỉ độc lập.
    IF NOT EXISTS (SELECT 1 FROM address_subscriptions WHERE address_id = p_address_id) THEN
        RETURN QUERY SELECT 'all'::TEXT, '2099-12-31'::DATE;
    END IF;
    RETURN;
END;
$$;
```

### Frontend hook

```js
// src/hooks/useEntitlement.js
export function useEntitlement() {
    const { selectedAddress } = useAddress();
    const [state, setState] = useState({ activeModules: [], validToByModule: {}, loading: true });

    useEffect(() => {
        if (!selectedAddress?.id) return;
        supabase.rpc('get_address_entitlement', { p_address_id: selectedAddress.id })
            .then(({ data }) => {
                const rows = Array.isArray(data) ? data : (data ? [data] : []);
                setState({
                    activeModules: rows.map(r => r.tier),
                    validToByModule: rows.reduce((acc, r) => ({ ...acc, [r.tier]: r.valid_to }), {}),
                    loading: false
                });
            });
    }, [selectedAddress?.id]);

    return state;
}

// activeModules = ['all'] khi address còn hạn (xem MODULES trong useEntitlement.js)
export function hasModule(activeModules, module = 'all') {
    return Array.isArray(activeModules) && activeModules.includes(module);
}
```

Component sử dụng — 1 gói gate cả 3 view:
```jsx
const { activeModules } = useEntitlement();
if (!hasModule(activeModules)) return <SubscriptionScreen />;   // module mặc định = 'all'
// có 'all' → render cả Dòng tiền / Lợi nhuận / Tồn kho bình thường
```

---

## 6. UX khi bị gate

Hai entry point dẫn về **1 trang đăng ký gói duy nhất** (`/subscription`) — không sheet/modal rải rác:

### A. View lock (1 view trong trang báo cáo bị gate)
Trang báo cáo có 3 view (Dòng tiền / Tồn kho / Báo cáo) chọn qua `ReportViewFilter` ở footer.
Trang **luôn render** (footer + header navigation vẫn hoạt động) — chỉ phần thân của view chưa mua bị khoá:
- Khi view hiện tại chưa mua → DailyReportPage **early-return nguyên `<SubscriptionScreen>`** (full-screen, header back riêng, KHÔNG render header/footer báo cáo) → trải nghiệm subscription đồng nhất với route /subscription.
- `SubscriptionScreen` = chrome (back + tiêu đề "Đăng ký gói") + `<SubscriptionPanel>`. Preselect module bị khoá + chi nhánh đang xem.
- **Nút back theo ngữ cảnh vào**: từ badge (/addresses) → back `/addresses`; từ trong báo cáo → back `/pos`.
- Khoá **cả view kể cả hôm nay** (quyết định 2026-06-03: trial 3 ngày + guest đủ để xem thử). KHÔNG render dữ liệu thật → không leak preview.
- View đã mua render bình thường (đầy đủ chrome báo cáo + footer chuyển view).

### B. Status banner trên address card (AddressSelectPage)
`SubscriptionBadge` (render bằng `<span>`, KHÔNG `<button>` — tránh button lồng button trong card):

| Trạng thái | Hiển thị | Visual |
|---|---|---|
| **Không hoạt động hôm nay** (0 ly + 0đ — `cupsMap`/`revenueMap`) | `Không hoạt động` — ĐÈ LÊN mọi nhánh dưới, bất kể trial/pending/paid/khoá gì | text-secondary, dot **bg-text-secondary** |
| Có hoạt động + có gói `all`, còn > 3 ngày | `Trọn bộ · còn 23 ngày` | text-dim |
| Có hoạt động + có gói `all`, còn ≤ 3 ngày | `còn 2 ngày — Gia hạn` | text-warning |
| Có hoạt động + **chưa full-close lần nào** (0 sub row — xem §1) | `Đang dùng miễn phí` (chữ khác hẳn "Đang dùng thử" — tránh nhầm với trial thật có deadline) | text-secondary, dot success |
| Có hoạt động + hết hạn (có sub row nhưng không cái nào còn hạn hôm nay) | `Mở khoá báo cáo` | text-primary, mời chào |

Lý do ưu tiên "không hoạt động" lên trên hết: gate chỉ có 2 trạng thái thực (mở/khoá), còn trial/pending/paid chỉ là LÝ DO đang mở — không quan trọng bằng việc chi nhánh có đang thật sự vận hành hay không. Kéo theo cả sort của `AddressSelectPage` (xem code — không hoạt động luôn dồn xuống cuối danh sách, bất kể trạng thái gói).

Từ khi bỏ giới hạn theo SĐT (`20260717_trial_4_per_address_not_per_phone.sql`), "0 row" LUÔN LUÔN nghĩa là đang free tạm — không còn case "0 row vì SĐT đã cháy trial ở địa chỉ khác" nữa. Client tự suy ra trạng thái `pending` trực tiếp từ `rowsMap` rỗng (`fetchSubscriptionStatuses`), không cần RPC riêng — RPC `list_pending_trial_addresses` từng làm việc này đã bị DROP vì thành thừa.

Click badge → `navigate('/subscription', { state: { preselectAddressId } })`.

### Trang `/subscription` (đích chung)
`src/pages/SubscriptionPage.jsx` — owner tự lắp gói:
1. **Chọn chi nhánh**: list address quản lý, multi-select + "Chọn tất cả" (→ all-branches).
2. **Chọn báo cáo**: 3 toggle module, chọn 1/2/3.
3. **Chu kỳ**: tháng / năm.
4. **Tính tiền**: 3 module → giá bundle; 1–2 → cộng lẻ; × số chi nhánh đã chọn.
5. **QR placeholder** (Phase 3 sẽ gắn QR + poll).

**Không** dùng: blur preview, pop-up nag, modal toàn màn hình lúc khởi động — gây nhiễu mà không clear.

---

## 7. Payment flow (SePay)

### Sequence

```
User click "Gia hạn"
  ↓
Frontend: supabase.rpc('create_payment_intent', { p_address_ids, p_months, p_amount })
  // p_address_ids: UUID[] (multi-branch); p_months: PLAN.months (=6); p_amount: tổng tính client
  // server guard caller quản lý các CN, tái dùng intent pending còn hạn → return reference (số)
  ↓ INSERT payment_intents → return reference (chuỗi số)
Frontend: QR VietQR qua qr.sepay.vn — tự điền amount + des='SP'+reference
  ↓
User scan QR via banking app → chuyển khoản
  ↓
Bank push notification → SePay
  ↓ POST /sepay-webhook (Edge Function)
Backend:
  1. Verify SePay signature
  2. Parse reference + amount khỏi nội dung CK
  3. SELECT payment_intent WHERE reference = ? AND status = 'pending'
  4. Validate amount = intent.amount (±1000đ tolerance)
  5. INSERT address_subscriptions với valid_from/to tính theo quy tắc gia hạn
  6. UPDATE payment_intents SET status='paid', sepay_tx_id, paid_at
  ↓
Frontend (POLL-WHILE-PENDING — xem §7.1): poll payment_intents 3–5s/lần
  CHỈ trong lúc có intent pending → thấy status='paid' → reload entitlement → unlock UI
```

### Webhook handler (Supabase Edge Function)

```ts
// supabase/functions/sepay-webhook/index.ts  (AS-BUILT)
Deno.serve(async (req) => {
    const rawBody = await req.text();
    // Verify HMAC-SHA256: sha256=HMAC(timestamp + '.' + rawBody, SEPAY_WEBHOOK_SECRET)
    const expected = 'sha256=' + await hmacSha256Hex(secret,
        req.headers.get('x-sepay-timestamp') + '.' + rawBody);
    if (!timingSafeEqual(req.headers.get('x-sepay-signature') ?? '', expected))
        return json(false, 'invalid signature', 401);

    const body = JSON.parse(rawBody);
    if (String(body.transferType ?? 'in') !== 'in') return json(true, 'ignored', 200);
    const m = String(body.content ?? '').match(/SP(\d{3,30})/i);   // 'SP' + reference
    if (!m) return json(true, 'no reference', 200);                // ack → SePay khỏi retry

    const { data, error } = await supabase.rpc('confirm_payment', {
        p_reference: m[1],
        p_amount: Math.round(Number(body.transferAmount ?? 0)),
        p_sepay_tx_id: body.id != null ? String(body.id) : null,  // null khi thiếu → tránh dedup nhầm ''
    });
    return error ? json(false, error.message, 500)   // 500 → SePay retry (lỗi tạm)
                 : json(true, String(data ?? 'ok'), 200);
});
```

`confirm_payment` là 1 RPC atomic (function plpgsql) — kiểm intent, insert sub, update intent status trong cùng transaction để tránh double-credit.

### Edge cases

- **Webhook duplicate** (SePay retry): UNIQUE constraint trên `sepay_tx_id` → idempotent.
- **Amount sai** (user gõ thiếu/thừa): tolerance ±1000đ. Lệch lớn hơn → status='manual_review', không tự cộng sub.
- **Reference không match**: log + email admin. User có thể gửi screenshot CK.
- **Intent expired** (>30 phút) trước khi user CK: status = 'expired' bằng cron job. Webhook gặp expired ref → từ chối, gợi ý user tạo intent mới.
- **Webhook mất / mạng rớt giữa chừng** ⚠️ rủi ro nặng nhất (mất tiền thật): client không nhận được tín hiệu → kẹt. → bắt buộc có **poll-while-pending** (tự bắt kịp ở lần poll sau) + **admin reconciliation** (đối soát thủ công).
- **Race gia hạn** (2 webhook cùng address): tính `valid_from = max(today, latest.valid_to + 1)` phải nằm trong RPC với `SELECT … FOR UPDATE`.
- **Bundle/all-branches**: 1 lần CK ghi nhiều row (module × chi nhánh) phải **atomic** theo 1 intent — `confirm_payment` insert tất cả trong cùng transaction.

### 7.1 — Cơ chế chờ xác nhận: chọn **c + a** (quyết định 2026-06-06)

Khi bật payment (Phase 3) làm **c (backend) + a (poll-while-pending)**, KHÔNG dùng realtime cho payment.

- **c — Backend (bắt buộc, là phần "sản xuất" dữ liệu):** Edge Function `sepay-webhook` + RPC `confirm_payment` (atomic, idempotent) + RPC `create_payment_intent` + sinh QR VietQR. Listener/poll chỉ là phần "tiêu thụ" → vô nghĩa nếu thiếu c.
- **a — Frontend (poll-while-pending):** khi có `payment_intents.status='pending'` → poll 3–5s/lần, dừng khi `paid`/`expired`.

**Vì sao poll-while-pending, không phải realtime:**

| | Poll-while-pending (chọn) | Realtime (`postgres_changes`) |
|---|---|---|
| Mạnh | Đơn giản · scale ngang vô hạn (stateless) · **sống sót khi mất mạng** · không đụng quota realtime · qua mọi proxy | Tức thì <1s |
| Yếu | Trễ ≤5s (vô nghĩa vì CK ngân hàng đã mất 5–30s mới tới) | Quota ~500 conn (Pro) · RLS auth-check mỗi event × mỗi client · **mất event khi rớt** · bottleneck ở ~10k đồng thời |

Payment là sự kiện **tần suất thấp, thời lượng giới hạn** → 5s trễ không đáng; realtime mua lấy ~4s nhưng kéo theo mọi rủi ro scale + mất-event. Giữ realtime cho thứ cần tức thì thật (orders), không phải "đợi 1 cú chuyển khoản".

**Về 10.000 manager đồng thời:** logic DB/RPC chịu được (payment rời rạc, write nhẹ, idempotent). Nút thắt là **tầng chờ**: realtime KHÔNG đạt 10k (quota + per-event auth); poll-while-pending đạt vì stateless. Edge Function cần **transaction-mode pooler** để khỏi cạn connection khi burst.

**✅ AS-BUILT (2026-06-10 → 2026-07-13):** ship đầu tiên dùng realtime (`usePaymentListener` nghe INSERT `address_subscriptions`), sau đó thêm `usePaymentPoll` chạy song song làm lưới an toàn. Rà lại kiến trúc realtime toàn hệ thống (2026-07-13) phát hiện phạm vi quota rộng hơn phần payment này — có thêm 2 kênh khác (`orders-realtime`, `shift-closing-db`, xem bên dưới) — nên đã **bỏ hẳn `usePaymentListener`**, chỉ còn `usePaymentPoll` (poll 4s/lần, dừng khi paid/expired) làm cơ chế xác nhận duy nhất. Migration `20260713_drop_payment_realtime.sql` gỡ `address_subscriptions` khỏi `supabase_realtime` publication. Đúng như kế hoạch ban đầu ở đầu §7.1 — không còn realtime cho payment.

**✅ AS-BUILT (2026-08-13) — orders cũng bỏ realtime, chuyển sang poll.** Câu "giữ realtime cho thứ cần tức thì thật (orders)" ở trên **không còn đúng**. Hai lý do:

1. **Cổng chưa từng mở.** `hasMultiDevice = countActiveSessions(addressId) >= 2` dựa vào `active_sessions`, mà bảng đó upsert `onConflict: 'user_id'` → **hai máy đăng nhập cùng một tài khoản chỉ sinh MỘT dòng**. Đếm ra 1, kênh không bao giờ subscribe, không máy nào broadcast. Tức là ca dùng phổ biến nhất — quán nhỏ, một tài khoản, hai điện thoại — chưa từng đồng bộ được ngày nào.
2. **Không tới được quy mô.** Kể cả khi cổng mở: 1000 quán × 2 máy = 2000 kết nối đồng thời, **vượt trần ~500**. Đúng nút thắt đã mô tả ở §7.1 cho payment. Thêm nữa mỗi sự kiện realtime kéo `fetchTodayOrders` (join lồng `order_items` + `products` của cả ngày) trên MỌI máy — đơn thứ 300 trong ngày kéo 300 dòng về từng máy một.

**Cơ chế mới** (`src/hooks/useOrdersPoll.js`): poll `orders` có diff theo id, **chỉ cột vô hướng**, không join; chỉ đơn thật sự mới mới tốn thêm một lượt fetch kèm món. Cổng theo màn hình (`/pos` hoặc `/history`) — miễn phí, không bao giờ trả lời sai. Poll ngay khi tab hiện lại. Stateless, scale ngang.

**✅ AS-BUILT (2026-08-13, bản 2) — watermark, nhịp xuống 888ms.** Bản đầu poll 5s và mỗi nhịp tải về đầu đơn **cả ngày** chỉ để so. Chi phí = `số nhịp × số đơn`, nên quán càng đông thì payload càng to *mà* càng muốn nhịp nhanh — không mua được độ trễ bằng cách hạ khoảng nhịp. Đo thật (gzip, 12h, 200 đơn/ngày/máy): 5s → 28 MB, 2s → 69 MB, 1s → 137 MB.

`20260813_orders_sync_marks.sql` thêm bảng `order_sync_marks(address_id, rev)` do trigger trên `orders` nuôi, cùng RPC `orders_sync(p_address_id, p_rev)`: client gửi kèm `rev` đang giữ — khớp thì trả đúng con số đó và **không đọc `orders` dòng nào** (~80 byte), lệch mới trả mảng đầu đơn. Chi phí thành O(1) theo số đơn ⇒ nhịp **888ms tốn ~17 MB/máy/ngày, vẫn rẻ hơn nhịp 5s cũ (28 MB)** — và đó là cận trên, mạng chậm thì ít nhịp hơn. Timer hẹn sau khi phản hồi về nên chu kỳ thật = 888 + RTT; đo trên máy thật (RTT 175ms) ra **nhịp 1,06s**, trễ điển hình **~0,5s** — lọt dưới 1s mà không cần realtime. Mạng chậm thì nhịp tự giãn theo RTT chứ không dồn hàng đợi. Giá phải trả không nằm ở băng thông (thân phản hồi 9 byte, tốn kém là header HTTP + JWT) mà ở lần đánh thức radio trên máy chạy 3G/4G; máy POS ngồi wifi quán thì gần như miễn phí. `FAST_MS` phải luôn **> `MIN_GAP_MS` (800)**, nếu không sàn tần suất ăn cả nhịp bình thường chứ không chỉ cắt chùm `visibilitychange`. Gỡ luôn cơ chế giãn nhịp 15s lúc vắng: nó sinh ra để né chi phí của nhịp nhanh, mà chi phí đó không còn.

Vì sao **không** quay lại realtime cho orders dù muốn <1s: chi phí realtime tính theo **số kết nối đồng thời** (trần cứng ~500) và tăng tuyến tính theo số máy; watermark tính theo **số sự kiện thật**, tầng chờ vẫn stateless. Đúng lập luận §7.1 đã dùng cho payment. Muốn dưới ~300ms thì mới bắt buộc realtime, và lúc đó phải chấp nhận trần kết nối.

`rev` là số **đục**: `bulk_create_orders` insert rồi update lại tổng nên một đơn có thể bump 2-3 lần. Client chỉ so bằng/khác. Mốc `rev` ghi **sau cùng**, chỉ khi đã áp xong thay đổi — ghi sớm rồi hydrate hỏng giữa chừng là nhịp sau thấy "không đổi" và đám đơn đó mất vĩnh viễn (bản quét cả ngày tự lành được, bản watermark thì không).

Kèm theo: `20260813_drop_orders_realtime.sql` gỡ `orders` khỏi publication; xoá luôn vòng poll `countActiveSessions` 30s/máy (~2880 query/ngày/máy) vốn chỉ để trả lời một câu boolean. Heartbeat `upsertSession` giữ lại (5 phút/lần) cho màn `/addresses`. **Còn lại đúng một kênh realtime toàn hệ thống: `shift-closing-db`** — xem block ngay dưới.

**✅ AS-BUILT (2026-08-13) — `shift-closing-db` GIỮ realtime, chỉ gỡ cổng.** Đoạn "Rà soát mở rộng (2026-07-13)" bên dưới khoe đã thêm gate multi-device cho kênh này *"để nhất quán với `orders-realtime`"*. Chính gate đó làm kênh **không bao giờ mở** — cùng lỗi đếm `countActiveSessions` mô tả ở mục 1 trên. Bộ merge hai chiều của kiểm kê (merge RPC per-field ở server + `reconcileFromRemote` per-ô ở client + toast xung đột) đã xây xong từ 2026-06-19 nhưng gần như chưa chạy ngày nào. Đã xoá gate; `countActiveSessions` giờ không còn ai gọi nên xoá khỏi `authService.js`.

**Vì sao kênh này KHÔNG chuyển sang poll như orders** (hai tải khác nhau, không phải thiếu nhất quán):

| | `orders` → poll | `shift-closing-db` → giữ realtime |
|---|---|---|
| Thời lượng kênh | cả ngày, mọi máy | vài phút/ngày/máy — hook chỉ sống trong `DailyReportPage` |
| Quy mô kết nối | 1000 quán × 2 máy = 2000 (vượt trần ~500) | quán kết ca rải rác ≈ dưới 100 đồng thời |
| Tính chất dữ liệu | chỉ-thêm-mới, ai thấy trước sau đều như nhau | **hai người cùng soạn một form** — màn duy nhất trong app như vậy |
| Giá của trễ 5s | không đáng kể | B chưa kịp thấy ô A vừa điền nên gõ đè; `reconcileFromRemote` giữ ô dirty của B ⇒ số của A mất. `CONFLICT_WINDOW_MS = 8000` chỉnh theo giả định echo về trong vài trăm ms |

`shift_closings` **ở lại** trong publication `supabase_realtime` (migration 20260619) — không có migration nào cho đợt này. Bù cho điểm yếu mất-event của realtime: quay lại tab thì `DailyReportPage` kéo lại phiếu chốt một lần và áp qua đúng đường merge per-field.

**Kèm theo — sửa bug mất tiền ở "Lưu thực thu" (độc lập transport).** `handleSaveCashflow` trước đây UPDATE cả `actual_cash` lẫn `actual_transfer` lấy từ state local: A đếm két, B đối chiếu bank, ai bấm Lưu sau đè số người trước bằng bản cũ của mình. `reportService.ts` đã ghi nhận và **chấp nhận** last-write-wins ở đây, nhưng chấp nhận đó dựa trên giả định "một người chốt" — use case hai máy phá đúng giả định đó. Giờ `buildCashPayload()` chỉ gửi ô đã đổi (không đổi gì → `null`, không gửi request); cùng sửa một ô thì vẫn ai lưu sau thắng (hai người đếm cùng một con số). Test: `tests/report/cashPayload.test.js`.

**Rà soát mở rộng (2026-07-13):** ngoài payment còn 2 kênh realtime khác dùng chung quota: `orders-realtime-${addressId}` (`POSContext.jsx`, core order-sync đa thiết bị — **giữ nguyên**, đã gate đúng: chỉ mở khi ≥2 phiên hoạt động cùng địa chỉ + tab foreground) và `shift-closing-db-${addressId}` (`useShiftInventoryState.js`, đồng bộ kiểm kê cuối ca — **trước đó KHÔNG có gate**, mở kênh cho mọi thiết bị vào trang Báo cáo dù chỉ 1 thiết bị/địa chỉ). Đã thêm cùng gate multi-device (`countActiveSessions` ≥2, re-check mỗi 5 phút) cho `shift-closing-db` để nhất quán với `orders-realtime` và cắt phần lớn kênh vô nghĩa ở quy mô lớn.

### 7.2 — Trạng thái: c ĐÃ LIVE (2026-06-10 → 06-12)

**Payment backend (c) đã build + deploy + chạy thật.** Tích hợp SePay thành công: user CK đúng QR (số tiền + nội dung `SP<reference>`) → tự nhận thanh toán + gia hạn, không cần admin thao tác. As-built:

- **Webhook** `supabase/functions/sepay-webhook/index.ts` — verify **HMAC-SHA256** (`x-sepay-signature` = `sha256=HMAC(timestamp + '.' + rawBody, SECRET)`), parse `SP<số>` khỏi nội dung CK, gọi `confirm_payment` bằng service_role. Chỉ xử lý `transferType='in'`; không khớp ref → ack 200 (SePay khỏi retry); lỗi tạm → 500 (SePay retry).
- **`create_payment_intent(address_ids[], months, amount)`** — SECURITY DEFINER, guard caller quản lý các chi nhánh; tái dùng intent pending còn hạn (cùng tập CN + cùng tiền) → QR ổn định; reference **số 12 chữ số**; intent hết hạn **24h**.
- **`confirm_payment(reference, amount, sepay_tx_id)`** — atomic + idempotent (dedup theo `sepay_tx_id`), `FOR UPDATE` chống race; thiếu tiền → `manual_review` (không tự cộng), dư tiền → chấp nhận; gia hạn nối tiếp §4. Check `app_config` kill switch (OFF → không ghi).
- **Xác nhận về client = poll-while-pending** (`usePaymentPoll`, poll `payment_intents.status` 4s/lần) — xem §7.1. Đổi từ realtime (`usePaymentListener`, đã bỏ 2026-07-13).

**Đã có sẵn (cứu rủi ro mất tiền thật):** server-side kill switch đọc `app_config` (flip không cần redeploy); idempotency theo `sepay_tx_id`; `manual_review` cho lệch tiền; **dashboard đối soát thủ công** — xem §7.3.

---

### 7.3 — Admin dashboard + đối soát thủ công (LIVE, 2026-07-13 → 07-14)

Trang admin nội bộ (route `/admin/dashboard`, `/admin/reconciliation`, chỉ role `admin`):

- **`admin_dashboard_overview`** (RPC, SECURITY DEFINER, tự chặn non-admin) — 1 lần gọi trả toàn bộ
  số liệu cho `/admin/dashboard` (`src/services/adminDashboardService.js`): doanh thu, số địa chỉ
  active/trial, delta MoM, danh sách "Cần chú ý" (gộp payment lệch/treo + sub sắp hết hạn + địa
  chỉ không hoạt động/đã rời bỏ + trial chưa dùng), feed hoạt động gần đây (payment/địa chỉ mới/
  referral/review). Migration `20260713_admin_dashboard_overview.sql` → vá đếm sai ở
  `20260714_admin_dashboard_overview_v2.sql`.
- **`admin_resolve_payment_intent(p_intent_id, p_grant)`** (RPC) — `/admin/reconciliation`
  (`src/services/reconciliationService.js`) resolve thủ công 1 intent `pending`/`manual_review`:
  cấp gói (đã đối soát sao kê khớp) hoặc bỏ qua. Có audit log
  (migration `20260714_admin_resolve_payment_intent_audit.sql`).
- Cùng trang: nút Mock/Reset gói (`admin_set_subscription`/`admin_reset_subscription`, xem #8 Decisions),
  xoá dữ liệu bán hàng theo địa chỉ (công cụ hỗ trợ, migration `20260709_admin_wipe_address_sales_data.sql`).

Bù lại phần "còn thiếu" ghi ở §7.2 gốc (viết lúc 2026-06-10, trước khi trang admin build) — nay đã xong.

---

## 8. Decisions

| # | Quyết định | Note |
|---|---|---|
| 1 | **2 module** (`cashflow`/`inventory`), không còn tier basic/pro. Gộp 2026-06-06: Báo cáo/Lợi nhuận vào `cashflow` | Hao hụt ở `inventory`; `cashflow` mở cả view Dòng tiền + Lợi nhuận |
| 2 | **Trial 14 ngày, 1 gói `all`, theo TỪNG ĐỊA CHỈ** (không còn giới hạn theo SĐT/account); **cấp + bắt đầu đếm** ở **ca chốt FULL đầu tiên** (thực thu + kiểm kho đủ) — trước đó free không giới hạn thời gian, không tạo sub row nào | Chi tiết §1 Trial. Đánh đổi có chủ đích: không trần thời gian nếu không bao giờ full-close; xoá-tạo-lại địa chỉ được trial mới (chấp nhận). Từ 2026-08-02: 7 → 14 ngày, và SĐT hết vai trò (đăng ký thu email thay SĐT) |
| 3 | **Năm = 888,888đ/module (~10 tháng)**; **Trọn bộ 2** = 166,888đ/th · 1,666,888đ/năm | Chiết khấu trọn bộ; năm tặng ~2 tháng |
| 4 | **All-branches = nhân theo số chi nhánh**, không giảm theo số lượng | Tạo row cho mọi address trong 1 lần trả |
| 5 | **Không refund, không prorating** | Đơn giản v1 |
| 6 | **Gia hạn nối tiếp** theo module (§4); module độc lập, không có quan hệ upgrade/downgrade | Mỗi module có valid_to riêng |
| 7 | **Status banner ở address card** (xem §6.B) — không banner header trên main app | KH thấy ngay từ Address Select |
| 8 | **Admin override**: RPC `admin_set_subscription(address_id, module, valid_to)` + UI admin | v1 cần cho support thủ công |
| 9 | **Mặc định OFF** — global flag (§9). Build infra trước, bật khi đủ signal | Tránh charge user khi chưa đủ ổn |
| 10 | **Xác nhận thanh toán = poll-while-pending** (`usePaymentPoll`); realtime (`usePaymentListener`) đã bỏ 2026-07-13 sau khi rà soát quota realtime toàn hệ thống (§7.1) | Backend (RPC/webhook) không đụng gì khi đổi; chỉ đổi cơ chế client bắt tín hiệu |
| 11 | **Payment backend (c) ĐÃ LIVE** (§7.2) — webhook SePay + `create_payment_intent` + `confirm_payment` chạy thật từ 2026-06-10 | Tự nhận CK + gia hạn; còn thiếu dashboard đối soát tay |

---

## 9. Feature flag (rollout control)

Monetization được wrap trong 1 **global kill switch**. Mặc định **OFF** trong toàn bộ
giai đoạn build + soft testing. Khi ON, toàn bộ logic gate/trial/payment kích hoạt.

### Behavior

| Flag | `useEntitlement()` trả về | UI behavior |
|---|---|---|
| **OFF** (mặc định) | `activeModules: ['cashflow','inventory','finance']` cho mọi address | Mọi view mở; không render UpsellGate/Sheet/banner; payment flow ẩn |
| **ON** | Query DB như bình thường | Đầy đủ gate + trial + payment |

Mục tiêu: dev/test feature trong môi trường giả lập "ai cũng Pro" — không cần CK,
không cần OTP signup mỗi lần test. Khi flip ON, **chỉ thay đổi entitlement source**,
không đụng feature code.

### Implementation

> ✅ **Đã implement (2026-06-09):** `useMonetizationEnabled()` trong `src/hooks/useEntitlement.js` —
> hiệu lực = client(build `VITE_MONETIZATION_ENABLED`) **AND** server(`app_config.monetization_enabled`,
> đọc runtime, cache module-level 1 request). Mọi consumer (DailyReportPage gate, SubscriptionBadge,
> SubscriptionPage route, usePaymentListener) dùng `enabled` runtime → flip `app_config` là đổi cả UI,
> **không cần redeploy**. Lỗi đọc config → fail-open OFF (không gate nhầm khách đã trả).
> ✅ **2026-06-11:** RPC `confirm_payment` check `app_config` đầu function — OFF → trả
> `'monetization_disabled'`, không ghi sub (migration `20260611_confirm_payment_killswitch_intent_expiry.sql`,
> kèm cron pg_cron dọn intent pending quá hạn mỗi giờ).

**Client** — env var build-time:
```sh
# .env.production / .env.local
VITE_MONETIZATION_ENABLED=false
```

```js
// src/hooks/useEntitlement.js
const ENABLED = import.meta.env.VITE_MONETIZATION_ENABLED === 'true';

export function useEntitlement() {
    if (!ENABLED) {
        return { activeModules: ['cashflow','inventory','finance'], loading: false };
    }
    // ... real query get_address_entitlement → activeModules = các module còn hạn
}
```

**Server** — DB config row (để admin flip không cần redeploy):
```sql
CREATE TABLE app_config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
INSERT INTO app_config(key, value) VALUES ('monetization_enabled', 'false');
```

RPC `confirm_payment` check `app_config` đầu function — nếu OFF, từ chối với
message "Monetization chưa được kích hoạt". Tránh data rác từ test webhook lẫn vào prod.

### Rollout phases

| Phase | Client flag | Server flag | Whitelist | Mô tả |
|---|---|---|---|---|
| **0 — Dev** (giờ) | OFF | OFF | — | Build infra, không charge ai |
| **1 — Internal test** | ON | OFF | Owner's addresses | Owner test full flow với CK giả/admin override; webhook tắt |
| **2 — Soft launch** | ON | ON | 3-5 trusted quán (admin grant Pro manual) | Thu phí thực, hỗ trợ thủ công, payment webhook live |
| **3 — Public** | ON | ON | Toàn bộ | Mở tự đăng ký, marketing |

Flip phase = đổi 1 env var (client) + 1 row trong `app_config` (server). Rollback nếu cần.

### Signals để flip

Phase 0 → 1: Implementation step 1-11 xong, owner test sub flow OK end-to-end.

Phase 1 → 2: hit các signal ở "Khi nào charge" — core stable ≥ 6 tuần + 1 trong 3 validation signals (retention / WOM / demand pull).

Phase 2 → 3: soft launch ≥ 1 tháng, conversion ≥ 50% trial→paid, churn < 20%/tháng.

---

## 10. Implementation order & Tracker

Hoàn toàn khả thi để bắt đầu làm Feature Flag, Schema, Trial grant và UI Gate trước. Lúc này, do chưa có Phone OTP, việc cấp trial có thể tạm móc vào user ID hiện tại (sẽ refactor ở Phase 2). Hướng tiếp cận này giúp hoàn thiện được UX/UI và ra mắt nội bộ sớm.

**Quy tắc cho Agent:** Đánh dấu `[x]` vào các task đã hoàn thành và commit cập nhật tài liệu này để các agent sau có thể tiếp nối dễ dàng.

### Phase 1: Core Foundation & UI Gates
*Mục tiêu: Xây dựng nền tảng DB, cấp quyền (dùng auth hiện tại tạm thời) và hoàn thiện các UI blocks.*

- [x] **Bước 1 (Feature flag):** Thiết lập env var `VITE_MONETIZATION_ENABLED`, tạo table `app_config`, và thêm bypass logic mặc định OFF cho toàn app.
  - `.env` → `VITE_MONETIZATION_ENABLED=false`
  - `src/hooks/useEntitlement.js` → bypass: khi OFF trả `{ tier: 'pro', validTo: '2099-12-31', loading: false, enabled: false }`
  - Migration: `supabase/migrations/20260511_monetization_phase1.sql`

- [x] **Bước 2 (Schema DB):** Tạo bảng `trial_grants`, `address_subscriptions`, `payment_intents` và RPC `get_address_entitlement`.
  - File: `supabase/migrations/20260511_monetization_phase1.sql`
  - RLS đã setup cho cả 4 bảng mới

- [x] **Bước 3 (Trial grant & Hook):** Custom hook `useEntitlement` + helper `hasFeature` đã hoàn thiện.
  - File: `src/hooks/useEntitlement.js`
  - ⚠️ Trial grant RPC `create_address` chưa implement (cần Phase 2 — Phone OTP) — sẽ cấp trial thủ công qua `admin_set_subscription` ở Phase 3

- [x] **Bước 4 (Gate Components):** Xây dựng component dùng chung: `<UpsellPage>` (full-screen) và `<UpsellSheet>` (bottom sheet).
  - `src/components/common/UpsellPage.jsx` — full-screen gate, hỗ trợ `required='basic'|'pro'`
  - `src/components/common/UpsellSheet.jsx` — bottom sheet gate, animate slide-up
  - CTA thanh toán là placeholder; sẽ connect Phase 3 (QR + SePay)

- [x] **Bước 5 (Gate Pages & Cards):**
  - `DailyReportPage` → gate toàn trang bằng `<UpsellPage required="basic">` khi `tier=null`
  - `RangeReportPage` → gate toàn trang tương tự; `RangeLossCard` bị ẩn/khóa khi `tier=basic` (Pro-only card placeholder)
  - `InventoryRefillCard` → audit tab bị khóa khi `tier=basic`; click → `<UpsellSheet required="pro">`
  - Prop `canAccessAudit` truyền từ DailyReportPage xuống InventoryRefillCard
  - ⚠️ Lịch sử: `InventoryRefillCard` đã bị xoá (2026-08) — ngày cũ dùng chung
    `PastInventoryEditor`, gate ở Bước R6 bên dưới đã gỡ audit-upsell từ trước đó.

- [x] **Bước 6 (Status Banner):** Hiển thị Banner trạng thái gói cước ở AddressSelectPage.
  - `src/components/AddressSelectPage/SubscriptionBadge.jsx` — badge per-address
  - Tích hợp vào `BranchGrid.jsx`; click → `<UpsellSheet>` mở tại AddressSelectPage
  - Khi `MONETIZATION_ENABLED=false` → badge hoàn toàn ẩn (zero render)

**⚠️ Phase 1 đã build theo mô hình CŨ (basic/pro).** Mô hình đổi sang **3 module độc lập** (2026-06-03) — cần rework. Code cũ vẫn chạy (flag OFF), nhưng giá trị `tier`, FEATURE_MATRIX, gate UI phải đổi.

### Phase 1b: Rework sang 3-module (2026-06-03)
*Mục tiêu: chuyển basic/pro → cashflow/inventory/finance. Flag vẫn OFF, không charge ai.*

- [x] **Bước R1 (Hook):** `useEntitlement` → export `MODULES` + `hasModule(activeModules, module)`; OFF **hoặc guest mode** trả đủ `['cashflow','inventory','finance']`. `hasFeature` giữ làm shim deprecated cho tới R3. (`src/hooks/useEntitlement.js`)
- [x] **Bước R2 (Migration):** `supabase/migrations/20260603_monetization_three_modules.sql` — drop CHECK basic/pro, convert legacy (pro→inventory, basic→split 3 row), add CHECK `tier IN ('cashflow','inventory','finance')` cho cả 2 bảng, refresh `get_address_entitlement`. Cột vẫn tên `tier` (lưu giá trị module).
- [x] **Bước R3 (Gate per-view):** `DailyReportPage` — bỏ gate toàn trang; gate từng view (cashflow/inventory/finance) bằng `<UpsellGate>`. Trang + footer luôn render. Chốt: **khoá cả view kể cả hôm nay** (trial 3–7 ngày + guest cho xem full). Khi loading entitlement → coi như có quyền (tránh nháy gate).
- [x] **Bước R4 (UI mở khoá thống nhất):** `SubscriptionScreen.jsx` (chrome full-screen, **header style /history**: back bo góc + chip "Đăng ký gói" + thanh tab = **chu kỳ Theo tháng/Theo năm**; giữ `period` state, truyền xuống panel controlled) + `SubscriptionPanel.jsx` (thân: chi nhánh multi-select + 3 toggle module + QR + tính tiền bundle/lẻ × số CN + admin mock). Route `/subscription` và tab báo cáo bị khoá đều render `SubscriptionScreen` → một UI duy nhất. Giá ở `src/constants/monetization.js`. 🗑️ Bỏ hẳn `UpsellGate.jsx` + `UpsellSheet.jsx` + `UpsellPage.jsx`.
- [x] **Bước R5 (Hao hụt → inventory):** Bỏ `canAccessAudit`/`required="pro"`; audit + RangeLossCard mở khoá cùng quyền `inventory` (view inventory đã gate sẵn → tới được card là đã có quyền).
- [x] **Bước R6 (Trang đăng ký gói duy nhất + Banner):** Gom mọi luồng mở khoá về **1 trang `/subscription`** (`src/pages/SubscriptionPage.jsx`) thay vì bottom-sheet rải rác.
  - Trang: danh sách chi nhánh user quản lý (multi-select + "Chọn tất cả") · 3 toggle module (chọn 1/2/3) · toggle tháng/năm · QR placeholder · tính tiền (3 module = giá bundle, <3 = cộng lẻ) × số chi nhánh · admin mock insert.
  - `SubscriptionBadge`: rework sang module (`Trọn bộ` / `N/3 gói` / `Mở khoá báo cáo`), **sửa bug `<button>` lồng `<button>`** → đổi sang `<span role=button>`. Click → `/subscription`.
  - Badge → `navigate('/subscription', { state })`; tab Báo cáo bị khoá → nhúng thẳng `<SubscriptionPanel>` (không điều hướng, cùng UI).
  - 🗑️ Xoá `UpsellGate.jsx` + `UpsellSheet.jsx` + `UpsellPage.jsx` (dead). Gỡ audit-upsell trong `InventoryRefillCard`.

**⚡ Trạng thái Phase 1b: HOÀN THÀNH** — gate per-view + trang đăng ký gói thống nhất, verify OK trên main:5173 (flag ON). Thanh toán QR/SePay vẫn placeholder (Phase 3).

### Phase 1c: Gộp 3 → 2 module (2026-06-06)
*Gộp Báo cáo/Lợi nhuận (finance) vào Dòng tiền (cashflow). Còn 2 sản phẩm bán.*

- [x] **Migration** `supabase/migrations/20260606_monetization_two_modules.sql` — trigger trial cấp 2 module, gộp `finance→cashflow`, CHECK còn `('cashflow','inventory')` cho cả 2 bảng.
- [x] `constants/monetization.js` — `MODULE_KEYS=['cashflow','inventory']`; `cashflow` meta gộp tài chính; `PRICE.bundle = 166,888đ/th · 1,666,888đ/năm`.
- [x] `useEntitlement.MODULES` → 2 module. `DailyReportPage` — view Lợi nhuận (profit) gate bằng quyền `cashflow`.
- [x] `SubscriptionPanel` — lưới **2 cột**, bundle khi chọn đủ 2 (`moduleCount===MODULE_KEYS.length`). `SubscriptionBadge` → `Trọn bộ`/`1/2 gói`.
- [x] Realtime listener (`usePaymentListener`) + migration `20260603_realtime_address_subscriptions.sql` (Phase 3 / Bước 10 — frontend phần). ⚠️ là **placeholder**, sẽ thay bằng poll-while-pending (xem §7.1).

### Phase 2: Phone OTP (chống trial abuse)

**Giai đoạn A (thu SĐT + bind trial) ĐÃ LIVE. Giai đoạn B (xác thực SĐT thật bằng OTP) CHƯA build** — xem `docs/phoneAuth.md` cho thiết kế + checklist Zalo Mini App / Twilio fallback.

- [x] **Bước 8 (Bind Trial to Phone):** RPC `set_my_phone(p_phone)` chuẩn hoá SĐT + bind trial 1-SĐT-1-lần; trigger `grant_trial_on_address_creation` cấp trial cho địa chỉ mới nếu owner đã có SĐT chưa dùng trial. Migration `20260611_phase2a_users_phone_trial_binding.sql`, vá 2 lỗ lách ở `20260622_fix_trial_phone_change_loophole.sql` (đổi số + xoá địa chỉ tạo lại).
- [ ] **Bước 7 (Phone OTP thật):** hiện chỉ THU số (đúng định dạng), CHƯA có bằng chứng sở hữu số (không OTP) — user có thể bịa số hợp lệ để lấy trial mới. Cần chọn 1 trong 2 hướng ở `docs/phoneAuth.md`: Zalo Mini App (`getPhoneNumber`, 0đ nhưng cần hộ KD/GPKD xác thực OA) hoặc Twilio OTP (tốn phí/SMS, không cần pháp nhân). Đang chờ owner xác nhận có hộ KD/GPKD chưa để chốt hướng.

### Phase 3: Payment Automation (SePay) & Admin
*Mục tiêu: Tự động hóa thanh toán, gia hạn, và công cụ quản trị tay.*

- [x] **Bước 9 (Webhook):** ✅ LIVE — `supabase/functions/sepay-webhook/index.ts` (HMAC-SHA256) + `create_payment_intent` + `confirm_payment` (atomic, idempotent, check `app_config`). Migration `20260610_sepay_payment_webhook.sql` (+ `20260611_confirm_payment_killswitch_intent_expiry.sql`: kill switch + cron dọn intent quá hạn).
- [x] **Bước 10 (QR & Realtime):**
  - [x] **Frontend listener:** `src/hooks/usePaymentListener.js` — Realtime sub `address_subscriptions` INSERT; nhúng vào `SubscriptionPanel`.
  - [x] Migration `20260603_realtime_address_subscriptions.sql` — Realtime publication + REPLICA IDENTITY FULL.
  - [x] **QR động** (VietQR/SePay): `SubscriptionPanel` build `qr.sepay.vn/img?...&amount=&des=SP<reference>` sau khi `create_payment_intent` trả reference.
  - [ ] (Tuỳ chọn) fallback polling nếu Realtime rớt — chưa làm; là bản migrate poll-while-pending ở §7.1 khi cần scale.
- [~] **Bước 11 (Admin Control):** RPC `admin_set_subscription` + mở khoá thủ công.
  - [x] RPC `admin_set_subscription(p_address_ids[], p_modules[], p_months, p_amount_paid, p_note)` — SECURITY DEFINER, guard `is_admin_auth`, quy tắc gia hạn nối tiếp (§4), all-or-nothing. Migration `20260608_admin_set_subscription.sql`.
  - [x] RPC `admin_reset_subscription(p_address_ids[], p_modules[]=NULL)` — xoá sub để dev/test lại flow gate (cùng migration). `p_modules=NULL` → xoá hết module.
  - [x] `SubscriptionPanel` (chỉ admin): nút "Mock mở khoá" gọi `admin_set_subscription` (thay client insert vào bảng chỉ có RLS SELECT) + nút "Reset gói" gọi `admin_reset_subscription`.
  - [x] Trang dashboard đối soát (`/admin/reconciliation`, list intent `pending`/`manual_review` + resolve có audit log) — xem §7.3.

### Phase 4: Optimization
*Mục tiêu: Tối ưu chi phí khi có lượng người dùng lớn.*

- [ ] **Bước 12 (Migrate OTP Provider):** Chuyển từ Twilio sang eSMS/Stringee qua Edge Function khi OTP volume vượt mốc cần tối ưu.

---

---

## 11. Referral / Share-clone program (thiết kế — 2026-06-20)

Gắn referral lên cơ chế **share-code nhân bản chi nhánh** (chủ hệ thống phát mã → manager mới clone config sang địa chỉ của họ). Referral chỉ là *thưởng* dán lên luồng clone đó.

### Cơ chế
- **Quy tắc:** địa chỉ được mời (clone từ mã của chủ hệ thống) **đăng ký gói trả phí LẦN ĐẦU thành công** → người mời (chủ địa chỉ nguồn) được **+1 tháng**.
- **Attribution:** rơi ra free từ share-code. Lúc clone, lưu `addresses.referred_from_address_id` = địa chỉ nguồn. Đây là **việc rẻ-cứu-tương-lai — làm NGAY cùng share-code**, kể cả khi chưa build reward.
- **Trigger:** trong `confirm_payment`, khi insert sub trả phí (`amount_paid > 0`) **đầu tiên** của địa chỉ referee → cộng 1 tháng cho địa chỉ nguồn (gia hạn nối tiếp §4, `amount_paid=0`, note `'referral_reward'`).
- **Tiền đề tự cấp vốn:** reward chỉ bắn KHI referee đã trả tiền thật → mỗi reward gắn 1 doanh thu lớn hơn nhiều. VD 100 referral = 100 địa chỉ trả phí ≈ **88.888.880đ thu**, thưởng ≈ 100 tháng ≈ **15.000.000đ** → net dương. **Không cần cap.**

### v1 (lazy) — chốt
- **Thưởng tự động vào ĐỊA CHỈ NGUỒN** (cái đã clone ra), **không** cho người mời chọn địa chỉ khác. Bỏ "chọn địa chỉ" vì nó kéo theo ledger-reward-chờ-áp + UI → để dành tới khi có người thực sự đòi.
- **1 lần / referee** — cần cờ "đã thưởng" (vd cột trên địa chỉ referee hoặc bảng `referral_rewards`) để branch thứ 2 / lần CK sau không farm thêm.
- **KHÔNG bắt đứng sau Phone OTP** (quyết định 2026-06-20). Payment đã live → reward build được ngay sau attribution.

### Edge cases (đã chốt 2026-06-20)
1. **Tự giới thiệu** — rủi ro **thấp, chấp nhận**: quản lý 2 account cực hơn 1, đặc biệt khi nhiều chi nhánh; lại phải trả tiền thật mới được thưởng. Không build chống gì cầu kỳ, chỉ theo dõi.
2. **Refund / admin reverse** ✅ — nếu 1 payment bị đảo thủ công thì reward tương ứng phải **clawback**. Cần xử lý khi build.
3. **"Lần đầu"** ✅ — phải là sub trả phí *đầu tiên của referee* (không phải trial, không phải branch thứ 2). Thưởng 1 lần — cờ đã-thưởng (xem v1).
4. **Trần liability** — **không cần** (self-funding, xem trên).

### Trạng thái
- ✅ **Attribution:** `addresses.referred_from_address_id` set khi clone qua share-code (migration `20260620_address_share_code.sql`).
- ✅ **Reward:** hook trong `confirm_payment` — +1 tháng cho địa chỉ nguồn mỗi khi địa chỉ được-mời thanh toán LẦN ĐẦU; dedup bằng `addresses.referral_rewarded_at` (migration `20260620_referral_reward.sql`). Tự cấp vốn, không cap (xem trên).
- ⏳ **Clawback:** chưa build — cần admin reverse-payment flow để hook vào.

### TODO (cải tiến)
- [ ] **Hiển thị reward cho người mời** — hiện reward chỉ là 1 row `address_subscriptions` (note `referral_reward`) lặng lẽ, người mời chỉ thấy badge "còn nhiều ngày hơn", KHÔNG biết vì sao. Một referral program hiệu quả phải *cho người mời thấy*: "Bạn đã mời N chi nhánh → nhận N tháng". Đề xuất: thống kê (đếm `address_subscriptions` note=`referral_reward` của các địa chỉ thuộc owner) + toast/badge khi nhận thưởng. Đây là gap UX lớn nhất cho hiệu quả referral.
- [ ] **Self-referral đã loại** (cùng `manager_id` không thưởng) — nếu sau này cần *cho phép* thì gỡ guard trong `confirm_payment`.

---

*Cập nhật lần đầu: 2026-05-10. Sửa lớn 2026-06-03: tier basic/pro → 3 module độc lập (cashflow/inventory/finance) + giá năm + bundle + all-branches. 2026-06-20: đồng bộ as-built payment backend LIVE (SePay webhook + confirm_payment + QR động + realtime, §7) + thêm §11 Referral. 2026-07-13: rà soát quota realtime toàn hệ thống → bỏ `usePaymentListener` (chỉ còn poll-while-pending), thêm gate multi-device cho `shift-closing-db` (§7.1); thêm §7.3 Admin dashboard + đối soát thủ công LIVE. 2026-07-17: chuỗi 4 migration cùng ngày đổi hẳn cơ chế trial — `_1_` yêu cầu ca chốt FULL (không phải bất kỳ lần chốt ca nào) mới neo lại; `_2_` bỏ cấp trial lúc tạo địa chỉ, chỉ cấp ở ca full đầu tiên (trước đó free không giới hạn thời gian); `_4_` bỏ luôn giới hạn "1 SĐT = 1 trial" — mỗi ĐỊA CHỈ có vòng đời trial độc lập, đồng thời DROP RPC `list_pending_trial_addresses` (thêm ở migration trung gian) vì hết cần thiết. §1/§5/§6/§8 đồng bộ theo bản cuối cùng (`20260717_trial_4_per_address_not_per_phone.sql`). Sửa khi mô hình thay đổi — KHÔNG để doc này lệch với code.*
