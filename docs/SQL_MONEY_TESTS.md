# Test logic tiền ở tầng SQL (staging + assert) — TASK

> Thêm 2026-07-03, từ đợt review hạ tầng.
>
> **2026-07-08**: đổi tên. Script gốc `test-money-staging.mjs` chỉ test tiền NHẬP KHO
> (WAC/cash_phase/owing NCC) → đổi tên `test:money` thành `test:inventory`
> (`scripts/test-inventory-staging.mjs`). `npm run test:money` giờ là script MỚI, test tiền
> BÁN HÀNG (`bulk_create_orders` — giá bán/giá vốn tự tính server-side, xem migration
> `20260708_bulk_create_orders_server_pricing.sql`). Phần lịch sử bên dưới nói về script
> nhập kho (nay là `test:inventory`) trừ khi ghi rõ khác.

## Vấn đề

200 unit test hiện tại (vitest) toàn utils JS thuần. Còn logic **tiền thật** — WAC (giá vốn
trung bình), `cash_phase` (trong ca / sau chốt), cascade tồn kho khi backdate/sửa/hủy phiếu —
sống trong các RPC Postgres và **không test nào chạm tới**:

- `process_ingredient_restock` — nhập kho, WAC moving-average, payment + cash_phase
- `edit_ingredient_restock` — sửa phiếu tại chỗ, WAC full re-average, cascade after_stock
- `cancel_restock` — hủy phiếu, hoàn tồn + tiền, WAC re-average
- `record_invoice_payment` — trả nợ NCC, paid_at + cash_phase độc lập với hoá đơn gốc

Git log đầy "fix tồn kho neo sai", "fix WAC" — loại regression này chỉ chặn được bằng test
chạy trên DB thật, vì bug nằm ở SQL chứ không ở JS. Thêm nữa: hiện migration được áp thẳng
lên production (không có staging) — mỗi lần DROP/CREATE function là một lần đánh cược.

## Việc cần làm

- [ ] **Supabase project staging** (free tier) — `supabase link` + `supabase db push` toàn bộ
  `supabase/migrations/`. Từ nay: migration áp staging TRƯỚC, chạy test, rồi mới áp prod.
- [ ] **Seed script** (`scripts/seed-staging.js` hoặc SQL): 1 user manager + 1 address +
  2 nguyên liệu (1 có pack_size, 1 không) + vài phiếu nhập/rút mẫu.
- [ ] **Script assert** (node script gọi RPC qua supabase-js bằng key staging, hoặc pgTAP):
  chuỗi nhập kho → sửa phiếu → hủy phiếu, mỗi bước assert tồn kho + WAC + owing khớp số
  tính tay. ~10 case đầu tiên:
  1. Nhập kho lần đầu → WAC = amountDue/qty, tồn warehouse đúng.
  2. Nhập lần 2 giá khác → WAC moving-average đúng công thức process.
  3. Sửa phiếu cũ (đổi qty + tiền) → WAC **full re-average** (mô hình cancel_restock,
     KHÔNG phải moving-average — xem chú thích trong task.md về 2 mô hình WAC).
  4. Sửa phiếu → cascade `before_stock`/`after_stock` các phiếu SAU nó đổi đúng delta.
  5. Hủy phiếu giữa chuỗi → tồn + WAC + hoàn tiền đúng.
  6. Nhập backdate (purchaseDate quá khứ, kèm giờ) → `created_at`/`paid_at` khớp,
     không vi phạm `chk_payment_paid_at_not_before_created`.
  7. Trả 1 phần (paid < amountDue) → owing đúng; trả nợ tiếp bằng `record_invoice_payment`
     → owing về 0, không âm.
  8. `cash_phase='in_shift'` tiền mặt → vào Thực thu báo cáo; `post_close`/CK → không.
  9. Trả nợ với `paid_at` tuỳ chọn (giờ trả) → rơi đúng ngày VN trong báo cáo range.
  10. Guest/local mode parity: cùng chuỗi thao tác trên localRepository ra cùng con số
      (case này chạy bằng vitest thuần, không cần DB).
- [ ] **CI**: GitHub Action chạy script assert trên staging khi PR đụng `supabase/migrations/`
  hoặc `src/services/ingredientStockService.ts`.

## Trạng thái — ĐÃ LÀM (2026-07-04)

