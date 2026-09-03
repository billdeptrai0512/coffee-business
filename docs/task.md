# ✅ ĐÃ XONG (giao cho Gemini, hoàn thành) — Sửa phiếu nhập kho tại chỗ

> **Trạng thái:** đã build đủ — RPC `edit_ingredient_restock` (migration `20260616_edit_ingredient_restock.sql`,
> vá cascade backdate ở `20260617_fix_backdate_cascade.sql`) + `editIngredientRestock` trong
> `restockService.ts` + `RestockModal` mode `edit` + nút bút chì trong `IngredientHistoryTab`.
> Giữ nguyên spec gốc bên dưới làm tài liệu tham khảo thiết kế.
>
> **Đọc kỹ trước khi code.** Đây là codebase THẬT đang chạy production, KHÔNG phải sandbox.
> Bắt buộc tuân `CLAUDE.md` (đặc biệt mục Migrations chống regression Security Advisor).
> Trong lúc làm, nếu phát hiện bug nào khác (kể cả ngoài phạm vi task) → **cứ fix luôn**, ghi rõ trong commit.
>
> **Lưu ý phối hợp:** Claude vừa merge loạt fix báo cáo (commit `51c252e`, `a9d5ed7`) + migration
> `20260616_shift_closing_dedupe_unique.sql` (CHƯA apply lên DB — owner sẽ tự chạy). Đừng đụng
> vào phần đó. Branch hiện tại: `main`.

## Mục tiêu
Thêm tính năng **sửa (modify) phiếu nhập kho** trên thẻ Nhật ký của 1 nguyên liệu — parity với
thẻ chi phí (`/history` đã có "bấm thẻ để sửa"). Hiện thẻ nhập kho chỉ có **Hủy** (trash) +
**trả nợ** (tap → payment sheet). Cần thêm **sửa tại chỗ**: số lượng, tổng tiền, chi phí thêm,
giảm giá, phương thức TM/CK, đã thanh toán, ngày mua.

## Cách tiếp cận đã chốt: **RPC sửa tại chỗ** (KHÔNG hủy+tạo lại)
Hủy+tạo lại bị loại vì để lại thẻ "ĐÃ HỦY" rác + đổi giờ tạo. Làm RPC `edit_ingredient_restock`
cập nhật chính dòng expense đó trong 1 transaction.

### ⚠️ 2 SỰ THẬT CỐT LÕI phải hiểu trước khi viết RPC (nếu hiểu sai sẽ tạo bug tồn kho/giá vốn)
1. **Tồn kho là DỮ LIỆU SUY RA, không có bảng tồn để ghi.** `fetchIngredientStocks` tính
   warehouse = `Σ(refill.metadata.qty)` − `Σ(restock-to-counter trong shift_closing)`. Nên chỉ
   cần **UPDATE `metadata.qty` + `amount`** trên dòng expense là tồn warehouse tự đổi theo.
   **TUYỆT ĐỐI KHÔNG** gọi thêm `adjustIngredientStock` cho phần delta qty → sẽ trừ/cộng tồn 2 lần.
2. **WAC (giá vốn) hiện có 2 mô hình KHÁC NHAU trong code — phải chọn 1 cho nhất quán:**
   - `process_ingredient_restock`: moving-average tăng dần dùng tồn quầy hiện tại
     (`(stock*old_cost + amount)/(stock+qty)`).
   - `cancel_restock`: tính lại TRUNG BÌNH toàn bộ = `Σamount / Σqty` trên các phiếu mua thật
     còn sống (is_refill, không adjustment, không cancelled, amount>0).
   → **Edit RPC PHẢI recompute WAC kiểu `cancel_restock`** (full re-average sau khi đã cập nhật
     dòng). Đây là cách duy nhất cho kết quả **tất định, không phụ thuộc thứ tự sửa**. Dùng kiểu
     moving-average của process sẽ ra số sai khi sửa phiếu cũ.

