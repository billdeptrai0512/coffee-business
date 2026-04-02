-- =============================================
-- Coffee Cart Order App – Supabase Schema
-- =============================================

-- Users profiles (managers and staff, linked to Supabase Auth)
CREATE TABLE IF NOT EXISTS users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  auth_id UUID REFERENCES auth.users(id),
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('manager', 'staff', 'admin')),
  manager_id UUID REFERENCES users(id), -- staff belongs to a manager
  password TEXT NOT NULL DEFAULT ''
);

-- Addresses (locations managed by a manager)
CREATE TABLE IF NOT EXISTS addresses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  manager_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Products (menu items)
CREATE TABLE IF NOT EXISTS products (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  price INTEGER NOT NULL, -- price in VND
  is_active BOOLEAN DEFAULT true
);

-- Product prices (overrides per address)
CREATE TABLE IF NOT EXISTS product_prices (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  address_id UUID REFERENCES addresses(id) ON DELETE CASCADE,
  price INTEGER NOT NULL -- price in VND
);

-- Recipes (ingredients per product)
CREATE TABLE IF NOT EXISTS recipes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  ingredient TEXT NOT NULL,
  amount REAL NOT NULL, -- amount used per 1 serving
  manager_id UUID REFERENCES users(id) ON DELETE CASCADE -- null means default recipe
);

-- Inventory (current stock)
CREATE TABLE IF NOT EXISTS inventory (
  ingredient TEXT PRIMARY KEY,
  stock REAL NOT NULL DEFAULT 0
);

-- Ingredient costs (unit cost per ingredient)
CREATE TABLE IF NOT EXISTS ingredient_costs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ingredient TEXT NOT NULL,
  unit_cost INTEGER NOT NULL DEFAULT 0, -- cost per unit in VND
  manager_id UUID REFERENCES users(id) ON DELETE CASCADE -- null means default cost
);

-- Orders (scoped to address)
CREATE TABLE IF NOT EXISTS orders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  address_id UUID REFERENCES addresses(id) ON DELETE CASCADE,
  total INTEGER NOT NULL, -- total in VND
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Order Items
CREATE TABLE IF NOT EXISTS order_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id),
  quantity INTEGER NOT NULL
);

-- =============================================
-- Row Level Security Policies
-- =============================================

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

-- Products: read for all, write for authenticated managers
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "products_read" ON products;
DROP POLICY IF EXISTS "products_write" ON products;
CREATE POLICY "products_read" ON products FOR SELECT USING (true);
CREATE POLICY "products_write" ON products FOR ALL USING (auth.uid() IS NOT NULL);

-- Product prices: read for all, write for authenticated managers
ALTER TABLE product_prices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "prices_read" ON product_prices;
DROP POLICY IF EXISTS "prices_write" ON product_prices;
CREATE POLICY "prices_read" ON product_prices FOR SELECT USING (true);
CREATE POLICY "prices_write" ON product_prices FOR ALL USING (auth.uid() IS NOT NULL);

-- Recipes: read for all, write for authenticated managers
ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "recipes_read" ON recipes;
DROP POLICY IF EXISTS "recipes_write" ON recipes;
CREATE POLICY "recipes_read" ON recipes FOR SELECT USING (true);
CREATE POLICY "recipes_write" ON recipes FOR ALL USING (auth.uid() IS NOT NULL);

-- Ingredient costs: read for all, write for authenticated managers
ALTER TABLE ingredient_costs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "costs_read" ON ingredient_costs;
DROP POLICY IF EXISTS "costs_write" ON ingredient_costs;
CREATE POLICY "costs_read" ON ingredient_costs FOR SELECT USING (true);
CREATE POLICY "costs_write" ON ingredient_costs FOR ALL USING (auth.uid() IS NOT NULL);

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

-- Users profiles: users can read all profiles (needed for signup manager selection) but only insert own
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "profiles_read" ON users;
DROP POLICY IF EXISTS "insert_profile" ON users;
DROP POLICY IF EXISTS "managers_read_all" ON users;
DROP POLICY IF EXISTS "read_own_profile" ON users;

-- Enable anyone to read users (required so the Signup page can list managers)
CREATE POLICY "profiles_read" ON users
  FOR SELECT USING (true);
CREATE POLICY "insert_profile" ON users
  FOR INSERT WITH CHECK (auth_id = auth.uid());

-- =============================================
-- Enable Realtime for orders and inventory
-- =============================================
-- Note: Supabase will ignore these if already added
-- ALTER PUBLICATION supabase_realtime ADD TABLE orders;
-- ALTER PUBLICATION supabase_realtime ADD TABLE inventory;