`npm run test:inventory` (trước 2026-07-08 gọi là `test:money`) →
`scripts/test-inventory-staging.mjs` gọi RPC thật trên staging, **21 assert / 7 case pass**:
1. Nhập lần đầu → WAC = amountDue/qty, ghi `ingredient_costs`, after_stock đúng.
2. WAC **moving-average** trên tồn đã đếm (seed `shift_closings.remaining`).
3. amountDue = subtotal − discount + extra → WAC theo amountDue.
4. Trả một phần → owing đúng; `record_invoice_payment` → owing 0; **chặn overpay**.
5. `cash_phase` (in_shift/post_close) lưu đúng trên phiếu và trên payment trả nợ.
6. `cancel_restock` → zero-out + cờ cancelled + xoá payments (đảo tiền).
7. Guard: discount âm bị RAISE.

Chưa làm (case doc gốc còn lại): cascade before/after_stock khi backdate (#4 gốc),
hủy giữa chuỗi nhiều phiếu (#5 gốc), backdate created_at/paid_at ngày VN (#6/#9 gốc),
parity guest/local bằng vitest (#10 — không cần DB). Thêm dần vào script khi cần.

### Setup staging (1 lần) — tiền nhập kho

1. Tạo Supabase project free (không cần Docker).
2. `.env.staging.local`: `STAGING_SUPABASE_URL` + `STAGING_SUPABASE_SECRET` (secret key). Đã .gitignore.
3. Paste `scripts/staging-inventory-schema.sql` vào SQL Editor staging, Run — tạo 7 bảng
   (users, addresses, ingredient_costs, expenses, expense_payments, shift_closings,
   user_address_access) + 6 hàm (auth_owner_id + 5 money RPC). Đây là **subset** trích
   từ migrations, KHÔNG phải full app schema.
4. `npm run test:inventory`.

## Tiền bán hàng — `bulk_create_orders` (thêm 2026-07-08)

Cùng vấn đề, khác RPC: `bulk_create_orders` trước đây nhận `total`/`total_cost`/`unit_cost`
thẳng từ client và ghi thẳng vào `orders` — bất kỳ session nhân viên nào cũng có thể tự gọi
RPC (DevTools console) với `total` bịa ra. Migration
`20260708_bulk_create_orders_server_pricing.sql` đổi RPC tự tính giá bán (`products` +
`product_extras`) và giá vốn (`recipes` + `extra_ingredients` × `ingredient_costs`)
server-side, scoped theo `address_id` của đơn — client giờ chỉ khai
`product_id + quantity + extra_ids`.

`npm run test:money` → `scripts/test-money-staging.mjs`, **staging thật, 5 case**:
1. Server tự tính `total`/`unit_cost`/`options` đúng từ DB — client không gửi giá.
2. Client cố nhét `total`/`unit_cost` giả vào payload → RPC bỏ qua, số thật vẫn đúng.
3. Guard: `product_id` thuộc địa chỉ khác → RAISE (chặn cross-tenant).
4. Guard: `extra_ids` chứa extra của product khác → RAISE.
5. `discount_amount` trừ đúng vào `total` đã tính server-side.

### Setup staging (1 lần) — tiền bán hàng

1. Cùng `.env.staging.local` ở trên.
2. Paste `scripts/staging-order-schema.sql` vào SQL Editor staging, Run — tạo
   users/addresses/user_address_access (lặp lại, idempotent) + products/product_extras/
   recipes/extra_ingredients/ingredient_costs/orders/order_items + `bulk_create_orders`.
3. `npm run test:money`.

**Chưa chạy lần nào trong môi trường viết migration này** (không có staging creds) — chỉ
mới được đọc lại bằng mắt. Chạy `npm run test:money` trước khi coi migration
`20260708` là xong.

### CI (chưa làm)

GitHub Action chạy `test:inventory` + `test:money` khi PR đụng `supabase/migrations/` hoặc
`ingredientStockService.ts`/`orderService.ts` — cần đưa staging secret vào repo secrets.

## Lưu ý

- **Prod-guard**: cả 2 script refuse chạy nếu URL trỏ project-ref prod (`cnkvscwmdfkajhotcijl`).
- `staging-inventory-schema.sql` / `staging-order-schema.sql` là subset trích tay từ
  migrations → có thể lệch khi RPC/bảng đổi. Nếu test đỏ vì thiếu cột/hàm: cập nhật lại
  file tương ứng (trích từ migration mới).
- pgTAP là lựa chọn "chuẩn" nhưng node + supabase-js rẻ hơn và test cả tầng PostgREST
  (đúng đường client đi thật).
