-- Topping: thực thể toàn cục (không thuộc riêng 1 product), có công thức riêng (để tính giá
-- vốn), gắn vào nhiều món qua product_toppings. Tồn kho của topping KHÔNG suy từ công thức —
-- nó là 1 dòng ingredient_costs độc lập cùng tên, đếm tay ở kiểm kê như mọi nguyên liệu khác
-- (xem toppingService.insertTopping). Không đụng function nào nên không vướng rule search_path.

CREATE TABLE toppings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  price INTEGER NOT NULL DEFAULT 0,
  address_id UUID REFERENCES addresses(id) ON DELETE CASCADE,
  sort_order INTEGER DEFAULT 0
);

-- Công thức riêng của topping (mirrors `recipes`) — chỉ dùng để tính giá vốn (giá vốn của
-- topping = tổng amount * unit_cost các nguyên liệu này), KHÔNG trừ tồn kho tự động.
CREATE TABLE topping_ingredients (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  topping_id UUID REFERENCES toppings(id) ON DELETE CASCADE,
  ingredient TEXT NOT NULL,
  amount REAL NOT NULL,
  unit TEXT NOT NULL DEFAULT 'đv',
  UNIQUE (topping_id, ingredient)
);

-- Nhiều-nhiều: món nào được phép thêm topping nào.
CREATE TABLE product_toppings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  topping_id UUID REFERENCES toppings(id) ON DELETE CASCADE,
  UNIQUE (product_id, topping_id)
);

ALTER TABLE order_items ADD COLUMN topping_ids JSONB NOT NULL DEFAULT '[]'::JSONB;

-- RLS: mirror nguyên mẫu product_extras / extra_ingredients (schema.sql).
ALTER TABLE toppings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "toppings_read" ON toppings
    FOR SELECT
    USING (
        address_id IS NULL
        OR public.is_admin_auth(auth.uid())
        OR address_id IN (
            SELECT address_id FROM public.user_address_access WHERE auth_id = auth.uid()
        )
    );
-- FOR ALL không khai WITH CHECK → Postgres tự dùng lại USING cho cả 2 vế, khỏi lặp.
CREATE POLICY "toppings_write" ON toppings
    FOR ALL
    USING (
        public.is_admin_auth(auth.uid())
        OR (
            public.is_manager_auth(auth.uid())
            AND address_id IS NOT NULL
            AND address_id IN (
                SELECT address_id FROM public.user_address_access WHERE auth_id = auth.uid()
            )
        )
    );

ALTER TABLE topping_ingredients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "topping_ings_read" ON topping_ingredients
    FOR SELECT
    USING (
        public.is_admin_auth(auth.uid())
        OR EXISTS (
            SELECT 1 FROM toppings t
            WHERE t.id = topping_ingredients.topping_id
              AND (
                  t.address_id IS NULL
                  OR t.address_id IN (
                      SELECT address_id FROM public.user_address_access WHERE auth_id = auth.uid()
                  )
              )
        )
    );
-- FOR ALL không khai WITH CHECK → Postgres tự dùng lại USING cho cả 2 vế, khỏi lặp.
CREATE POLICY "topping_ings_write" ON topping_ingredients
    FOR ALL
    USING (
        public.is_admin_auth(auth.uid())
        OR (
            public.is_manager_auth(auth.uid())
            AND EXISTS (
                SELECT 1 FROM toppings t
                WHERE t.id = topping_ingredients.topping_id
                  AND t.address_id IN (
                      SELECT address_id FROM public.user_address_access WHERE auth_id = auth.uid()
                  )
            )
        )
    );

ALTER TABLE product_toppings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "product_toppings_read" ON product_toppings
    FOR SELECT
    USING (
        public.is_admin_auth(auth.uid())
        OR EXISTS (
            SELECT 1 FROM toppings t
            WHERE t.id = product_toppings.topping_id
              AND (
                  t.address_id IS NULL
                  OR t.address_id IN (
                      SELECT address_id FROM public.user_address_access WHERE auth_id = auth.uid()
                  )
              )
        )
    );
-- FOR ALL không khai WITH CHECK → Postgres tự dùng lại USING cho cả 2 vế, khỏi lặp.
CREATE POLICY "product_toppings_write" ON product_toppings
    FOR ALL
    USING (
        public.is_admin_auth(auth.uid())
        OR (
            public.is_manager_auth(auth.uid())
            AND EXISTS (
                SELECT 1 FROM toppings t
                WHERE t.id = product_toppings.topping_id
                  AND t.address_id IN (
                      SELECT address_id FROM public.user_address_access WHERE auth_id = auth.uid()
                  )
            )
        )
    );
