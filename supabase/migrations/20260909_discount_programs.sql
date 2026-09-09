-- Chương trình giảm giá tự động theo lịch: 1 chương trình gắn nhiều món (nhiều-nhiều qua
-- discount_program_products, mirrors product_toppings), tự áp giá khi bật + đúng lịch — thay
-- thế workaround cũ "product_extras giá âm + is_sticky" (thủ công, mất trạng thái mỗi phiên POS).
-- Lịch áp dụng gồm 2 bộ lọc ĐỘC LẬP: days_of_week (rỗng = mọi thứ) và start/end_date (NULL =
-- không giới hạn phía đó) — dùng riêng hay kết hợp đều được. Giá thật sự áp dụng được tính lại
-- ở bulk_create_orders (xem 20260909_bulk_create_orders_scheduled_discount.sql), bảng này chỉ
-- là dữ liệu cấu hình, không tự resolve giá.
-- Không đụng function nào ở đây nên không vướng rule search_path.

CREATE TABLE discount_programs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  address_id UUID NOT NULL REFERENCES addresses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'fixed' CHECK (type IN ('fixed', 'percent', 'amount')),
  value INTEGER NOT NULL,        -- fixed: giá bán mới (VND); percent: 0-100; amount: VND giảm
  days_of_week SMALLINT[] NOT NULL DEFAULT '{}',  -- EXTRACT(DOW): 0=CN..6=T7; rỗng = mọi thứ
  start_date DATE,
  end_date DATE,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE discount_program_products (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  discount_program_id UUID REFERENCES discount_programs(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  UNIQUE (discount_program_id, product_id)
);

-- RLS: mirror nguyên mẫu toppings/product_toppings (20260906_toppings.sql) — address_id ở đây
-- NOT NULL (không có khái niệm chương trình "mặc định toàn hệ thống" như topping global), nên
-- write policy khỏi cần nhánh address_id IS NOT NULL.
ALTER TABLE discount_programs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "discount_programs_read" ON discount_programs
    FOR SELECT
    USING (
        public.is_admin_auth(auth.uid())
        OR address_id IN (
            SELECT address_id FROM public.user_address_access WHERE auth_id = auth.uid()
        )
    );
-- FOR ALL không khai WITH CHECK → Postgres tự dùng lại USING cho cả 2 vế, khỏi lặp.
CREATE POLICY "discount_programs_write" ON discount_programs
    FOR ALL
    USING (
        public.is_admin_auth(auth.uid())
        OR (
            public.is_manager_auth(auth.uid())
            AND address_id IN (
                SELECT address_id FROM public.user_address_access WHERE auth_id = auth.uid()
            )
        )
    );

ALTER TABLE discount_program_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "discount_program_products_read" ON discount_program_products
    FOR SELECT
    USING (
        public.is_admin_auth(auth.uid())
        OR EXISTS (
            SELECT 1 FROM discount_programs dp
            WHERE dp.id = discount_program_products.discount_program_id
              AND dp.address_id IN (
                  SELECT address_id FROM public.user_address_access WHERE auth_id = auth.uid()
              )
        )
    );
-- FOR ALL không khai WITH CHECK → Postgres tự dùng lại USING cho cả 2 vế, khỏi lặp.
CREATE POLICY "discount_program_products_write" ON discount_program_products
    FOR ALL
    USING (
        public.is_admin_auth(auth.uid())
        OR (
            public.is_manager_auth(auth.uid())
            AND EXISTS (
                SELECT 1 FROM discount_programs dp
                WHERE dp.id = discount_program_products.discount_program_id
                  AND dp.address_id IN (
                      SELECT address_id FROM public.user_address_access WHERE auth_id = auth.uid()
                  )
            )
        )
    );
