# Logic Tồn Kho & COGS

Tài liệu này mô tả CÁCH app tính tồn kho nguyên liệu / bao bì và giá vốn. Đọc xong bạn sẽ
trả lời được: *"Con số tồn ở `/ingredients` từ đâu ra, và khi nó lệch thực tế thì sửa ở đâu?"*

---

## 1. Mô hình 2 kho + 2 dòng chảy

App KHÔNG lưu một con số "tồn kho" cố định. Mọi thứ được **suy ra** từ 2 bảng dữ liệu gốc:
`expenses` (đi chợ) và `shift_closings` (chốt ca). Có **2 kho** và **2 dòng chảy** tách biệt:

```
            ┌────────────────────────┐         ┌────────────────────────┐
            │   KHO TỔNG (kho sau)    │         │     QUẦY (kho trước)    │
            │   warehouse_stock      │         │     counter_stock      │
            │   = SUY RA, không đếm   │         │   = ĐẾM TAY mỗi ca      │
            └───────────┬────────────┘         └───────────┬────────────┘
                        │                                   │
   (A) ĐI CHỢ / NHẬP KHO│                  (B) NHẬP THÊM    │  (C) BÁN HÀNG
   +qty vào kho tổng    │   ──── rút kho ────►              │  trừ dần ở quầy
                        ▼            ra quầy                ▼
            warehouse += refill        warehouse −= restock   remaining = đếm tay cuối ca
                                       counter   += restock
```

| | Dòng chảy | Nơi thao tác | Tác dụng |
|---|---|---|---|
| **A** | **Đi chợ / Nhập kho** | `/ingredients` → **+ Nhập kho** | `expenses (is_refill=true)`, cập nhật giá vốn WAC, **+ kho tổng**. Dòng **DUY NHẤT** làm tăng kho tổng. |
| **B** | **Nhập thêm (rút ra quầy)** | `/daily-report` thẻ **Hao hụt**, cột `Nhập thêm` | Ghi `restock` trong `shift_closings.inventory_report[]`. Chuyển hàng **kho tổng → quầy**: **− kho tổng, + quầy**. |
| **C** | **Bán hàng** | `/pos` | Trừ dần ở quầy. Thể hiện qua `remaining` (đếm tay cuối ca). |

`shift_closings.inventory_report[]` lưu 3 trường / nguyên liệu:
- `opening` — tồn quầy **đầu ca** (kế thừa `remaining` ca trước).
- `restock` — **Nhập thêm**: lượng rút từ kho tổng ra quầy ca này (dòng **B**).
- `remaining` — tồn quầy **cuối ca**, **ĐẾM TAY**. Đây là **ground truth** của quầy.

> [!IMPORTANT]
> **Quy tắc lấy Đầu kỳ (`opening`):**
> Đầu kỳ của ca hôm nay bắt buộc phải lấy từ Cuối kỳ (`remaining`) của ca gần nhất trước đó (truy vấn qua `fetchYesterdayShiftClosing`), không được sử dụng tồn quầy hiện tại (`fetchIngredientStocks` / `get_ingredient_stocks_v2`) làm Đầu kỳ. Vì ngay khi lưu/chốt ca hôm nay, tồn quầy hiện tại sẽ cập nhật thành số Cuối kỳ vừa chốt, nếu dùng nó làm Đầu kỳ sẽ gây ra lỗi nghiêm trọng: Đầu kỳ bị đè thành Cuối kỳ.


---

## 2. Công thức hiển thị ở `/ingredients`

```
current_stock = warehouse_stock + counter_stock
```

### 2.1 `warehouse_stock` (kho tổng)
```
warehouse_stock = max(0,  Σ refill_qty  −  Σ restock_post_first_refill)
```
- `Σ refill_qty` — tổng `metadata.qty` của mọi `expenses.is_refill=true` của NVL đó (theo `address_id`).
  Phiếu **Hiệu chỉnh tồn** cũng là `is_refill` nhưng `qty` âm → tự động trừ vào tổng này.
