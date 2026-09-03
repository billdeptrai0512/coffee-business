# Tests

Toàn bộ test gom ở đây, chia theo **mảng** (không rải trong `src/` nữa) để mở ra đọc-hiểu
nhanh. Vitest tự quét `*.test.*` nên chạy không cần cấu hình gì thêm.

## Cách chạy

```bash
npm test                          # chạy hết
npx vitest run tests/report       # chạy 1 mảng
npx vitest                        # watch mode (chạy lại khi sửa)
npx vitest run tests/common/money.test.js   # 1 file
```

Mỗi file có **header** ghi: test cái gì + file nguồn. Từng case đọc ở chuỗi `describe(...)`
/ `it(...)` — viết thành câu tiếng Việt/Anh mô tả rõ hành vi.

## Bản đồ

| Mảng | File | Kiểm gì | Nguồn |
|---|---|---|---|
| **report** | reportStats | mô hình "thực chi", gộp thống kê đơn, dedupe chốt ca | `utils/reportStats.js` |
| | expenseCategoryBreakdown | gộp chi phí theo nhóm | `utils/expenseCategoryBreakdown.js` |
| | reportContract | fetcher guest ↔ Supabase cùng shape | `services/reportService.js` |
| | reportService.merge | gộp tồn khi nhiều lần chốt ca | `services/reportService.js` |
| | cashPayload | "Lưu thực thu" chỉ gửi ô đã sửa (2 máy không đè nhau) | `services/reportService.ts` |
| | reportHeaderDateRange | tính khoảng ngày cho header | `utils/rangeCalc.js` |
| | dateScopeParamsSeed | đọc scope/ngày từ URL, chuẩn hoá custom-1-ngày | `hooks/useDateScope.js` |
| | missingCupRepeatHistory | nghi vấn bán thiếu — đếm ngày lặp lại | `utils/inventory.js` |
| **inventory** | inventory | tiêu hao & giá trị hao hụt | `utils/inventory.js` |
| | inventoryRecipeCost | giá vốn từ công thức + extras | `utils/inventory.js` |
| | ingredientService | guest ingredient service, parity đổi tên key | `services/ingredientStockService.ts`, `services/restockService.ts` |
| | ingredientKeySync | phát hiện lệch key nguyên liệu | `utils/ingredientKeySync.js` |
| **menu** | menuGridLayout | bố cục lưới menu | `utils/menuGridLayout.js` |
| | menuSequence | thứ tự MENU_SEQUENCE | `utils/menuSequence.js` |
| **pos** | orderService | flush đơn offline (guest) | `services/orderService.js` |
| | tableLines | gộp đợt gọi món của bàn thành hoá đơn (dine_in) | `services/orderService.ts` |
| | ordersPoll | diff đơn khi đồng bộ hai máy cùng địa chỉ | `hooks/useOrdersPoll.js` |
| | ordersSync | watermark: "không đổi" (null) khác "chưa có đơn" ([]) | `services/orderService.ts` |
| **common** | money | discount, parse/format VND, COGS | `utils/money.js`, `utils/inventory.js` |
| | datePickerUtils | parse ngày, tiện ích date-picker | `components/common/datePickerUtils.js` |
| | text | capitalizeWords | `utils/text.js` |
| | localRepository | guest data layer, parity sync key | `services/localRepository.js` |
| | tabVisibility | gate "tab quay lại sau khi đi vắng" — chặn vòng lặp refetch | `utils/tabVisibility.js` |

`TINH_TOAN_TON_KHO.md` (trong `inventory/`) giải thích công thức giá vốn/tiêu hao mà bộ
test inventory kiểm chứng.

## Logic tiền tầng SQL — chạy riêng trên staging

Sống trong RPC Postgres, không unit-test JS được. Gọi RPC thật trên Supabase **staging**
(cần `.env.staging.local`, cấm trỏ prod). Setup + danh sách case:
[docs/SQL_MONEY_TESTS.md](../docs/SQL_MONEY_TESTS.md). Không chạy trong `npm test`.

- `npm run test:inventory` (`scripts/test-inventory-staging.mjs`) — tiền NHẬP KHO: WAC,
  `cash_phase`, owing NCC, cancel/edit phiếu (`process_ingredient_restock` và họ hàng).
- `npm run test:money` (`scripts/test-money-staging.mjs`) — tiền BÁN HÀNG: `bulk_create_orders`
  tự tính giá bán/giá vốn server-side, không tin client.
