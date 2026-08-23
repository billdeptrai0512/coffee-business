import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { fetchTodayShiftClosing } from '../services/orderService'
import { mergeShiftClosingInventory } from '../services/reportService'
import { supabase } from '../lib/supabaseClient'
import { isGuest } from '../services/localRepository'
import { lookupByLabel } from '../utils/ingredients'
import { dateStringVN } from '../utils/dateVN'
import { onTabReturn } from '../utils/tabVisibility'
import { norm, strField, boolField, mergeField } from '../utils/fieldSync'
import { useIngredientCatalog } from './useIngredientCatalog'
import { useWarehouseStockSync } from './useWarehouseStockSync'

// Owns all the inventory-side state and side-effects that used to live in
// ShiftClosingPage: input maps for opening / restock / counter, the existing
// shift_closing row, the canonical warehouse balances, and the Realtime
// broadcast that keeps two staff on the same shift in sync.
//
// Returns everything DailyReportPage needs to render InventoryReportCard
// and build an inventory_report payload for save.
//
// ── Invariants (đọc trước khi sửa) ─────────────────────────────────────────
// 1. Baseline = ảnh chụp lần load/lưu gần nhất. isDirty/dirtySummary/
//    buildInventoryPatches đều SO input-maps hiện tại với baselineRef, không
//    có state "dirty" rời — sửa 1 chỗ tính dirty mà quên chỗ khác sẽ lệch.
// 2. mergeField (../utils/fieldSync) là luật hoà remote DUY NHẤT: field đang
//    dirty (khác baseline) → giữ local; field sạch → nhận remote. Áp cho cả
//    reconcileFromRemote lẫn tương lai nếu có thêm field cần đồng bộ.
// 3. seed.* (dưới đây) là nguồn dữ liệu duy nhất cho ngày ĐANG XEM khi
//    isDayScope — hook KHÔNG tự fetch song song với fetch của DailyReportPage.
//    Ingredient catalog (useIngredientCatalog) và warehouse/opening-stock
//    (useWarehouseStockSync) là 2 mối riêng, không đọc/ghi baseline.
// 4. pushInventory chỉ gửi DELTA (patch từng ingredient đổi so baseline) —
//    đây là thứ làm merge race-free giữa 2 thiết bị, đừng đổi thành gửi
//    nguyên mảng.
//
// Realtime channel is named after the address (same as before) so devices
// editing the same shift converge regardless of which page they're on.
// `dateKey` (e.g. todayISO from caller) is part of the effect deps so an overnight
// session detecting a date change clears stale inputs and refetches the new day's
// shift_closing instead of editing yesterday's row.
//
// `onFieldConflict(ingredient)` (optional) fires when reconcileFromRemote adopts a remote
// restock/skipped value for an ingredient THIS device pushed within the last few seconds —
// i.e. another device's concurrent edit just overwrote ours (last-write-wins at the
// per-ingredient patch level). Caller can surface a toast; purely informational, doesn't
// change merge behavior.
//
// `onRemoteCash(row)` (optional) nhận NGUYÊN dòng shift_closings của cùng ngày mỗi lần có
// event — kênh này vốn đã mang sẵn actual_cash/actual_transfer/cash_closed_at trong
// payload.new, trước đây bị vứt đi vì handler chỉ đọc inventory_report. Cho caller đồng bộ
// ô "Thực thu" mà không tốn thêm request nào.
//
// `seed.*` (optional) — DailyReportPage (qua useDailyReportData) fetch shift_closing +
// yesterday_closing của NGÀY ĐANG XEM ngay trong get_daily_report_context/get_report_by_date
// — đúng 1 lần cho cả "Hôm nay" LẪN 1 ngày quá khứ cụ thể (chỉ range tuần/tháng mới không có
// cặp này). Trước đây hook này tự fetch lại y hệt qua fetchTodayShiftClosing/
// fetchYesterdayShiftClosing → mỗi lần mở báo cáo 1 ngày tốn thêm round-trip trùng lặp (và ở
// scope quá khứ còn fetch NHẦM phiếu hôm nay vì fetchTodayShiftClosing không nhận tham số
// ngày). seed.isDayScope=true (Hôm nay hoặc 1-ngày-quá-khứ) + seedReady=true (cha đã fetch
// xong) → dùng thẳng seed.todayClosing/seed.yesterdayClosing, KHÔNG tự fetch nữa.
// seedReady=false mà isDayScope vẫn đợi (không tự bắn fetch trùng với fetch đang chạy của
// cha). isDayScope=false (range tuần/tháng/custom nhiều ngày) → giữ hành vi tự fetch cũ.
export function useShiftInventoryState(addressId, ingredientSortOrder, dateKey, onFieldConflict, onRemoteCash, seed = {}) {
    const { seedReady = false, isDayScope = false, todayClosing: seedTodayClosing, yesterdayClosing: seedYesterdayClosing } = seed
    // ── Inputs (staff-typed) ──────────────────────────────────────────────────
    const [openingInputs, setOpeningInputs] = useState({})
    const [openingLocked, setOpeningLocked] = useState({})
    const [restockInputs, setRestockInputs] = useState({})
    const [inventoryInputs, setInventoryInputs] = useState({})
    // "Bỏ qua" từng món "Soạn cho hôm nay" — đánh dấu "đã xem, không cần lấy" để vẫn hoàn
    // tất ca mà không phải nhập hàng thừa. Đồng bộ qua cùng cơ chế restock (patch vào
    // inventory_report, merge RPC, Realtime) thay vì localStorage → đa thiết bị thấy chung.
    const [skipped, setSkipped] = useState({})

    // ── Derived / fetched ─────────────────────────────────────────────────────
    const { ingredientsList, isLoadingIngredients, reloadIngredients } = useIngredientCatalog(addressId, ingredientSortOrder)
    const [existingClosing, setExistingClosing] = useState(null)

    // Dirty is DERIVED from a baseline snapshot (last loaded / last saved values).
    // The old boolean flag stuck at true after a revert because nothing knew
    // current state had returned to baseline; comparing maps each render fixes that.
    const baselineRef = useRef({ opening: {}, openingLocked: {}, restock: {}, inventory: {}, skipped: {} })
    const [baselineVersion, setBaselineVersion] = useState(0)
    const commitBaseline = useCallback((opening, openingLocked, restock, inventory, skipped) => {
        baselineRef.current = {
            opening: { ...opening },
            openingLocked: { ...openingLocked },
            restock: { ...restock },
            inventory: { ...inventory },
            skipped: { ...skipped },
        }
        setBaselineVersion(v => v + 1)
    }, [])

    // Mirror refs of the live input maps so reconcileFromRemote can merge synchronously
    // (without putting side-effects inside state updaters). Refreshed every render.
    const openingInputsRef = useRef(openingInputs); openingInputsRef.current = openingInputs
    const openingLockedRef = useRef(openingLocked); openingLockedRef.current = openingLocked
    const restockInputsRef = useRef(restockInputs); restockInputsRef.current = restockInputs
    const inventoryInputsRef = useRef(inventoryInputs); inventoryInputsRef.current = inventoryInputs
    const skippedRef = useRef(skipped); skippedRef.current = skipped

    // Timestamps of this device's own recent pushes, per ingredient — used only to tell
    // "remote just overwrote MY edit" (→ conflict toast) apart from a normal one-way
    // converge where we weren't editing that ingredient at all.
    const recentPushRef = useRef({})

    // ── Load existing shift closing → seed input maps ─────────────────────────
    // Re-runs when dateKey changes (midnight rollover) to drop stale yesterday inputs.
    useEffect(() => {
        // addressId === null (not undefined) means "Mẫu mặc định" (admin default
        // template) — a valid target, not "no address selected yet".
        if (addressId === undefined) return
        // Clear pre-existing input state so a new day starts blank if no closing exists yet.
        setExistingClosing(null)
        setInventoryInputs({})
        setRestockInputs({})
        setOpeningInputs({})
        setOpeningLocked({})
        setSkipped({})
        commitBaseline({}, {}, {}, {}, {})

        const applyTodayClosing = (data) => {
            if (!data) return
            // Guard against server returning yesterday's row as "today's" (tz / RPC
            // boundary issue). When closed_at isn't today VN, ignore — treat as no
            // existing closing so save creates a fresh row instead of updating yesterday.
            const isToday = !dateKey
                || (data.closed_at && dateStringVN(new Date(data.closed_at)) === dateKey)
            if (!isToday) return
            setExistingClosing(data)

            let parsed = data.inventory_report
            if (typeof parsed === 'string') {
                try { parsed = JSON.parse(parsed) } catch { console.warn('Could not parse inventory_report JSON, ignoring') }
            }
            if (!Array.isArray(parsed)) return

            const inputs = {}, restocks = {}, openings = {}, locked = {}, skips = {}
            parsed.forEach(item => {
                if (typeof item.remaining === 'number') inputs[item.ingredient] = String(item.remaining)
                if (typeof item.restock === 'number') restocks[item.ingredient] = String(item.restock)
                if (typeof item.opening === 'number') openings[item.ingredient] = String(item.opening)
                if (item.opening_locked) locked[item.ingredient] = true
                if (item.skipped) skips[item.ingredient] = true
            })
            setInventoryInputs(inputs)
            setRestockInputs(restocks)
            if (Object.keys(openings).length) setOpeningInputs(openings)
            if (Object.keys(locked).length) setOpeningLocked(locked)
            setSkipped(skips)
            // Snapshot baseline = whatever just got hydrated from the existing closing.
            // Đầu kỳ: nếu phiếu KHÔNG lưu opening (vd chỉ nhập Cuối kỳ), đừng reset baseline.opening
            // về {} — reloadStocks có thể đã seed openingInputs từ hôm qua. Reset sẽ khiến
            // input(seed) ≠ baseline({}) ⇒ phantom-dirty (FAB Lưu + chặn thoát) dù chưa gõ gì.
            // Giữ seed đang có trong baseline để 2 thứ khớp ở cả 2 thứ tự resolve của race.
            const openBase = Object.keys(openings).length ? openings : baselineRef.current.opening
            commitBaseline(openBase, locked, restocks, inputs, skips)
        }

        if (seedReady) {
            // Cha đã fetch xong (get_daily_report_context / get_report_by_date) — dùng thẳng.
            applyTodayClosing(seedTodayClosing)
            return
        }
        if (isDayScope) {
            // Đang ở 1 ngày cụ thể nhưng cha CHƯA fetch xong — đợi seedReady flip qua deps,
            // không tự bắn fetch trùng với fetch cha đang chạy.
            return
        }
        fetchTodayShiftClosing(addressId).then(applyTodayClosing)
    }, [addressId, dateKey, commitBaseline, seedReady, seedTodayClosing, isDayScope])

    // ── Canonical stock reader: warehouse + counter snapshots ────────────────
    // counter_stock seeds "Đầu kỳ" (= previous shift's remaining).
    // warehouse_stock is shown alongside each row and used to validate restock
    // input against the available kho tổng.
    // Refetches on tab visibility regain so a /ingredients → + Nhập kho mid-shift
    // reflects here without manual refresh.
    // Exposed so callers can refresh after writing stock (e.g. Nhập kho từ /daily-report)
    // — the warehouse balances then reflect the new purchase without a tab switch.
    const { warehouseStocks, openingStock, reload: reloadWarehouseStock } = useWarehouseStockSync(addressId, { seedReady, isDayScope, seedYesterdayClosing })
    const reloadStocks = useCallback(() => {
        if (addressId === undefined) return Promise.resolve()
        return reloadWarehouseStock().then(({ openings }) => {
            // Seed openingInputs only if today's closing hasn't set them yet.
            // When seeding kicks in, also fold the seed into baseline.opening so
            // a fresh tab doesn't read as "dirty" before any user edit.
            setOpeningInputs(prev => {
                if (Object.keys(prev).length > 0) return prev
                baselineRef.current = { ...baselineRef.current, opening: { ...openings } }
                setBaselineVersion(v => v + 1)
                return openings
            })
        })
    }, [addressId, reloadWarehouseStock])

    useEffect(() => {
        if (addressId === undefined) return
        reloadStocks()
        // Chỉ khi tab quay lại sau khi đi vắng — mỗi lần 'visible' là 2 query lặp vô hạn.
        return onTabReturn(reloadStocks)
    }, [addressId, reloadStocks])

    // ── Remote merge: fold another device's saved inventory_report into local maps ──
    // Per-field rule: nếu field local đang dirty (≠ baseline → user đang gõ dở) thì GIỮ
    // local — xem mergeField (../utils/fieldSync). Ngược lại nhận remote (vắng mặt = bị xoá)
    // và đẩy baseline theo → isDirty hết true (không lặp autosave). Hàng DB là mảng đầy đủ
    // nên "vắng mặt" nghĩa thật là thiết bị khác đã xoá/clear nguyên liệu đó.
    const reconcileFromRemote = useCallback((remoteReport) => {
        let parsed = remoteReport
        if (typeof parsed === 'string') { try { parsed = JSON.parse(parsed) } catch { return } }
        if (!Array.isArray(parsed)) return
        const rOpening = {}, rLocked = {}, rRestock = {}, rInventory = {}, rSkipped = {}
        parsed.forEach(item => {
            if (!item || !item.ingredient) return
            if (typeof item.opening === 'number') rOpening[item.ingredient] = String(item.opening)
            if (item.opening_locked) rLocked[item.ingredient] = true
            if (typeof item.restock === 'number') rRestock[item.ingredient] = String(item.restock)
            if (typeof item.remaining === 'number') rInventory[item.ingredient] = String(item.remaining)
            if (item.skipped) rSkipped[item.ingredient] = true
        })
        const b = baselineRef.current
        const [oOut, oNb] = mergeField(openingInputsRef.current, b.opening, rOpening, strField)
        const [lOut, lNb] = mergeField(openingLockedRef.current, b.openingLocked, rLocked, boolField)
        const [rOut, rNb, rAdopted] = mergeField(restockInputsRef.current, b.restock, rRestock, strField)
        const [iOut, iNb] = mergeField(inventoryInputsRef.current, b.inventory, rInventory, strField)
        const [sOut, sNb, sAdopted] = mergeField(skippedRef.current, b.skipped, rSkipped, boolField)
        setOpeningInputs(oOut); setOpeningLocked(lOut); setRestockInputs(rOut); setInventoryInputs(iOut); setSkipped(sOut)
        baselineRef.current = { opening: oNb, openingLocked: lNb, restock: rNb, inventory: iNb, skipped: sNb }
        setBaselineVersion(v => v + 1)
        // Chỉ 2 field "Soạn" động chạm (restock/skipped) mới cần cảnh báo conflict — remote vừa
        // đè lên push của CHÍNH thiết bị này trong vài giây gần đây (đua giữa 2 lượt merge).
        if (onFieldConflict) {
            const CONFLICT_WINDOW_MS = 8000
            const now = Date.now()
            // Set, không nối mảng thẳng: 1 nguyên liệu có thể vừa đổi CẢ restock lẫn skipped
            // trong cùng 1 hàng remote → nối thẳng sẽ gọi onFieldConflict 2 lần (2 toast trùng).
            for (const k of new Set([...rAdopted, ...sAdopted])) {
                const pushedAt = recentPushRef.current[k]
                if (pushedAt && now - pushedAt < CONFLICT_WINDOW_MS) onFieldConflict(k)
            }
        }
    }, [onFieldConflict])

    // onRemoteCash đọc state đang gõ dở của caller nên identity đổi liên tục — giữ qua ref
    // để kênh realtime bên dưới không phải resubscribe mỗi keystroke.
    const onRemoteCashRef = useRef(onRemoteCash); onRemoteCashRef.current = onRemoteCash

    // ── Realtime: subscribe to this address's shift_closings rows ─────────────
    // Replaces the old ephemeral broadcast (no replay, dropped packets = permanent
    // desync). Each device autosaves its edits (light merge RPC); postgres_changes pushes
    // the merged row to the other device → reconcileFromRemote converges them.
    // Guests are local-only and share one demo address id → skip Realtime entirely.
    //
    // KHÔNG có cổng "đủ 2 máy mới mở kênh": cổng cũ đếm countActiveSessions >= 2, mà
    // active_sessions upsert onConflict: 'user_id' ⇒ hai điện thoại đăng nhập CÙNG tài khoản
    // (đúng ca dùng phổ biến nhất) chỉ sinh một dòng → đếm ra 1 → kênh chưa từng mở ngày nào.
    // Đổi lại là mỗi máy đang ở màn báo cáo giữ một websocket; hook này chỉ sống trong
    // DailyReportPage nên kênh chỉ mở vài phút/ngày/máy, không phải cả ngày như orders.
    useEffect(() => {
        if (!addressId || !supabase || isGuest()) return
        const channel = supabase
            .channel(`shift-closing-db-${addressId}`)
            .on('postgres_changes',
                { event: '*', schema: 'public', table: 'shift_closings', filter: `address_id=eq.${addressId}` },
                (payload) => {
                    const row = payload.new
                    if (!row) return
                    // Only today's (VN) row — ignore events for other days' closings.
                    if (dateKey && row.closed_at && dateStringVN(new Date(row.closed_at)) !== dateKey) return
                    onRemoteCashRef.current?.(row)
                    if (row.inventory_report) reconcileFromRemote(row.inventory_report)
                })
            .subscribe()
        return () => { supabase.removeChannel(channel) }
    }, [addressId, dateKey, reconcileFromRemote])

    // ── Mutation handlers (plain setState; dirty is derived, autosave pushes) ─
    const onOpeningChange = useCallback((ingredient, value) => {
        setOpeningInputs(prev => ({ ...prev, [ingredient]: value }))
    }, [])

    const onRestockChange = useCallback((ingredient, value) => {
        setRestockInputs(prev => ({ ...prev, [ingredient]: value }))
    }, [])

    const onInventoryChange = useCallback((ingredient, value) => {
        setInventoryInputs(prev => ({ ...prev, [ingredient]: value }))
    }, [])

    const onSkipToggle = useCallback((ingredient, val) => {
        setSkipped(prev => {
            if (!val) { const { [ingredient]: _drop, ...rest } = prev; return rest }
            return { ...prev, [ingredient]: true }
        })
    }, [])

    // ── Derived: isDirty (compare inputs vs baseline) ────────────────────────
    // Empty string and undefined both mean "no input" — normalize so a load that
    // hydrates "" → never sees a phantom diff against undefined baseline keys.
    const isDirty = useMemo(() => {
        const mapEq = (a, b) => {
            const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})])
            for (const k of keys) if (norm(a?.[k]) !== norm(b?.[k])) return false
            return true
        }
        const b = baselineRef.current
        return !(
            mapEq(openingInputs, b.opening)
            && mapEq(openingLocked, b.openingLocked)
            && mapEq(restockInputs, b.restock)
            && mapEq(inventoryInputs, b.inventory)
            && mapEq(skipped, b.skipped)
        )
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [openingInputs, openingLocked, restockInputs, inventoryInputs, skipped, baselineVersion])

    // Danh sách field đã đổi so với baseline, dạng người-đọc-được — để confirm "rời trang"
    // chú thích cụ thể thay đổi nào sắp mất (thay vì câu chung chung gây mơ hồ khi user
    // nghĩ mình chưa đổi gì). Mỗi dòng: "Nguyên liệu · Loại: cũ → mới".
    const dirtySummary = useMemo(() => {
        const fmt = (v) => (v == null ? '(trống)' : v)
        const b = baselineRef.current
        const lines = []
        const fields = [
            ['Đầu kỳ', openingInputs, b.opening],
            ['Cuối kỳ', inventoryInputs, b.inventory],
            ['Lấy ra', restockInputs, b.restock],
        ]
        for (const [label, cur, base] of fields) {
            for (const ing of new Set([...Object.keys(cur || {}), ...Object.keys(base || {})])) {
                if (norm(cur[ing]) !== norm(base[ing]))
                    lines.push(`${ing} · ${label}: ${fmt(norm(base[ing]))} → ${fmt(norm(cur[ing]))}`)
            }
        }
        for (const ing of new Set([...Object.keys(openingLocked || {}), ...Object.keys(b.openingLocked || {})])) {
            if (!!openingLocked[ing] !== !!b.openingLocked[ing])
                lines.push(`${ing} · Khoá đầu kỳ: ${openingLocked[ing] ? 'bật' : 'tắt'}`)
        }
        for (const ing of new Set([...Object.keys(skipped || {}), ...Object.keys(b.skipped || {})])) {
            if (!!skipped[ing] !== !!b.skipped[ing])
                lines.push(`${ing} · Bỏ qua: ${skipped[ing] ? 'bật' : 'tắt'}`)
        }
        return lines
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [openingInputs, inventoryInputs, restockInputs, openingLocked, skipped, baselineVersion])

    // Restock có đổi so với baseline không. Lưu có restock thay đổi = chuyển kho ra quầy
    // (trừ kho tổng server-side) → cần confirm; lưu chỉ-đếm (Đầu/Cuối kỳ) thì không.
    const restockDirty = useMemo(() => {
        const a = restockInputs, b = baselineRef.current.restock || {}
        const keys = new Set([...Object.keys(a || {}), ...Object.keys(b)])
        for (const k of keys) if (norm(a?.[k]) !== norm(b[k])) return true
        return false
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [restockInputs, baselineVersion])

    // ── Derived: effective warehouse stocks ──────────────────────────────────
    // When editing an already-saved shift, `warehouseStocks` from fetchIngredientStocks
    // has already subtracted this shift's restock. Add it back so validation compares
    // the new restock input against the warehouse balance *before* this shift's
    // restock — otherwise a no-op edit triggers a false "Vượt kho".
    const effectiveWarehouseStocks = useMemo(() => {
        if (!existingClosing) return warehouseStocks
        let parsed = existingClosing.inventory_report
        if (typeof parsed === 'string') {
            try { parsed = JSON.parse(parsed) } catch { return warehouseStocks }
        }
        if (!Array.isArray(parsed)) return warehouseStocks
        const adjusted = { ...warehouseStocks }
        parsed.forEach(item => {
            if (typeof item.restock === 'number' && item.ingredient) {
                adjusted[item.ingredient] = (adjusted[item.ingredient] || 0) + item.restock
            }
        })
        return adjusted
    }, [warehouseStocks, existingClosing])

    // ── Derived: restock-overflow detection ──────────────────────────────────
    // Any row where typed restock > kho tổng available. Submitting through this would
    // clamp warehouse_stock to 0 on the server and corrupt /ingredients tồn đầu math.
    const restockOverflowIngredients = useMemo(() => {
        const list = []
        for (const ing of ingredientsList) {
            const r = Number(restockInputs[ing.ingredient] || 0)
            // Tra kèm fallback theo label (giống warehousePrepList) — nếu chỉ tra key trực tiếp,
            // NVL lưu key biến thể sẽ ra undefined → bỏ qua guard → restock vượt kho lọt qua,
            // server clamp warehouse về 0. Dùng undefined làm "không theo dõi kho" (bỏ kiểm).
            const avail = lookupByLabel(ing.ingredient, effectiveWarehouseStocks, undefined)
            if (avail !== undefined && r > Number(avail || 0)) list.push(ing.ingredient)
        }
        return list
    }, [ingredientsList, restockInputs, effectiveWarehouseStocks])

    // Empty inputs are preserved as `null`, NOT coerced to 0 — a blank "+ Cuối kỳ"
    // means "staff didn't count this ingredient at end of shift", not "0g remaining".
    // Audit cards must skip diff calc for null `remaining` so they don't surface
    // a fake hao hụt equal to the whole theoretical stock. (null remaining + null restock
    // + null opening = tombstone → merge RPC removes the ingredient.)
    const parseOrNull = (v) => (v === undefined || v === '' ? null : Number(v))

    // Delta vs baseline — only the ingredients THIS device changed, for the light merge RPC.
    // An ingredient cleared back to empty emits an all-null entry → RPC treats it as a
    // tombstone and removes it. Sending only the delta is what makes the merge race-free:
    // two devices editing different ingredients never touch each other's entries.
    const buildInventoryPatches = useCallback(() => {
        const unitOf = {}
        ingredientsList.forEach(i => { unitOf[i.ingredient] = i.unit || 'đv' })
        const b = baselineRef.current
        const keys = new Set([
            ...Object.keys(openingInputs), ...Object.keys(inventoryInputs),
            ...Object.keys(restockInputs), ...Object.keys(openingLocked), ...Object.keys(skipped),
            ...Object.keys(b.opening), ...Object.keys(b.inventory),
            ...Object.keys(b.restock), ...Object.keys(b.openingLocked), ...Object.keys(b.skipped),
        ])
        const patches = []
        for (const ing of keys) {
            const changed =
                norm(openingInputs[ing]) !== norm(b.opening[ing])
                || norm(inventoryInputs[ing]) !== norm(b.inventory[ing])
                || norm(restockInputs[ing]) !== norm(b.restock[ing])
                || !!openingLocked[ing] !== !!b.openingLocked[ing]
                || !!skipped[ing] !== !!b.skipped[ing]
            if (!changed) continue
            patches.push({
                ingredient: ing,
                unit: unitOf[ing] || 'đv',
                opening: parseOrNull(openingInputs[ing]),
                opening_locked: !!openingLocked[ing],
                remaining: parseOrNull(inventoryInputs[ing]),
                restock: parseOrNull(restockInputs[ing]),
                skipped: !!skipped[ing],
            })
        }
        return patches
        // baselineVersion bumps the baselineRef snapshot used above.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ingredientsList, inventoryInputs, restockInputs, openingInputs, openingLocked, skipped, baselineVersion])

    // ── Light autosave push: send this device's delta, merge server-side, converge ──
    // Advances baseline ONLY for the fields we just pushed → they read non-dirty (no re-push
    // loop); fields typed *after* the snapshot stay dirty and push next cycle.
    // We deliberately do NOT reconcile the RPC RESPONSE row: its HTTP reply can arrive out of
    // order vs the realtime echo, and a stale snapshot (missing a field the other device just
    // added) would wrongly clear it. The authoritative fold/clear of the other device's edits
    // comes from the ORDERED postgres_changes echo (our own UPDATE is delivered back too).
    const pushingRef = useRef(false)
    const pushInventory = useCallback(async (closedBy, systemTotalRevenue) => {
        if (pushingRef.current) return null   // an earlier push still in flight → skip; isDirty stays true → retried
        const patches = buildInventoryPatches()
        if (!patches.length) return null
        pushingRef.current = true
        try {
            const row = await mergeShiftClosingInventory(addressId, patches, closedBy, systemTotalRevenue)
            if (!row) return null
            // Pushed values → baseline (so they read non-dirty); tombstones (all null) drop the key.
            const b = baselineRef.current
            const opening = { ...b.opening }, openingLocked = { ...b.openingLocked }
            const restock = { ...b.restock }, inventory = { ...b.inventory }, skipped = { ...b.skipped }
            const now = Date.now()
            for (const p of patches) {
                const k = p.ingredient
                if (p.opening == null) delete opening[k]; else opening[k] = String(p.opening)
                if (!p.opening_locked) delete openingLocked[k]; else openingLocked[k] = true
                if (p.restock == null) delete restock[k]; else restock[k] = String(p.restock)
                if (p.remaining == null) delete inventory[k]; else inventory[k] = String(p.remaining)
                if (!p.skipped) delete skipped[k]; else skipped[k] = true
                recentPushRef.current[k] = now   // mark so a conflicting remote update for this ingredient surfaces a toast
            }
            baselineRef.current = { opening, openingLocked, restock, inventory, skipped }
            setBaselineVersion(v => v + 1)   // recompute isDirty against advanced baseline
            setExistingClosing(row)
            return row
        } finally {
            pushingRef.current = false
        }
    }, [addressId, buildInventoryPatches])

    // Snapshot of the last-committed baseline, refreshed whenever baselineVersion bumps.
    // Sort + collapse logic on InventoryReportCard reads from this so live keystrokes
    // don't re-order rows mid-edit — only load / save / lock events shift the layout.
    const baselineSnapshot = useMemo(() => ({
        opening: baselineRef.current.opening,
        openingLocked: baselineRef.current.openingLocked,
        restock: baselineRef.current.restock,
        inventory: baselineRef.current.inventory,
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [baselineVersion])

    return {
        // raw input maps
        openingInputs, openingLocked, restockInputs, inventoryInputs, skipped,
        // fetched / derived
        ingredientsList, isLoadingIngredients,
        openingStock, warehouseStocks, effectiveWarehouseStocks, reloadStocks, reloadIngredients,
        existingClosing, setExistingClosing,
        restockOverflowIngredients,
        // dirty tracking (derived from baseline comparison; baseline advances on push/remote merge)
        isDirty, restockDirty, dirtySummary,
        // last-persisted snapshot (bumps on load / save / lock) — used by the card to
        // sort and to remount rows so they auto-collapse after a successful save.
        baselineSnapshot, baselineVersion,
        // handlers
        onOpeningChange, onRestockChange, onInventoryChange, onSkipToggle,
        // save helpers
        pushInventory,
    }
}