- `Σ restock_post_first_refill` — tổng `restock` của mọi `shift_closings`, **chỉ tính phiếu chốt
  có `created_at ≥ lần Nhập kho ĐẦU TIÊN** của NVL đó. Restock trước mốc nhập kho đầu bị **bỏ qua**
  (coi như tiêu thụ hàng "pre-system" chưa được khai báo).
- Kẹp `≥ 0` để tránh âm khi dữ liệu lịch sử thiếu phiếu nhập.

### 2.2 `counter_stock` (quầy) — CARRY-FORWARD
```
counter_stock = remaining KHÁC-NULL gần nhất của NVL đó (quét mọi phiếu chốt, created_at DESC)
```
- `remaining = null` nghĩa là **ca đó nhân viên không đếm** NVL này → app **giữ lần đếm thật gần
  nhất**, KHÔNG kéo về 0. (Trước migration `20260609` RPC lấy null→0 gây tụt tồn oan — đã sửa.)

### Ví dụ (cà phê)
- T-1: Nhập kho 10.000 g → `expenses` refill `qty=10.000`.
- Ca T: `opening=610`, `restock=1.000` (rút ra quầy), `remaining=318` (đếm tay).
- `/ingredients`: `(10.000 − 1.000) + 318 = 9.318 g`.

### Edge cases
- **Chưa có phiếu chốt nào** → `counter_stock = 0` → hiển thị = `warehouse_stock`.
- **Chưa có Nhập kho nào** → `warehouse_stock = 0` → hiển thị = `counter_stock`.
- **Ca đang mở (chưa chốt)** → `counter_stock` đứng yên ở lần đếm gần nhất; chỉ đổi khi chốt ca
  mới. Nhập kho (đi chợ) giữa chừng vẫn cộng ngay vào `warehouse_stock`.

---

## 3. ⚠️ Hạn chế quan trọng: KHO TỔNG không được đối soát vật lý

Đây là điểm yếu cốt lõi cần hiểu rõ:

- **Quầy** được **đếm tay mỗi ca** (`remaining`) → tự đối soát, sai số không tích lũy.
- **Kho tổng** thì **KHÔNG có đầu vào "đếm kho thực tế"** — nó hoàn toàn = `Σ mua − Σ rút ra quầy`.

⇒ Bất kỳ hàng nào **rời kho tổng mà không qua "Nhập thêm"** sẽ thành **tồn ma vĩnh viễn**:
- Nhân viên bốc thẳng từ thùng trong kho (không ghi Nhập thêm).
- Vỡ, hỏng, thất thoát.
- Đếm sai / nhập sai số lượng lúc mua.

Sai số này **cộng dồn mãi** vì không có cơ chế kéo kho tổng về số đếm thật. Cách duy nhất hiện tại
để chỉnh là **`/ingredients` → Hiệu chỉnh tồn** (tạo phiếu `is_refill` `qty` âm/dương).

> **Ví dụ thật:** `ly_350ml` từng hiển thị 142 (kho tổng 100 + quầy 42) trong khi đếm thật ~35.
> 100 ly "ma" là drift tích lũy 2 tháng do rút kho không ghi Nhập thêm. Sửa: Hiệu chỉnh tồn −100.

*(Đang bàn giải pháp gốc: thêm chức năng "Kiểm kho thực tế" cho kho tổng — xem backlog.)*

---

## 4. Giá vốn (WAC — bình quân gia quyền)

Mỗi lần Nhập kho, `process_ingredient_restock` cập nhật `ingredient_costs.unit_cost`:
```
unit_cost_mới = (tồn_trước × unit_cost_cũ + tiền_lô_mua) / (tồn_trước + qty_mua)
```
- Hủy phiếu (`cancel_restock`) hoặc xóa NVL → WAC được tính lại từ các phiếu mua thật còn lại
  (loại phiếu đã hủy `cancelled=true` và phiếu Hiệu chỉnh `adjustment=true`).

---

## 5. Up-size & hệ số âm (extraIngredients)

Khi khách lên Size L: công thức gốc đã cộng 1 `Ly nhỏ`, nên extra Up-size phải **+1 Ly lớn và −1
Ly nhỏ** để cân đối. `extra_ingredients.amount` cho phép số âm làm việc bù trừ này.
`calculateEstimatedConsumption` cộng `amount × quantity`, dọn các NVL kết quả = 0.
Chi tiết + unit test: `tests/inventory/` (chạy `npx vitest run tests/inventory/inventory.test.js`).

---

## 6. Implementation (vị trí code)

| Thành phần | Vị trí | Ghi chú |
|---|---|---|
| Tính tồn (đường nhanh) | RPC `get_ingredient_stocks_v2` | Đường chạy thật ở production. |
| Tính tồn (fallback JS) | `src/services/ingredientStockService.ts` → `fetchIngredientStocks` | Chỉ chạy khi RPC thiếu. Cùng công thức + carry-forward như RPC. |
| Nhập kho + WAC | RPC `process_ingredient_restock` | Tạo expense refill, cập nhật `unit_cost`. KHÔNG đụng bảng `inventory`. |
| Hủy phiếu | RPC `cancel_restock` | Zero-out tại chỗ (qty/amount → 0), giữ dòng + badge ĐÃ HỦY. |
| Xóa NVL | RPC `delete_ingredient` | Dọn `ingredient_costs`/`recipes`/`extra_ingredients` + strip key khỏi snapshot. |
| Tiêu hao theo công thức | `src/utils/inventory.js` → `calculateEstimatedConsumption` | Dùng cho cột Sử dụng / Hao hụt. |

> **Lưu ý:** bảng `inventory`/`ingredients.stock` đã **bị bỏ** (migration `20260508_drop_legacy_inventory`).
> Tồn kho KHÔNG đọc từ chúng. Trigger cũ `subtract_stock_from_restock` cũng đã bị drop — đừng tham chiếu.

---

## 7. Bảng dữ liệu liên quan

- `shift_closings` — `inventory_report` JSONB `[{ingredient, opening, restock, remaining}]`, `created_at`, `address_id`, `actual_cash`, `actual_transfer`.
- `expenses` — `is_refill=true`, `metadata` JSONB `{ingredient, qty, price, adjustment?, cancelled?, before_stock?, after_stock?}`, `created_at`, `address_id`.
- `ingredient_costs` — `ingredient`, `unit_cost` (WAC), `unit`, `address_id`.
- `recipes` — `product_id`, `ingredient`, `amount` (định mức/ly).
- `extra_ingredients` — `extra_id`, `ingredient`, `amount` (cho phép âm — bù trừ up-size).

---

## 8. Khi tồn lệch thực tế — checklist

1. So `current_stock` = `warehouse_stock` + `counter_stock`: **lệch nằm ở kho tổng hay quầy?**
   (Xem tách số ở thẻ Soạn/Chuẩn bị tồn kho: "Kho X · Quầy Y".)
2. **Lệch ở quầy** → kiểm tra `remaining` ca gần nhất có bị nhập sai / bỏ trống không.
3. **Lệch ở kho tổng** → gần như chắc là drift (rút kho không ghi Nhập thêm / vỡ hỏng) → **Hiệu chỉnh tồn**.
4. Kiểm Nhập kho có đủ phiếu không, có phiếu nào nhập nhầm số lượng / nhầm ngày không.

---

## 9. Kho tổng dùng chung nhiều địa chỉ (warehouse groups)

*Thêm 2026-07-14.* Usecase: 1 manager có nhiều địa chỉ (chi nhánh), muốn 1 tập con trong đó
**dùng chung 1 kho tổng** (mua hàng ở địa chỉ nào trong nhóm cũng cộng vào cùng 1 pool, giá vốn
hợp nhất) trong khi **quầy vẫn riêng từng địa chỉ** (đếm tay mỗi ca, không đổi).

### Mô hình
- `addresses.warehouse_group_id` (nullable, FK `warehouse_groups`) — null = độc lập như mục 1-8
  ở trên (hành vi mặc định không đổi). 1 địa chỉ thuộc tối đa 1 nhóm. Manager chọn linh hoạt
  từng địa chỉ vào/ra nhóm (không bắt buộc gộp toàn bộ), có thể nhiều nhóm song song.
- **Không có "kho chính"** — bất kỳ địa chỉ nào trong nhóm cũng Nhập kho được, cộng dồn chung 1
  pool (công thức pool đối xứng, không cần chỉ định địa chỉ chịu trách nhiệm mua hàng).
- Công thức `warehouse_stock` (mục 2.1) mở rộng lọc `address_id = p_address_id` thành
  `address_id = ANY(get_warehouse_group_address_ids(p_address_id))` — vẫn `Σrefill − Σrestock`,
  chỉ khác là tính trên TOÀN NHÓM thay vì 1 địa chỉ.
- `counter_stock` (mục 2.2) **không đổi** — vẫn carry-forward `remaining` riêng của từng địa chỉ.
- **Mốc neo (anchor, mục "Có mốc neo…" trong get_ingredient_stocks_v2) bị bỏ qua khi grouped** —
  anchor chỉ đúng trên timeline 1 địa chỉ, cộng dồn qua nhiều địa chỉ vô nghĩa. Địa chỉ thuộc
  nhóm > 1 thành viên luôn dùng công thức fallback (Σrefill − Σrestock trên nhóm).
- **WAC hợp nhất**: mỗi lần giá vốn 1 nguyên liệu đổi (Nhập kho / hủy / sửa phiếu / sửa tay), giá
  trị mới được fan-out ghi vào dòng `ingredient_costs` của MỌI thành viên trong nhóm
  (`sync_group_unit_cost`) — mỗi địa chỉ vẫn giữ dòng `ingredient_costs` riêng (category/pack/
  min_stock/tare_weight/unit không hợp nhất), chỉ `unit_cost` là chung. `cancel_restock`/
  `edit_ingredient_restock` tính lại full re-average (`Σamount/Σqty`) trên purchase history của
  CẢ NHÓM (`recompute_group_unit_cost`) thay vì chỉ 1 địa chỉ.
  `process_ingredient_restock` vẫn giữ mô hình moving-average riêng cũ (dùng tồn quầy hiện tại
  của địa chỉ đang nhập — tech debt đã biết, không đồng bộ 2 mô hình, xem mục 4 ở trên).

### Edge case chấp nhận (không giải quyết bằng code)
- **Gộp/rời nhóm giữa chừng làm số kho tổng đổi ngay lập tức** — vì mọi thứ là dữ liệu suy ra,
  không lưu sẵn (như mọi phần khác của tài liệu này). UI cảnh báo khi mở modal gộp nhóm.
- **Staff chỉ có quyền ở 1 địa chỉ thành viên vẫn thấy được lịch sử mua hàng của các địa chỉ khác
  trong nhóm** qua các RPC tồn kho — chủ đích (đúng bản chất "dùng chung kho"), không phải lỗ hổng.
- Tên nguyên liệu (TEXT key) phải khớp chính xác giữa các địa chỉ trong nhóm để pool đúng — không
  enforce ở code, là yêu cầu vận hành.
- **Catalog nguyên liệu (`ingredient_costs`) không tự đồng bộ giữa các thành viên** — 1 nguyên liệu
  chỉ hiện ở trang Nguyên liệu / Nhập kho của địa chỉ nào đã tự tạo nó. Nếu tạo nguyên liệu mới ở
  địa chỉ A trong nhóm, các địa chỉ B/C phải tự tạo (cùng TEXT key) mới nhập kho được — dù kho tổng
  đã pool chung. Chấp nhận vì catalog vốn đã per-address từ trước khi có nhóm (category/pack/
  min_stock riêng từng nơi), không phải regression do tính năng nhóm gây ra.
- **Xoá 1 địa chỉ đang thuộc nhóm làm tồn kho tổng của các thành viên còn lại tụt xuống** —
  `expenses.address_id`/`shift_closings.address_id` đều `ON DELETE CASCADE`, nên xoá địa chỉ xoá
  luôn lịch sử mua hàng/rút hàng của nó; vì `warehouse_stock` là dữ liệu suy ra trên toàn nhóm
  (`Σrefill − Σrestock` của mọi thành viên), phần đóng góp của địa chỉ bị xoá biến mất khỏi pool dù
  hàng vật lý không mất. Xác nhận live 2026-07-15: xoá 1 địa chỉ đã đóng góp 200g vào nhóm 2 thành
  viên → thành viên còn lại tụt đúng 200g ngay lập tức. Không chặn xoá (giữ đúng ngữ nghĩa "xoá =
  xoá hết dữ liệu địa chỉ"), chỉ cảnh báo rõ hậu quả trong modal xác nhận xoá
  (`BranchGrid.jsx`) khi địa chỉ đang có thành viên nhóm khác.

### Implementation
| Thành phần | Vị trí |
|---|---|
| Schema | `supabase/migrations/20260714_warehouse_groups_1_schema.sql` |
| Helper + RPC quản lý nhóm | `supabase/migrations/20260714_warehouse_groups_2_rpcs.sql` (`get_warehouse_group_address_ids`, `sync_group_unit_cost`, `recompute_group_unit_cost`, `set_ingredient_unit_cost`, `upsert_warehouse_group`, `delete_warehouse_group`, `set_address_warehouse_group`) |
| 4 RPC tồn kho làm group-aware | `supabase/migrations/20260714_warehouse_groups_3_inventory_rpcs.sql` |
| UI quản lý nhóm | `src/components/AddressSelectPage/BranchGrid.jsx` (modal "Kho tổng chung" trong menu Quản lý mỗi địa chỉ) |
| Context | `src/contexts/AddressContext.jsx` — `warehouseGroups`, `siblingsByAddress`, `createWarehouseGroup`/`renameWarehouseGroup`/`removeWarehouseGroup`/`setAddressGroup` |
| Sửa giá vốn thủ công | `updateIngredientUnitCost` (`src/services/ingredientCostService.ts`) → RPC `set_ingredient_unit_cost` (thay vì upsert thẳng, để đi qua fan-out) |
