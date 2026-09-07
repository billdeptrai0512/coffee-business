-- =============================================
-- Coffee Cart Order App – Supabase Schema
-- =============================================
-- Reflects the schema actually in use by the application code.
-- Drift can creep in via the Supabase dashboard; if you change the DB there,
-- mirror the change here too.

-- Users profiles (managers and staff, linked to Supabase Auth)
CREATE TABLE IF NOT EXISTS users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  auth_id UUID REFERENCES auth.users(id),
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('manager', 'staff', 'admin')),
  manager_id UUID REFERENCES users(id), -- staff belongs to a manager
  email TEXT,
  password TEXT NOT NULL DEFAULT '',
  username TEXT -- login username (= phần trước @ của email giả), hiển thị ở panel Nhân sự
);

-- Addresses (locations managed by a manager)
CREATE TABLE IF NOT EXISTS addresses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  manager_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  ingredient_sort_order JSONB DEFAULT '[]',
  dine_in BOOLEAN NOT NULL DEFAULT false, -- bật giỏ hàng + thanh toán gộp ở POS (quán có bàn ngồi)
  tables TEXT[] NOT NULL DEFAULT '{}', -- danh sách bàn cố định, giữ thứ tự nhập; xem 20260808_address_tables
  referred_from_address_id UUID REFERENCES addresses(id) ON DELETE SET NULL, -- địa chỉ nguồn đã share-clone (hook referral)
  referral_rewarded_at TIMESTAMPTZ, -- đã thưởng người mời cho địa chỉ này chưa (dedup, §11)
  next_order_no INTEGER NOT NULL DEFAULT 1, -- số hoá đơn kế tiếp của địa chỉ này; xem 20260814_order_sequential_number
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Phân quyền chi nhánh theo mô hình REVOKE (mặc định thành viên thấy tất cả).
-- Ghi 1 hàng = 1 chi nhánh bị CẤM với 1 thành viên. Trigger uaa_on_* dựng lại
-- user_address_access (bảng này định nghĩa trong migrations 20260501/20260629) loại trừ
-- các hàng ở đây. Ghi chỉ qua RPC set_staff_address_access; đọc = manager của team.
CREATE TABLE IF NOT EXISTS user_address_revoked (
  user_id    UUID NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
  address_id UUID NOT NULL REFERENCES addresses(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, address_id)
);

-- Mã chia sẻ cấu hình: chủ địa chỉ phát mã → manager khác clone xuyên tài khoản.
-- Dùng lại được, hết hạn 30 ngày. Truy cập qua RPC create_address_share_code /
-- get_shared_config (SECURITY DEFINER). RLS bật, không policy = client không đụng trực tiếp.
CREATE TABLE IF NOT EXISTS address_share_codes (
  code TEXT PRIMARY KEY,
  source_address_id UUID NOT NULL REFERENCES addresses(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 days')
);

-- Prevent duplicate address names per manager (case/space-insensitive).
-- Backstop for the client-side check; required to defeat concurrent-tab races.
CREATE UNIQUE INDEX IF NOT EXISTS addresses_manager_name_unique
  ON addresses (manager_id, lower(regexp_replace(trim(name), '\s+', ' ', 'g')));

-- Products (menu items) — per-address isolated.
-- Each address owns its own clone of every product (set via owner_address_id).
-- Rows with owner_address_id IS NULL are the global "default template" used by
-- the admin "Mẫu mặc định" view.
CREATE TABLE IF NOT EXISTS products (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  price INTEGER NOT NULL, -- price in VND
  is_active BOOLEAN DEFAULT true,
  owner_address_id UUID REFERENCES addresses(id) ON DELETE CASCADE,
  sort_order INTEGER,
  count_as_cup BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_products_owner_address
  ON products (owner_address_id) WHERE is_active;

-- Recipes (ingredients per product, address_id NULL = global default)
CREATE TABLE IF NOT EXISTS recipes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  ingredient TEXT NOT NULL,
  amount REAL NOT NULL, -- amount used per 1 serving
  unit TEXT NOT NULL DEFAULT 'đv', -- ingredient unit (g, ml, ly, etc.)
  address_id UUID REFERENCES addresses(id) ON DELETE CASCADE, -- null means default recipe
  UNIQUE NULLS NOT DISTINCT (product_id, ingredient, address_id)
);

-- Ingredient costs (unit cost per ingredient, address_id NULL = global default)
CREATE TABLE IF NOT EXISTS ingredient_costs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ingredient TEXT NOT NULL,
  unit_cost INTEGER NOT NULL DEFAULT 0, -- cost per unit in VND
  unit TEXT NOT NULL DEFAULT 'đv', -- ingredient unit (g, ml, ly, etc.)
  address_id UUID REFERENCES addresses(id) ON DELETE CASCADE, -- null means default cost
  UNIQUE NULLS NOT DISTINCT (ingredient, address_id)
);