## Backend — migration mới `supabase/migrations/<YYYYMMDD>_edit_ingredient_restock.sql`
Tạo `edit_ingredient_restock(p_address_id UUID, p_expense_id UUID, p_qty NUMERIC, p_subtotal NUMERIC,
p_discount NUMERIC, p_extra_cost NUMERIC, p_initial_payment NUMERIC, p_payment_method TEXT,
p_cash_phase TEXT, p_created_at TIMESTAMPTZ, p_staff_name TEXT)` — `RETURNS JSONB`, `SECURITY DEFINER`,
`SET search_path = public`. Logic:
1. **Ownership guard** y nguyên pattern 20260520/20260612 (admin OR `manager_id = auth_owner_id(auth.uid())`
   OR `user_address_access`; skip khi `auth.uid() IS NULL`). RAISE `insufficient_privilege` nếu fail.
2. `SELECT ... FOR UPDATE` dòng expense; validate: tồn tại, `is_refill=true`, **KHÔNG**
   `metadata.adjustment`, **KHÔNG** `metadata.cancelled` (RAISE nếu vi phạm). Adjustment/withdrawal
   không sửa qua RPC này.
3. Validate input: `p_qty>0`, `p_subtotal>0`, `p_discount>=0`, `p_extra_cost>=0`.
   `v_amount = max(0, subtotal − discount + extra_cost)`.
