-- ==============================================================================================
-- 20260908_bulk_create_orders_takeaway_order_no.sql
-- Description: vá lại số hoá đơn cho đơn mang đi — bị 20260906_bulk_create_orders_toppings.sql
-- vô tình revert.
--
-- 20260816_order_no_for_takeaway.sql đã cấp order_no cho CẢ đơn mang đi (không chỉ đơn có bàn).
-- Nhưng 20260906 (gắn topping vào bulk_create_orders) copy thân hàm nhầm từ
-- 20260816_fix_bulk_create_orders_table_name_order_no.sql — bản NGAY TRƯỚC fix mang đi, không
-- phải bản cuối cùng — nên vô tình xoá mất nhánh cấp số cho mang đi. Kiểm tra trên DB thật
-- (2026-09-08): mọi đơn mang đi gần đây đều order_no NULL trong khi đơn bàn vẫn có số bình
-- thường — đúng dấu hiệu của regression này.
--
-- Xác nhận lại: ĐƠN NÀO CŨNG NÊN CÓ SỐ, kể cả mang đi ở địa chỉ tắt Bàn ngồi — không còn giữ
-- ngoại lệ "chưa có màn hình in nên khỏi cấp số" của 20260814 nữa.
--
-- Thân hàm giữ NGUYÊN VĂN từ 20260906_bulk_create_orders_toppings.sql (bản mới nhất, có
-- topping), chỉ thêm nhánh ELSE cấp order_no cho đơn mang đi — không đổi gì khác.
--
-- Mang đi khác bàn: không có khái niệm "gọi thêm cùng 1 lần mở" để dùng lại số — mỗi đơn độc
-- lập, luôn cấp số MỚI, không cần advisory lock theo bàn (không có "bàn" để khoá).
--
-- CÙNG signature (JSONB) → search_path + ownership guard theo CLAUDE.md, REVOKE/GRANT re-declare.
-- ==============================================================================================

BEGIN;