-- Orders (scoped to address)
CREATE TABLE IF NOT EXISTS orders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  address_id UUID REFERENCES addresses(id) ON DELETE CASCADE,
  order_no INTEGER, -- số hoá đơn tăng dần theo address_id; NULL cho đơn tạo trước 20260814_order_sequential_number
  total INTEGER NOT NULL, -- total in VND (net, after discount)
  total_cost INTEGER NOT NULL DEFAULT 0,
  discount_amount INTEGER NOT NULL DEFAULT 0, -- per-order discount applied at POS
  payment_method TEXT,
  staff_name TEXT,
  table_name TEXT, -- nhãn bàn, chỉ dùng ở địa chỉ dine_in; NULL = đơn mang đi
  table_closed_at TIMESTAMPTZ, -- NULL = bàn còn mở (chưa tính tiền); xem 20260809
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Order Items
CREATE TABLE IF NOT EXISTS order_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL,
  topping_ids JSONB NOT NULL DEFAULT '[]'::JSONB
);

-- Expenses (manual one-off costs)
CREATE TABLE IF NOT EXISTS expenses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  address_id UUID REFERENCES addresses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  amount INTEGER NOT NULL, -- cost in VND
  staff_name TEXT,
  is_fixed BOOLEAN DEFAULT false,
  is_refill BOOLEAN NOT NULL DEFAULT false,
  payment_method TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'transfer')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Fixed monthly costs (rent, salary etc.) per address — soft-delete via is_active=false
CREATE TABLE IF NOT EXISTS fixed_costs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  address_id UUID REFERENCES addresses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  amount INTEGER NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Product extras (per-product quick options, e.g. "Lớn" +6000đ)
CREATE TABLE IF NOT EXISTS product_extras (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price INTEGER NOT NULL DEFAULT 0,
  address_id UUID REFERENCES addresses(id) ON DELETE CASCADE,
  sort_order INTEGER DEFAULT 0,
  is_sticky BOOLEAN NOT NULL DEFAULT false
);

-- Extra ingredients (ingredients consumed by a product extra)
CREATE TABLE IF NOT EXISTS extra_ingredients (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  extra_id UUID REFERENCES product_extras(id) ON DELETE CASCADE,
  ingredient TEXT NOT NULL,
  amount REAL NOT NULL,
  unit TEXT NOT NULL DEFAULT 'đv',
  UNIQUE (extra_id, ingredient)
);

-- Toppings (thực thể toàn cục, không gắn 1 product cụ thể — gắn qua product_toppings).
-- Tồn kho của topping KHÔNG suy từ topping_ingredients — nó là 1 dòng ingredient_costs độc
-- lập cùng tên, đếm tay ở kiểm kê như mọi nguyên liệu khác.
CREATE TABLE IF NOT EXISTS toppings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  price INTEGER NOT NULL DEFAULT 0,
  address_id UUID REFERENCES addresses(id) ON DELETE CASCADE,
  sort_order INTEGER DEFAULT 0
);