4. UPDATE expenses: `amount=v_amount`, `discount_amount`, `extra_cost`, `payment_method`,
   `created_at` (nếu đổi ngày), và merge `metadata` mới `qty`, `subtotal`, `cash_phase`. Giữ
   `before_stock`; set `after_stock = before_stock + p_qty` (xem edge case #4).
5. **Reconcile payment**: cách đơn giản & tất định = `DELETE FROM expense_payments WHERE expense_id`
   rồi INSERT lại 1 payment = `min(p_initial_payment, v_amount)` (nếu >0) với method/phase/paid_at.
   `paid_at = COALESCE(p_paid_at hoặc p_created_at, created_at cũ)`; phải thỏa
   `chk_payment_paid_at_not_before_created` (paid_at ≥ created_at) **và** không trước ngày VN của
   created_at. **Đánh đổi**: gộp nhiều lần trả thành 1 → mất lịch sử trả từng phần (chấp nhận cho v1,
   ghi chú trong comment).
6. Recompute WAC kiểu `cancel_restock` (full re-average) → UPDATE `ingredient_costs.unit_cost`.
7. `REVOKE ... FROM PUBLIC, anon; GRANT ... TO authenticated;` (signature mới — bắt buộc theo CLAUDE.md).
8. Idempotent / chạy lại an toàn; bọc `BEGIN; ... COMMIT;`.

## Service layer — `src/services/restockService.ts`
Thêm `editIngredientRestock(addressId, expenseId, opts)` mirror `processIngredientRestock`:
- Online: `supabase.rpc('edit_ingredient_restock', {...})`, có **retry bỏ `p_cash_phase`** nếu
  `PGRST202`/`cash_phase` (RPC chưa migrate) — y như processIngredientRestock đã làm.
- **Guest path** (`localRepo.isGuest()`): update local expense + xoá/insert local payment + tính lại
  WAC local (Σamount/Σqty trên refill thật) qua `upsertIngredientCost`. Đừng bỏ quên guest.
- `invalidateReportCache(addressId)` cuối hàm.
- Export thêm ở `src/services/orderService.js` (file này re-export — kiểm tra cách nó re-export).

## UI
1. **`RestockModal.jsx`** — thêm chế độ sửa: prop `mode='edit'` + `initial={{ qty, subtotal,
   discount, discountMode, extraCost, paid, paymentMethod, cashPhase, purchaseDate, usePackMode }}`.
   Pre-fill toàn bộ state từ `initial`. Đổi tiêu đề → "Sửa phiếu nhập", nút → "Lưu thay đổi".
   `onConfirm` trả cùng shape như create. Lưu ý: `qty` lưu ở **base unit**; khi mở edit mặc định
   hiển thị base unit (đừng auto-bật pack mode trừ khi chia hết cho packSize).
2. **`IngredientHistoryTab.jsx` → `HistoryCard`** — thêm prop `onEditRestock`. Thêm **nút bút chì
   (Pencil) cạnh nút Hủy** ở góc thẻ, chỉ hiện khi `isRestock && !cancelled` (KHÔNG cho
   adjustment/withdrawal). GIỮ NGUYÊN hành vi tap→payment sheet khi đang nợ (đừng để 2 hành vi
   xung đột: tap thẻ = trả nợ, bút chì = sửa). `e.stopPropagation()` trên nút bút chì.
3. **`IngredientDetailPage.jsx`** — state `editingEntry`; `handleEditRestock(entry, form)` gọi
   `editIngredientRestock` rồi `Promise.all([reloadHistory(), reloadStock(), refreshProducts?.(),
   refreshTodayExpenses?.()])` (y như `handleCancelRestock` — WAC đổi nên phải refresh products +
   today expenses). Render `RestockModal` ở mode edit khi có `editingEntry`. Truyền
   `onEditRestock={canEdit ? setEditingEntry : null}` xuống tab.

## 🐞 EDGE CASE & BUG TIỀM ẨN (đã lường trước — xử lý hoặc ghi chú rõ)
1. **Trả nhiều hơn tổng mới**: user giảm tổng tiền xuống dưới số đã trả → payment mới clamp
   `min(paid, amount)`; phần dư coi như hoàn (vì ta xoá payment cũ insert lại). Đảm bảo không
   để `paid_total > amount` (vi phạm logic overpay).
2. **WAC mismatch** (mục cốt lõi #2): nếu lỡ dùng moving-average của process → số sai. Test:
   sửa 1 phiếu cũ giữa nhiều phiếu, kiểm tra `unit_cost` == `Σamount/Σqty`.
3. **Double-count tồn** (mục cốt lõi #1): nếu gọi adjustIngredientStock cho delta → tồn sai gấp đôi.
   Chỉ UPDATE metadata.qty.
4. **Snapshot `before/after_stock` drift**: snapshot là DISPLAY-ONLY, tính lúc tạo. Sửa qty của
   phiếu cũ làm running-balance các phiếu SAU nó lệch. v1: chỉ cập nhật `after_stock = before_stock
   + qty_mới` của chính dòng đang sửa, chấp nhận các dòng sau drift (ghi chú). Đừng cố tính lại
   snapshot toàn bộ (đắt + dễ sai).
5. **Backdate constraints**: `paid_at ≥ created_at` (chk_payment_paid_at_not_before_created) và
   không trước ngày VN của created_at. Khi đổi ngày mua lùi về quá khứ, neo `created_at` và `paid_at`
   cùng ngày (client neo 12h trưa VN như RestockModal đang làm).
6. **Concurrency**: `FOR UPDATE` để 2 lần sửa/hủy đồng thời không đua nhau.
7. **cash_phase**: chỉ áp khi trả tiền mặt; CK → 'post_close'. Giữ logic như RestockModal.
8. **Guest mode** không được bỏ quên (nhiều người dùng thử ở guest).
9. **Sửa phiếu đã bị Hủy / adjustment / withdrawal**: chặn ở cả RPC lẫn UI (không hiện nút bút chì).
10. **Phiếu đang nợ + đổi phương thức**: payment cũ bị xoá insert lại theo method mới — đảm bảo
    `expense.payment_method` (trên invoice) và payment đồng bộ.
11. **RPC chưa migrate ở production**: service phải retry-without-`p_cash_phase` để không vỡ
    nếu owner chưa chạy migration (giống processIngredientRestock).
12. **Refresh thiếu**: quên `refreshProducts` → giá vốn/COGS ở các màn khác giữ số cũ. Phải refresh đủ.

## 📌 Bổ sung — prefill chính xác, thực tế apply, ngoài phạm vi
**Map prefill RestockModal (mode=edit)** — đọc từ `entry` (expense), KHÔNG đoán:
- `qty`        ← `entry.metadata.qty` (base unit; mặc định hiển thị base, không tự bật pack mode).
- `subtotal`   ← `entry.metadata.subtotal` (KHÔNG phải `amount`).
- `discount`   ← `entry.discount_amount`, **discountMode='amount'** luôn (DB chỉ lưu tuyệt đối,
                 không khôi phục được %; đừng cố suy ngược phần trăm).
- `extraCost`  ← `entry.extra_cost`.
- `paid`       ← `Σ entry.payments[].amount`.
- `paymentMethod` ← `entry.payment_method`; `cashPhase` ← `entry.metadata.cash_phase` (fallback 'post_close').
- `purchaseDate`  ← ngày VN của `entry.created_at` (dùng `dateStringVN`).

**Thực tế apply migration (đọc kỹ, đừng loay hoay):**
- Gemini KHÔNG có service role → KHÔNG tự chạy được migration. Owner sẽ apply (ghi vào mục
  "Việc cần làm trên Supabase" của task.md này khi xong). Trước khi apply, gọi `edit_ingredient_restock`
  sẽ lỗi PGRST202 — **chấp nhận** (toast lỗi), ĐỪNG viết fallback client-side để "chạy không cần RPC"
  (sẽ tự tính WAC/tồn ở client → sai và lệch với server).
- Retry-bỏ-`p_cash_phase` chỉ xử lý khi hàm TỒN TẠI nhưng thiếu param (lệch signature); KHÔNG cứu
  trường hợp hàm chưa tồn tại. Đừng nhầm 2 ca này.

**Ngoài phạm vi — ĐỪNG đụng:**
- KHÔNG sửa `process_ingredient_restock` để "đồng bộ" mô hình WAC. Divergence moving-avg (process)
  vs full-avg (cancel) là nợ kỹ thuật có sẵn; đổi hành vi tạo phiếu = rủi ro hồi quy. Edit RPC chỉ
  cần dùng full-avg (khớp cancel) là đủ nhất quán cho luồng sửa/hủy.
- KHÔNG đổi cách tính/định nghĩa tồn kho. KHÔNG đụng migration `20260616` (báo cáo, owner chưa apply).

## ✅ Acceptance
- [ ] Sửa qty/giá 1 phiếu → tồn warehouse + WAC + tổng tiền nhập (SummaryStrip) cập nhật đúng,
      KHÔNG sinh thẻ rác, KHÔNG đổi giờ tạo (trừ khi user đổi ngày).
- [ ] Sửa phương thức TM↔CK phản ánh đúng ở Dòng tiền (Thực chi TM/CK — Claude vừa thêm).
- [ ] Sửa giảm số đã trả / tăng → trạng thái Đã trả/Còn nợ đúng.
- [ ] Guest mode sửa được.
- [ ] `npm run lint` (file mới sạch), `npm run typecheck`, `npx vitest run` đều xanh. Thêm test cho
      service edit nếu khả thi.
- [ ] Migration tuân CLAUDE.md: search_path + ownership guard + revoke/grant.

## Files đụng tới
- `supabase/migrations/<new>_edit_ingredient_restock.sql` (mới) + mirror vào `supabase/schema.sql` nếu cần.
- `src/services/restockService.ts`, `src/services/orderService.ts` (re-export).
- `src/components/IngredientManagementPage/RestockModal.jsx`
- `src/components/IngredientManagementPage/IngredientHistoryTab.jsx`
- `src/pages/IngredientDetailPage.jsx`
- Tham khảo (đọc, không sửa): `supabase/migrations/20260612_security_advisor_fixes.sql`
  (body process/record mới nhất + guard), `supabase/migrations/20260601_cancel_restock.sql`
  (mẫu re-average WAC + zero-out + grant).

---

# Task / Reminder — Monetization

> Payment backend đã LIVE (SePay webhook + `confirm_payment`, xem §7.2 bên dưới) + admin dashboard/
> đối soát thanh toán đã LIVE (§7.3). **Phase 2 (verify SĐT) đã HUỶ 2026-08-02** — xem mục Phase 2
> bên dưới. Nguồn chi tiết: `docs/MONETIZATION.md`.

## ✅ Migration — đã apply hết (2026-06-08)
Toàn bộ migration monetization đã chạy lên Supabase. Verify đạt: `address_subscriptions_tier_check`
= `CHECK (tier IN ('cashflow','inventory'))`; bảng sub/intent đang rỗng (chưa bán gói nào).

Đã apply: `20260511_monetization_phase1.sql`, `20260512_monetization_trial_trigger.sql`,
`20260520_security_hardening.sql`, `20260603_monetization_three_modules.sql`,
`20260603_realtime_address_subscriptions.sql`, `20260606_monetization_two_modules.sql`,
`20260608_admin_set_subscription.sql` (RPC admin set/reset),
`20260609_fix_get_address_entitlement_multimodule.sql` (fix: trả mỗi module 1 dòng).

## ⚠️ Việc cần làm trên Supabase
1. **Chạy migration (theo thứ tự, bỏ qua file đã chạy rồi):**
   - `20260609_admin_set_app_config.sql` — RPC cho nút toggle admin (server kill switch).
   - `20260609_single_plan_all_access.sql` — gộp về 1 gói `tier='all'`, trial 7 ngày, convert data test cũ.
   - `20260610_sepay_payment_webhook.sql` — RPC `create_payment_intent` + `confirm_payment` (webhook SePay).
   - `20260611_confirm_payment_killswitch_intent_expiry.sql` — `confirm_payment` check server kill switch (OFF → không ghi sub) + cron pg_cron dọn intent pending quá hạn mỗi giờ.
   - `20260611_phase2a_users_phone_trial_binding.sql` — `users.phone` + RPC `set_my_phone` + trigger trial bind theo SĐT (Giai đoạn A). ⚠️ Sau migration này: account chưa nhập SĐT tạo address sẽ KHÔNG có trial.
   - `20260612_fix_invoice_payment_same_day.sql` — fix `record_invoice_payment` từ chối trả nợ cùng ngày tạo hoá đơn (so sánh theo NGÀY VN thay vì timestamp; client neo 12h trưa).
   - `20260612_invoice_payment_cash_phase.sql` — toggle "Trong ca / Sau chốt ca" khi trả nợ NVL: cột `expense_payments.cash_phase` + `record_invoice_payment` nhận `p_cash_phase` (đã gồm fix ngày VN ở trên — chạy file này là đủ cả 2) + 3 report RPC trả thêm cờ này.
   - `20260612_security_advisor_fixes.sql` — dọn Security Advisor đợt 4 (chạy SAU file cash_phase): search_path 3 report RPC + revoke anon + **vá 2 lỗ ownership guard** trên `process_ingredient_restock` / `record_invoice_payment`.
   - `20260612_perf_advisor_fixes.sql` — dọn Performance Advisor: 5 policy wrap `(select auth.uid())` (initplan), tách `app_settings_admin_write` khỏi SELECT, 3 index FK monetization. Unused index GIỮ NGUYÊN (chủ đích — bảng còn nhỏ).
2. Set role admin cho tài khoản của bạn (chạy khi đang đăng nhập):
   `UPDATE users SET role = 'admin' WHERE auth_id = auth.uid();`
3. **Bật/tắt monetization runtime** (server kill switch, KHÔNG cần redeploy) — hoặc dùng nút toggle ở /addresses:
   `UPDATE app_config SET value = 'true'  WHERE key = 'monetization_enabled';`  -- bật
   `UPDATE app_config SET value = 'false' WHERE key = 'monetization_enabled';`  -- tắt (mọi thứ mở khoá)

## Mô hình giá (2026-06-09)
**1 gói all-access**: `tier='all'`, 888,888đ / 6 tháng / địa chỉ → mở cả 3 view (Dòng tiền + Lợi nhuận + Tồn kho).
Bỏ bán lẻ module, bỏ chu kỳ tháng/năm, bỏ bundle. Trial 7 ngày. Multi-branch = × số chi nhánh.

## Trạng thái flag (2 tầng — hiệu lực = client AND server)
- **Client** `.env` `VITE_MONETIZATION_ENABLED` = master capability build-time. `true` ở local.
  Build `false` → tắt cứng, không hỏi server.
- **Server** `app_config.monetization_enabled` = công tắc runtime (flip bằng UPDATE, không redeploy).
  ⚠️ Hiện seed = `'false'` → muốn test gate ở local phải UPDATE thành `'true'`.

## Còn lại (làm sau, không phải bây giờ)
- [x] **Server-side kill switch** đọc `app_config` runtime (flip không cần redeploy). `useMonetizationEnabled()` trong `useEntitlement.js`; mọi consumer (gate/badge/route/listener) dùng enabled runtime.
- [x] **Admin reconciliation**: RPC `admin_set_subscription` + `admin_reset_subscription` + nút admin trong SubscriptionPanel. Dashboard đối soát `payment_intents` (`/admin/reconciliation`, resolve có audit log) — LIVE 2026-07-13/14, xem `docs/MONETIZATION.md` §7.3.
- [~] **Phase 2**: thêm SĐT vào tài khoản → bind trial vào SĐT. **HUỶ 2026-08-02** — xem bên dưới.
- [x] **Phase 3 (c + a)** — xong 2026-06-10: Edge Function `sepay-webhook` (HMAC) + RPC `confirm_payment` + `create_payment_intent` + QR SePay + `usePaymentPoll` (poll-while-pending, chạy kèm realtime listener).
      Còn việc vận hành: deploy function + set secret + đăng ký URL webhook với SePay.

## ❌ Phase 2 — Thêm SĐT vào tài khoản — HUỶ 2026-08-02

> **Không làm tiếp giai đoạn B và C. Giữ mục này làm hồ sơ vì sao.**
>
> Mục tiêu ban đầu: 1 SĐT = 1 trial duy nhất, và verify SĐT thật để không ai bịa số lấy trial mới.
> Cái nền đó đã mất:
> - `20260717_trial_4_per_address_not_per_phone.sql` bỏ hẳn ràng buộc trial theo SĐT — mỗi ĐỊA CHỈ
>   có vòng đời trial độc lập, không quan tâm account/SĐT.
> - `20260802_trial_no_phone_requirement.sql` bỏ nốt điều kiện "phải có SĐT" trong trigger, cùng lúc
>   form đăng ký đổi field SĐT → Email (email là đường đặt lại mật khẩu, xem `ForgotPasswordPage`).
>
> Không còn gì để bảo vệ thì cũng không cần bằng chứng sở hữu số. SĐT nay chỉ là **thông tin liên hệ
> không bắt buộc** (admin gọi chủ quán khi đối soát thanh toán). Cột `users.phone`, RPC `set_my_phone`
> và bảng `trial_grants` vẫn còn cho dữ liệu lịch sử, không gate gì nữa.
>
> Bật lại khi nào? Chỉ khi trial quay về ràng buộc theo người/SĐT và có kẻ farm trial thật sự.

### Giai đoạn A — thu SĐT sau khi tạo tài khoản (chưa cần OTP, chi phí 0đ) — ✅ XONG 2026-06-11
- [x] Migration `20260611_phase2a_users_phone_trial_binding.sql`: cột `users.phone` (E.164 +84) + UNIQUE index partial + RPC `set_my_phone` (chuẩn hoá, validate, xử lý trial) + trigger mới.
- [x] UI (chốt với owner): field SĐT trong **modal tạo chi nhánh** khi chưa có phone (bảo đảm phone có TRƯỚC khi trigger trial chạy — bỏ trống = không trial) + **card Tài khoản ở tab Staff** (`AccountCard.jsx`) để xem/nhập/sửa. Cả 2 ẩn mồi trial khi monetization OFF.
- [x] Trigger `grant_trial_on_address_creation`: chỉ cấp khi owner **có phone** VÀ phone **chưa có trong `trial_grants`**; bỏ check "address đầu tiên" (trial_grants = nguồn chân lý 1 SĐT = 1 trial).
- [x] Backfill: `set_my_phone` lần đầu nhập số → nếu account đã từng nhận trial thì chỉ bind vào `trial_grants` (không cấp lại); nếu có address chưa từng có gói → cấp trial 7 ngày luôn (mồi "nhập SĐT = được trial" đúng cho cả user cũ).

### ❌ Giai đoạn B — verify SĐT thật — HUỶ, không làm

Nghiên cứu giữ ở `docs/phoneAuth.md` (Zalo Mini App `getPhoneNumber` 0đ; fallback Twilio OTP).
Chưa từng bắt tay code, và cũng không còn lý do: trial không bind theo SĐT nữa.

### ❌ Giai đoạn C — SĐT làm phương thức đăng ký — HUỶ, không làm

Đăng ký nay thu **email** thay SĐT (2026-08-02) — email vừa là kênh liên hệ vừa là đường đặt lại
mật khẩu, không tốn phí mỗi lần như SMS OTP. Muốn danh tính "không fake được" thì hướng rẻ hơn là
Google Sign-In, không phải OTP SMS.

*Cập nhật: 2026-08-02 (huỷ Phase 2). Nội dung trước đó: 2026-06-11.*

---

# 🆕 TASK (2026-07-03) — Hạ tầng, góc nhìn CTO

## A. Error tracking (Sentry) — ưu tiên cao
**Vấn đề:** PWA chạy trên điện thoại nhân viên ở 8 chi nhánh; mọi lỗi runtime hiện chỉ
`console.error` rồi biến mất. Khi quán báo "app không lưu đơn" không có gì để tra.
Vercel Analytics chỉ đo traffic, không bắt lỗi.
- [x] Tích hợp `@sentry/react` — init PROD-only trong `main.jsx` (DSN hardcode, không qua env —
  DSN client-side không phải secret); `captureException` gắn ở `useToast` (bọc phần lớn action
  async trong app, tag theo `action`), không chỉ ErrorBoundary.
- [ ] Gắn context mỗi event: addressId + role (KHÔNG gửi tên/SĐT — tránh PII) — chưa làm.
- [ ] `ErrorBoundary.jsx` (`src/components/common/ErrorBoundary.jsx`) vẫn chỉ `console.error`,
  CHƯA gọi `Sentry.captureException` — gap còn lại, lỗi render crash-toàn-trang không lên Sentry.
- [ ] Upload source maps khi build (vite plugin) — chưa làm, stack trace production còn minified.
- [ ] Alert email khi có lỗi mới — chưa xác nhận (cấu hình phía Sentry dashboard, không phải code).

## B. Test logic tiền ở tầng SQL
**Vấn đề:** 200 unit test hiện tại toàn utils JS. WAC, cash_phase, cascade tồn kho — chỗ
tiền thật — sống trong các RPC (`process_ingredient_restock`, `edit_ingredient_restock`,
`cancel_restock`, `record_invoice_payment`…) và không test nào chạm tới. Git log đầy
"fix tồn kho neo sai" — loại regression này chỉ chặn được bằng test chạy trên DB thật.
- [x] Supabase project staging (free tier), schema subset (`scripts/staging-inventory-schema.sql`,
      `scripts/staging-order-schema.sql`) thay cho `db push` toàn bộ migrations
- [x] Seed inline trong chính script assert (không tách file seed riêng) — 1 address + nguyên liệu +
      phiếu nhập/rút mẫu, tạo lại mỗi lần chạy
- [x] Script assert chạy RPC thật trên staging — `npm run test:inventory`
      (`scripts/test-inventory-staging.mjs`, 21 assert / 7 case: WAC lần đầu + moving-average, owing,
      `cash_phase`, `cancel_restock`) + `npm run test:money` (`scripts/test-money-staging.mjs`, 5 case
      cho `bulk_create_orders` — server tự tính giá, chặn cross-tenant). Chi tiết + case còn thiếu
      (cascade backdate, hủy giữa chuỗi nhiều phiếu, guest/local parity): `docs/SQL_MONEY_TESTS.md`.
- [ ] Chạy trong CI trước khi merge migration mới — `ci.yml` hiện chỉ chạy `lint`/`typecheck`/
      `test`/`check:search-path`, CHƯA gọi `test:inventory`/`test:money` (cần staging secret trong
      repo secrets).

*Thêm 2026-07-03. Mục index audit cùng đợt review đã kiểm xong — hot paths đủ index
(idx_orders_address_created v.v. từ các sweep 2026-05), không cần làm gì.*
