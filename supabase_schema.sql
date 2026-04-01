-- =============================================
-- Coffee Cart Order App – Supabase Schema
-- =============================================

-- Products (menu items)
CREATE TABLE products (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  price INTEGER NOT NULL -- price in VND
);

-- Recipes (ingredients per product)
CREATE TABLE recipes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  ingredient TEXT NOT NULL,
  amount REAL NOT NULL -- amount used per 1 serving
);

-- Inventory (current stock)
CREATE TABLE inventory (
  ingredient TEXT PRIMARY KEY,
  stock REAL NOT NULL DEFAULT 0
);

-- Ingredient costs (unit cost per ingredient)
CREATE TABLE ingredient_costs (
  ingredient TEXT PRIMARY KEY,
  unit_cost INTEGER NOT NULL DEFAULT 0 -- cost per unit in VND
);

-- Orders
CREATE TABLE orders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  total INTEGER NOT NULL, -- total in VND
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Order Items
CREATE TABLE order_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id),
  quantity INTEGER NOT NULL
);

-- =============================================
-- Seed Data – Vietnamese Coffee Cart Menu
-- =============================================

INSERT INTO products (id, name, price) VALUES
  ('11111111-1111-1111-1111-111111111101', 'Cà phê đen', 15000),
  ('11111111-1111-1111-1111-111111111102', 'Cà phê sữa', 20000),
  ('11111111-1111-1111-1111-111111111103', 'Bạc xỉu', 25000),
  ('11111111-1111-1111-1111-111111111104', 'Trà đào', 25000),
  ('11111111-1111-1111-1111-111111111105', 'Trà vải', 25000),
  ('11111111-1111-1111-1111-111111111106', 'Nước ép cam', 30000);

-- Recipes: how much of each ingredient per serving
INSERT INTO recipes (product_id, ingredient, amount) VALUES
  -- Cà phê đen: 20g coffee, 1 cup, 1 lid
  ('11111111-1111-1111-1111-111111111101', 'coffee_g', 20),
  ('11111111-1111-1111-1111-111111111101', 'cup', 1),
  ('11111111-1111-1111-1111-111111111101', 'lid', 1),
  -- Cà phê sữa: 20g coffee, 30ml condensed milk, 1 cup, 1 lid
  ('11111111-1111-1111-1111-111111111102', 'coffee_g', 20),
  ('11111111-1111-1111-1111-111111111102', 'condensed_milk_ml', 30),
  ('11111111-1111-1111-1111-111111111102', 'cup', 1),
  ('11111111-1111-1111-1111-111111111102', 'lid', 1),
  -- Bạc xỉu: 10g coffee, 50ml fresh milk, 20ml condensed milk, 1 cup, 1 lid
  ('11111111-1111-1111-1111-111111111103', 'coffee_g', 10),
  ('11111111-1111-1111-1111-111111111103', 'fresh_milk_ml', 50),
  ('11111111-1111-1111-1111-111111111103', 'condensed_milk_ml', 20),
  ('11111111-1111-1111-1111-111111111103', 'cup', 1),
  ('11111111-1111-1111-1111-111111111103', 'lid', 1),
  -- Trà đào: 1 tea bag, 30ml peach syrup, 1 cup, 1 lid
  ('11111111-1111-1111-1111-111111111104', 'tea_bag', 1),
  ('11111111-1111-1111-1111-111111111104', 'peach_syrup_ml', 30),
  ('11111111-1111-1111-1111-111111111104', 'cup', 1),
  ('11111111-1111-1111-1111-111111111104', 'lid', 1),
  -- Trà vải: 1 tea bag, 30ml lychee syrup, 1 cup, 1 lid
  ('11111111-1111-1111-1111-111111111105', 'tea_bag', 1),
  ('11111111-1111-1111-1111-111111111105', 'lychee_syrup_ml', 30),
  ('11111111-1111-1111-1111-111111111105', 'cup', 1),
  ('11111111-1111-1111-1111-111111111105', 'lid', 1),
  -- Nước ép cam: 3 oranges, 1 cup, 1 lid
  ('11111111-1111-1111-1111-111111111106', 'orange', 3),
  ('11111111-1111-1111-1111-111111111106', 'cup', 1),
  ('11111111-1111-1111-1111-111111111106', 'lid', 1);

-- Inventory: initial stock
INSERT INTO inventory (ingredient, stock) VALUES
  ('coffee_g', 2000),        -- 2kg coffee
  ('condensed_milk_ml', 3000), -- 3L condensed milk
  ('fresh_milk_ml', 5000),   -- 5L fresh milk
  ('tea_bag', 100),          -- 100 tea bags
  ('peach_syrup_ml', 2000),  -- 2L peach syrup
  ('lychee_syrup_ml', 2000), -- 2L lychee syrup
  ('orange', 50),            -- 50 oranges
  ('cup', 200),              -- 200 cups
  ('lid', 200);              -- 200 lids

-- Ingredient costs: unit cost per ingredient (VND)
INSERT INTO ingredient_costs (ingredient, unit_cost) VALUES
  ('coffee_g', 250),           -- 250đ/g
  ('cacao_powder_g', 100),     -- 100đ/g
  ('matcha_powder_g', 100),    -- 100đ/g
  ('sugar', 19),               -- 19đ/g
  ('rich_g', 150),             -- 150đ/g
  ('condensed_milk_ml', 60),   -- 60đ/ml
  ('fresh_milk_ml', 35),       -- 35đ/ml
  ('salt_cream_ml', 50),       -- 50đ/ml
  ('sugar_syrup_ml', 30),      -- 30đ/ml
  ('cup', 800),                -- 800đ/ly
  ('lid', 200);                -- 200đ/nắp

-- =============================================
-- Enable Realtime for orders and inventory
-- =============================================
ALTER PUBLICATION supabase_realtime ADD TABLE orders;
ALTER PUBLICATION supabase_realtime ADD TABLE inventory;