-- Công thức riêng của topping (mirrors recipes) — chỉ dùng tính giá vốn, không trừ tồn kho.
CREATE TABLE IF NOT EXISTS topping_ingredients (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  topping_id UUID REFERENCES toppings(id) ON DELETE CASCADE,
  ingredient TEXT NOT NULL,
  amount REAL NOT NULL,
  unit TEXT NOT NULL DEFAULT 'đv',
  UNIQUE (topping_id, ingredient)
);

-- Nhiều-nhiều: món nào được phép thêm topping nào.
CREATE TABLE IF NOT EXISTS product_toppings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  topping_id UUID REFERENCES toppings(id) ON DELETE CASCADE,
  UNIQUE (product_id, topping_id)
);

-- Active sessions (track who is currently on shift at which address)
CREATE TABLE IF NOT EXISTS active_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  address_id UUID REFERENCES addresses(id) ON DELETE CASCADE,
  last_seen TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id)
);

-- Shift closings (end-of-shift reports per address)
CREATE TABLE IF NOT EXISTS shift_closings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  address_id UUID REFERENCES addresses(id) ON DELETE CASCADE NOT NULL,
  closed_by UUID REFERENCES users(id),
  system_total_revenue BIGINT NOT NULL DEFAULT 0,
  actual_cash BIGINT NOT NULL DEFAULT 0,
  actual_transfer BIGINT NOT NULL DEFAULT 0,
  inventory_report JSONB DEFAULT '[]',
  note TEXT DEFAULT '',
  closed_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shift_closings_address_date
  ON shift_closings (address_id, closed_at DESC);

-- Ngày kinh doanh VN (UTC+7 cố định) — IMMUTABLE để dùng trong unique index.
CREATE OR REPLACE FUNCTION vn_business_date(ts TIMESTAMPTZ)
RETURNS DATE LANGUAGE sql IMMUTABLE SET search_path = public
AS $$ SELECT ((ts AT TIME ZONE 'UTC') + INTERVAL '7 hours')::date $$;
REVOKE ALL ON FUNCTION vn_business_date(TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION vn_business_date(TIMESTAMPTZ) TO authenticated;

-- Mỗi address tối đa 1 phiếu chốt / ngày VN (chống double-count báo cáo Tuần/Tháng).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_shift_closings_address_vn_day
  ON shift_closings (address_id, vn_business_date(closed_at));

-- =============================================
-- Deprecated tables (commit 43af730 "new design of database product on address")
-- =============================================
-- The product menu used to be a many-to-many link via address_products and
-- per-address price overrides via product_prices. Both are now obsolete:
-- products.owner_address_id + products.price replaces them entirely.
-- Drop only after confirming nothing in production reads these.
DROP TABLE IF EXISTS address_products CASCADE;
DROP TABLE IF EXISTS product_prices CASCADE;

-- =============================================
-- Row Level Security Policies
-- =============================================

-- Active sessions: authenticated users can manage sessions
ALTER TABLE active_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sessions_full_access" ON active_sessions;
CREATE POLICY "sessions_full_access" ON active_sessions
  FOR ALL USING (
    public.is_admin_auth(auth.uid())
    OR address_id IN (
      SELECT id FROM addresses WHERE manager_id = public.auth_owner_id(auth.uid())
    )
    OR address_id IN (
      SELECT address_id FROM user_address_access WHERE auth_id = auth.uid()
    )
  );

-- Orders: managers and admins can access orders
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "managers_full_access" ON orders;
CREATE POLICY "managers_full_access" ON orders
  FOR ALL USING (
    address_id IN (
      SELECT a.id FROM addresses a
      JOIN users u ON u.id = a.manager_id
      WHERE u.auth_id = auth.uid() OR u.id IN (
        SELECT manager_id FROM users WHERE auth_id = auth.uid() AND role = 'staff'
      )
    )
    OR EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'admin')
  );