CREATE OR REPLACE FUNCTION bulk_create_orders(orders_payload JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  order_rec JSONB;
  item_rec JSONB;
  extra_id_txt TEXT;
  topping_id_txt TEXT;
  ing_rec RECORD; -- reused across the recipe / extra_ingredients / topping_ingredients COGS loops (sequential, never overlap)
  new_order_id UUID;
  new_order_time TIMESTAMPTZ;
  v_address_id UUID;
  v_discount_amount INTEGER;
  v_discount_capped INTEGER;
  v_table_name TEXT;
  v_order_total INTEGER;
  v_order_cost NUMERIC;
  v_order_no INTEGER;
  v_product_id UUID;
  v_quantity INTEGER;
  v_extra_ids JSONB;
  v_topping_ids JSONB;
  v_unit_price INTEGER;
  v_extras_price INTEGER;
  v_extra_price INTEGER; -- reused across the extra_ids / topping_ids price loops (sequential, never overlap)
  v_extra_name TEXT;
  v_options_text TEXT;
  v_line_cogs NUMERIC;
  v_ing_cost INTEGER;
BEGIN
  -- ORDER BY address_id, table_name, rồi ord — xem lý do deadlock ở đầu 20260814. WITH
  -- ORDINALITY giữ vị trí gốc trong mảng làm tiêu chí phụ cuối cùng.
  FOR order_rec IN
    SELECT elem FROM jsonb_array_elements(orders_payload) WITH ORDINALITY AS t(elem, ord)
    ORDER BY elem->>'address_id', elem->>'table_name', ord
  LOOP
    v_address_id := (order_rec->>'address_id')::UUID;

    -- Ownership guard. Allows admin / direct manager / co-manager via user_address_access.
    -- Skip when auth.uid() IS NULL (service_role / migrations bypass, mirroring RLS).
    IF auth.uid() IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM addresses
        WHERE id = v_address_id
          AND (
              public.is_admin_auth(auth.uid())
              OR manager_id = public.auth_owner_id(auth.uid())
              OR id IN (SELECT address_id FROM user_address_access WHERE auth_id = auth.uid())
          )
    ) THEN
        RAISE EXCEPTION 'Permission denied for address %', v_address_id USING ERRCODE = 'insufficient_privilege';
    END IF;

    new_order_time := COALESCE((order_rec->>'created_at')::TIMESTAMPTZ, now());
    v_discount_amount := COALESCE((order_rec->>'discount_amount')::INTEGER, 0);
    -- Nhãn bàn: chuỗi rỗng = không có bàn (client gửi input chưa điền), chuẩn hoá về NULL.
    v_table_name := NULLIF(TRIM(COALESCE(order_rec->>'table_name', '')), '');

    -- Insert with placeholder totals, backfilled below once every line is priced —
    -- avoids computing each line twice (once to sum, once to insert order_items).
    -- discount_amount cũng là placeholder: giá trị thật chỉ kẹp được sau khi biết tiền hàng.
    -- order_no chưa gán ở đây — chỉ gán khi biết chắc đây là hàng MỚI (new_order_id NOT NULL,
    -- xem dưới), và gán muộn nhất có thể (ngay trước UPDATE tổng cuối, xem đầu 20260814).
    -- Use client-supplied id if present (POS optimistic-UI identity / offline-sync retry
    -- identity), else default. ON CONFLICT DO NOTHING makes a retry of an id that already
    -- committed a no-op instead of a duplicate-key error or a second random-id row.
    INSERT INTO orders (id, total, total_cost, discount_amount, payment_method, address_id, staff_name, table_name, created_at)
    VALUES (
      COALESCE((order_rec->>'id')::UUID, gen_random_uuid()),
      0, 0, GREATEST(v_discount_amount, 0),
      order_rec->>'payment_method',
      v_address_id,
      order_rec->>'staff_name',
      v_table_name,
      new_order_time
    )
    ON CONFLICT (id) DO NOTHING
    RETURNING id INTO new_order_id;

    IF new_order_id IS NULL THEN
      -- Row already existed — a prior call with this id already fully committed
      -- order_items and totals (and already got an order_no). Nothing left to do.
      CONTINUE;
    END IF;

    v_order_total := 0;
    v_order_cost := 0;
    v_order_no := NULL; -- reset mỗi vòng

    FOR item_rec IN SELECT * FROM jsonb_array_elements(order_rec->'items')
    LOOP
      v_product_id := (item_rec->>'product_id')::UUID;
      v_quantity := (item_rec->>'quantity')::INTEGER;
      v_extra_ids := COALESCE(item_rec->'extra_ids', '[]'::JSONB);
      v_topping_ids := COALESCE(item_rec->'topping_ids', '[]'::JSONB);

      -- Selling price from the DB, never the client. The address match also closes a
      -- cross-tenant hole (referencing another shop's product_id).
      SELECT price INTO v_unit_price FROM products WHERE id = v_product_id AND owner_address_id = v_address_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid product % for address %', v_product_id, v_address_id USING ERRCODE = 'invalid_parameter_value';
      END IF;

      v_extras_price := 0;
      v_options_text := NULL;
      FOR extra_id_txt IN SELECT * FROM jsonb_array_elements_text(v_extra_ids)
      LOOP
        SELECT price, name INTO v_extra_price, v_extra_name
        FROM product_extras
        WHERE id = extra_id_txt::UUID AND product_id = v_product_id AND address_id = v_address_id;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Invalid extra % for product %', extra_id_txt, v_product_id USING ERRCODE = 'invalid_parameter_value';
        END IF;
        v_extras_price := v_extras_price + v_extra_price;
        v_options_text := CASE WHEN v_options_text IS NULL THEN v_extra_name ELSE v_options_text || ', ' || v_extra_name END;
      END LOOP;

      -- Toppings: thực thể toàn cục (không product_id) — chỉ chấp nhận nếu món này thật sự
      -- được gắn topping đó qua product_toppings (chặn client tự gán topping bừa cho món
      -- không liên quan, dù topping vẫn thuộc đúng address).
      FOR topping_id_txt IN SELECT * FROM jsonb_array_elements_text(v_topping_ids)
      LOOP
        SELECT price, name INTO v_extra_price, v_extra_name
        FROM toppings
        WHERE id = topping_id_txt::UUID AND address_id = v_address_id;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Invalid topping % for address %', topping_id_txt, v_address_id USING ERRCODE = 'invalid_parameter_value';
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM product_toppings
          WHERE product_id = v_product_id AND topping_id = topping_id_txt::UUID
        ) THEN
          RAISE EXCEPTION 'Topping % not linked to product %', topping_id_txt, v_product_id USING ERRCODE = 'invalid_parameter_value';
        END IF;
        v_extras_price := v_extras_price + v_extra_price;
        v_options_text := CASE WHEN v_options_text IS NULL THEN v_extra_name ELSE v_options_text || ', ' || v_extra_name END;
      END LOOP;

      v_order_total := v_order_total + (v_unit_price + v_extras_price) * v_quantity;

      -- COGS: recipe ingredients of the product + of each selected extra + of each selected
      -- topping's own recipe, priced at this address's ingredient_costs (mirrors
      -- calculateItemCost in src/utils/inventory.js, now the source of truth instead of a
      -- client-side estimate).
      v_line_cogs := 0;
      FOR ing_rec IN SELECT ingredient, amount FROM recipes WHERE product_id = v_product_id AND address_id = v_address_id
      LOOP
        SELECT unit_cost INTO v_ing_cost FROM ingredient_costs WHERE ingredient = ing_rec.ingredient AND address_id = v_address_id;
        v_line_cogs := v_line_cogs + COALESCE(v_ing_cost, 0) * ing_rec.amount;
      END LOOP;
      FOR extra_id_txt IN SELECT * FROM jsonb_array_elements_text(v_extra_ids)
      LOOP
        FOR ing_rec IN SELECT ingredient, amount FROM extra_ingredients WHERE extra_id = extra_id_txt::UUID
        LOOP
          SELECT unit_cost INTO v_ing_cost FROM ingredient_costs WHERE ingredient = ing_rec.ingredient AND address_id = v_address_id;
          v_line_cogs := v_line_cogs + COALESCE(v_ing_cost, 0) * ing_rec.amount;
        END LOOP;
      END LOOP;
      FOR topping_id_txt IN SELECT * FROM jsonb_array_elements_text(v_topping_ids)
      LOOP
        FOR ing_rec IN SELECT ingredient, amount FROM topping_ingredients WHERE topping_id = topping_id_txt::UUID
        LOOP
          SELECT unit_cost INTO v_ing_cost FROM ingredient_costs WHERE ingredient = ing_rec.ingredient AND address_id = v_address_id;
          v_line_cogs := v_line_cogs + COALESCE(v_ing_cost, 0) * ing_rec.amount;
        END LOOP;
      END LOOP;
      v_order_cost := v_order_cost + v_line_cogs * v_quantity;

      -- discount_amount: phần thêm của 20260816_order_items_line_discount.sql, giữ nguyên khi
      -- khôi phục thân hàm — resolved-amount theo dòng, cùng trust model với discount_amount
      -- cấp đơn (client-declared, xem comment ở migration đó).
      INSERT INTO order_items (order_id, product_id, quantity, options, unit_cost, extra_ids, topping_ids, discount_amount)
      VALUES (new_order_id, v_product_id, v_quantity, v_options_text, ROUND(v_line_cogs)::INTEGER, v_extra_ids, v_topping_ids, COALESCE((item_rec->>'discount_amount')::INTEGER, 0));
    END LOOP;

    -- Kẹp ở đây, chỗ duy nhất biết tiền hàng thật: giảm quá tay chỉ về 0 đồng, không âm;
    -- số âm bị chặn ở 0 để không ai cộng thêm tiền vào doanh thu bằng "chiết khấu".
    v_discount_capped := LEAST(GREATEST(v_discount_amount, 0), v_order_total);

    -- Số hoá đơn: MỌI đơn đều được cấp số, kể cả mang đi (xem đầu file — regression đã vá).
    -- Bàn: "1 bàn 1 số" — gọi thêm dùng lại số của lần mở bàn, không sinh số mới mỗi đợt.
    -- Mang đi: mỗi đơn độc lập, không có khái niệm "gọi thêm cùng 1 lần mở" để dùng lại số —
    -- luôn cấp số MỚI, không cần khoá (không có "bàn" để khoá).
    IF v_table_name IS NOT NULL THEN
      -- Khoá tư vấn theo (địa chỉ, tên bàn): 2 đợt "mở bàn mới" cùng bàn gửi đồng thời phải
      -- tuần tự hoá qua đây, nếu không cả hai đều thấy "bàn chưa có số" và mỗi bên tự cấp
      -- 1 số khác nhau cho CÙNG 1 lần mở bàn. Tự giải phóng cuối transaction.
      PERFORM pg_advisory_xact_lock(hashtextextended(v_address_id::text || ':' || v_table_name, 0));

      -- Bàn đang mở (chưa tính tiền, chưa xoá) đã có đợt nào mang số chưa?
      SELECT order_no INTO v_order_no
      FROM orders
      WHERE address_id = v_address_id
        AND table_name = v_table_name
        AND table_closed_at IS NULL
        AND deleted_at IS NULL
        AND order_no IS NOT NULL
      LIMIT 1;

      IF v_order_no IS NULL THEN
        -- Đợt đầu tiên của lần mở bàn này → cấp số mới. UPDATE...RETURNING khoá đúng 1
        -- hàng addresses cho tới khi transaction này commit — bàn khác cùng địa chỉ mở
        -- đồng thời phải chờ, nên không hai bàn nào lấy trùng số dù client gửi song song.
        UPDATE addresses SET next_order_no = next_order_no + 1
        WHERE id = v_address_id
        RETURNING next_order_no - 1 INTO v_order_no;
      END IF;
    ELSE
      UPDATE addresses SET next_order_no = next_order_no + 1
      WHERE id = v_address_id
      RETURNING next_order_no - 1 INTO v_order_no;
    END IF;

    UPDATE orders
    SET total = v_order_total - v_discount_capped,
        total_cost = ROUND(v_order_cost)::INTEGER,
        discount_amount = v_discount_capped,
        order_no = v_order_no
    WHERE id = new_order_id;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bulk_create_orders(JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.bulk_create_orders(JSONB) FROM anon;
GRANT  EXECUTE ON FUNCTION public.bulk_create_orders(JSONB) TO authenticated;

COMMIT;