-- Order items: cascade through orders
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "managers_order_items" ON order_items;
CREATE POLICY "managers_order_items" ON order_items
  FOR ALL USING (
    order_id IN (
      SELECT o.id FROM orders o
      WHERE o.address_id IN (
        SELECT a.id FROM addresses a
        JOIN users u ON u.id = a.manager_id
        WHERE u.auth_id = auth.uid() OR u.id IN (
          SELECT manager_id FROM users WHERE auth_id = auth.uid() AND role = 'staff'
        )
      )
      OR EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'admin')
    )
  );

-- Products: per-address isolated read/write (owner_address_id IS NULL = shared default template)
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "products_read" ON products;
DROP POLICY IF EXISTS "products_write" ON products;
CREATE POLICY "products_read" ON products
    FOR SELECT
    USING (
        owner_address_id IS NULL
        OR public.is_admin_auth(auth.uid())
        OR owner_address_id IN (
            SELECT address_id FROM public.user_address_access WHERE auth_id = auth.uid()
        )
    );
CREATE POLICY "products_write" ON products
    FOR ALL
    USING (
        public.is_admin_auth(auth.uid())
        OR (
            public.is_manager_auth(auth.uid())
            AND owner_address_id IS NOT NULL
            AND owner_address_id IN (
                SELECT address_id FROM public.user_address_access WHERE auth_id = auth.uid()
            )
        )
    )
    WITH CHECK (
        public.is_admin_auth(auth.uid())
        OR (
            public.is_manager_auth(auth.uid())
            AND owner_address_id IS NOT NULL
            AND owner_address_id IN (
                SELECT address_id FROM public.user_address_access WHERE auth_id = auth.uid()
            )
        )
    );

-- Recipes: same shape as products (address_id IS NULL = default template)
ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "recipes_read" ON recipes;
DROP POLICY IF EXISTS "recipes_write" ON recipes;
CREATE POLICY "recipes_read" ON recipes
    FOR SELECT
    USING (
        address_id IS NULL
        OR public.is_admin_auth(auth.uid())
        OR address_id IN (
            SELECT address_id FROM public.user_address_access WHERE auth_id = auth.uid()
        )
    );
CREATE POLICY "recipes_write" ON recipes
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
    )
    WITH CHECK (
        public.is_admin_auth(auth.uid())
        OR (
            public.is_manager_auth(auth.uid())
            AND address_id IS NOT NULL
            AND address_id IN (
                SELECT address_id FROM public.user_address_access WHERE auth_id = auth.uid()
            )
        )
    );

-- Ingredient costs: same shape as recipes
ALTER TABLE ingredient_costs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "costs_read" ON ingredient_costs;
DROP POLICY IF EXISTS "costs_write" ON ingredient_costs;
CREATE POLICY "costs_read" ON ingredient_costs
    FOR SELECT
    USING (
        address_id IS NULL
        OR public.is_admin_auth(auth.uid())
        OR address_id IN (
            SELECT address_id FROM public.user_address_access WHERE auth_id = auth.uid()
        )
    );
CREATE POLICY "costs_write" ON ingredient_costs
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
    )
    WITH CHECK (
        public.is_admin_auth(auth.uid())
        OR (
            public.is_manager_auth(auth.uid())
            AND address_id IS NOT NULL
            AND address_id IN (
                SELECT address_id FROM public.user_address_access WHERE auth_id = auth.uid()
            )
        )
    );

-- Product extras: same shape as recipes
ALTER TABLE product_extras ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "extras_read" ON product_extras;
DROP POLICY IF EXISTS "extras_write" ON product_extras;
CREATE POLICY "extras_read" ON product_extras
    FOR SELECT
    USING (
        address_id IS NULL
        OR public.is_admin_auth(auth.uid())
        OR address_id IN (
            SELECT address_id FROM public.user_address_access WHERE auth_id = auth.uid()
        )
    );
CREATE POLICY "extras_write" ON product_extras
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
    )
    WITH CHECK (
        public.is_admin_auth(auth.uid())
        OR (
            public.is_manager_auth(auth.uid())
            AND address_id IS NOT NULL
            AND address_id IN (
                SELECT address_id FROM public.user_address_access WHERE auth_id = auth.uid()
            )
        )
    );

-- Extra ingredients: linked to product_extras via extra_id (no own address); resolve tenancy through the parent row
ALTER TABLE extra_ingredients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "extra_ings_read" ON extra_ingredients;
DROP POLICY IF EXISTS "extra_ings_write" ON extra_ingredients;
CREATE POLICY "extra_ings_read" ON extra_ingredients
    FOR SELECT
    USING (
        public.is_admin_auth(auth.uid())
        OR EXISTS (
            SELECT 1 FROM product_extras pe
            WHERE pe.id = extra_ingredients.extra_id
              AND (
                  pe.address_id IS NULL
                  OR pe.address_id IN (
                      SELECT address_id FROM public.user_address_access WHERE auth_id = auth.uid()
                  )
              )
        )
    );
CREATE POLICY "extra_ings_write" ON extra_ingredients
    FOR ALL
    USING (
        public.is_admin_auth(auth.uid())
        OR (
            public.is_manager_auth(auth.uid())
            AND EXISTS (
                SELECT 1 FROM product_extras pe
                WHERE pe.id = extra_ingredients.extra_id
                  AND pe.address_id IN (
                      SELECT address_id FROM public.user_address_access WHERE auth_id = auth.uid()
                  )
            )
        )
    )
    WITH CHECK (
        public.is_admin_auth(auth.uid())
        OR (
            public.is_manager_auth(auth.uid())
            AND EXISTS (
                SELECT 1 FROM product_extras pe
                WHERE pe.id = extra_ingredients.extra_id
                  AND pe.address_id IN (
                      SELECT address_id FROM public.user_address_access WHERE auth_id = auth.uid()
                  )
            )
        )
    );

-- Toppings: same shape as product_extras (address-scoped, no product_id).
ALTER TABLE toppings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "toppings_read" ON toppings;
DROP POLICY IF EXISTS "toppings_write" ON toppings;
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

-- Topping ingredients: resolve tenancy through the parent topping row.
ALTER TABLE topping_ingredients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "topping_ings_read" ON topping_ingredients;
DROP POLICY IF EXISTS "topping_ings_write" ON topping_ingredients;
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

-- Product<->topping links: resolve tenancy through the parent topping row.
ALTER TABLE product_toppings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "product_toppings_read" ON product_toppings;
DROP POLICY IF EXISTS "product_toppings_write" ON product_toppings;
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

-- Expenses: managers and admins can access expenses
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "managers_expenses" ON expenses;
CREATE POLICY "managers_expenses" ON expenses
  FOR ALL USING (
    address_id IN (
      SELECT a.id FROM addresses a
      JOIN users u ON u.id = a.manager_id
      WHERE u.auth_id = auth.uid() OR u.id IN (
        SELECT manager_id FROM users WHERE auth_id = auth.uid() AND role = 'staff'
      )
    )
    OR EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'admin')
  );

-- Fixed costs: same access pattern as expenses
ALTER TABLE fixed_costs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "managers_fixed_costs" ON fixed_costs;
CREATE POLICY "managers_fixed_costs" ON fixed_costs
  FOR ALL USING (
    address_id IN (
      SELECT a.id FROM addresses a
      JOIN users u ON u.id = a.manager_id
      WHERE u.auth_id = auth.uid() OR u.id IN (
        SELECT manager_id FROM users WHERE auth_id = auth.uid() AND role = 'staff'
      )
    )
    OR EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'admin')
  );

-- Addresses: users can access addresses belonging to their manager (if staff) or themselves (if manager) or all (admin)
ALTER TABLE addresses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "managers_own_addresses" ON addresses;
CREATE POLICY "managers_own_addresses" ON addresses
  FOR ALL USING (
    manager_id IN (
      SELECT u.id FROM users u WHERE u.auth_id = auth.uid() AND u.role = 'manager'
    )
    OR manager_id IN (
      SELECT u.manager_id FROM users u WHERE u.auth_id = auth.uid() AND role = 'staff'
    )
    OR EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'admin')
  );

-- Shift closings: managers and admins
ALTER TABLE shift_closings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "managers_shift_closings" ON shift_closings;
CREATE POLICY "managers_shift_closings" ON shift_closings
  FOR ALL USING (
    address_id IN (
      SELECT a.id FROM addresses a
      JOIN users u ON u.id = a.manager_id
      WHERE u.auth_id = auth.uid() OR u.id IN (
        SELECT manager_id FROM users WHERE auth_id = auth.uid() AND role = 'staff'
      )
    )
    OR EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'admin')
  );

-- Users profiles: read own row, own team (same owner), or admin; insert own only
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "profiles_read" ON users;
DROP POLICY IF EXISTS "insert_profile" ON users;
DROP POLICY IF EXISTS "managers_read_all" ON users;
DROP POLICY IF EXISTS "read_own_profile" ON users;

CREATE POLICY "profiles_read" ON users
  FOR SELECT USING (
    auth.uid() IS NOT NULL
    AND (
        auth_id = auth.uid()
        OR public.is_admin_auth(auth.uid())
        OR id = public.auth_owner_id(auth.uid())
        OR manager_id = public.auth_owner_id(auth.uid())
    )
  );
CREATE POLICY "insert_profile" ON users
  FOR INSERT WITH CHECK (auth_id = auth.uid());

-- =============================================
-- Enable Realtime for orders and inventory
-- =============================================
-- Note: Supabase will ignore these if already added
-- ALTER PUBLICATION supabase_realtime ADD TABLE orders;
-- ALTER PUBLICATION supabase_realtime ADD TABLE inventory;


-- =============================================
-- RPC: bulk_create_orders
-- =============================================
CREATE OR REPLACE FUNCTION bulk_create_orders(orders_payload JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  order_rec JSONB;
  item_rec JSONB;
  new_order_id UUID;
  new_order_time TIMESTAMPTZ;
BEGIN
  FOR order_rec IN SELECT * FROM jsonb_array_elements(orders_payload)
  LOOP
    -- use provided created_at if exists, else now()
    new_order_time := COALESCE((order_rec->>'created_at')::TIMESTAMPTZ, now());

    INSERT INTO orders (total, total_cost, discount_amount, payment_method, address_id, staff_name, created_at)
    VALUES (
      (order_rec->>'total')::INTEGER,
      COALESCE((order_rec->>'total_cost')::INTEGER, 0),
      COALESCE((order_rec->>'discount_amount')::INTEGER, 0),
      order_rec->>'payment_method',
      (order_rec->>'address_id')::UUID,
      order_rec->>'staff_name',
      new_order_time
    )
    RETURNING id INTO new_order_id;

    FOR item_rec IN SELECT * FROM jsonb_array_elements(order_rec->'items')
    LOOP
      INSERT INTO order_items (order_id, product_id, quantity, options, unit_cost, extra_ids)
      VALUES (
        new_order_id,
        (item_rec->>'product_id')::UUID,
        (item_rec->>'quantity')::INTEGER,
        item_rec->>'options',
        COALESCE((item_rec->>'unit_cost')::INTEGER, 0),
        COALESCE(item_rec->'extra_ids', '[]'::JSONB)
      );
    END LOOP;
  END LOOP;
END;
$$;
