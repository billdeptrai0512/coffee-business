import React, { useMemo, useState } from 'react';
import { calculateEstimatedConsumption, buildRecipeIngredientSet, walkDailyIngredientDiff } from '../../utils/inventory';
import { dateStringVN } from '../../utils/dateVN';
import { ingredientLabel, getIngredientUnit } from '../../utils/ingredients';
import { ChevronDown } from 'lucide-react';
import { useProducts } from '../../contexts/ProductContext';
import { formatVND } from '../../utils';

/**
 * RangeLossCard – Aggregated inventory loss for a week/month.
 *
 * Uses the exact same per-day formula as the daily audit (InventoryReportCard),
 * then sums across all days that have a shift_closing in the period.
 *
 * Per-day formula (identical to daily audit):
 *   opening  = previousClosing.remaining (or current closing.opening override)
 *   restock  = closing.restock
 *   used     = estimatedConsumption from that day's orders
 *   theoretical = opening + restock - used
 *   diff     = actual - theoretical        (negative = loss)
 *
 * We sum `diff` and `diffValue` per ingredient across all days.
 */
export default function RangeLossCard({
    orders,
    shiftClosings,
    prevShiftClosings,
    recipes,
    extraIngredients,
    ingredientUnits = {},
}) {
    const { ingredientConfigs = [], products = [] } = useProducts() || {};
    const [expandedRows, setExpandedRows] = useState({});
    const toggleRow = (ingredient) => {
        setExpandedRows(prev => ({ ...prev, [ingredient]: !prev[ingredient] }));
    };

    // For each ingredient, pick a "reference product" = sản phẩm bán chạy nhất
    // có dùng nguyên liệu đó. Dùng để quy đổi hụt/dư → số ly tương đương,
    // giúp user hình dung magnitude (vd: "≈ 33 ly cà phê sữa").
    const ingredientToProduct = useMemo(() => {
        const sales = {};
        orders.forEach(o => {
            if (o.deleted_at) return;
            (o.order_items || []).forEach(i => {
                const pid = i.product_id || i.productId;
                sales[pid] = (sales[pid] || 0) + (i.quantity || i.qty || 1);
            });
        });

        const map = {};
        (recipes || []).forEach(r => {
            if (!r.amount || r.amount <= 0) return;
            const s = sales[r.product_id] || 0;
            const cur = map[r.ingredient];
            // Prefer best-seller; fall back to first-seen recipe
            if (!cur || s > cur.sales) {
                map[r.ingredient] = { productId: r.product_id, amountPerCup: r.amount, sales: s };
            }
        });
        // Resolve product names; drop entries whose product không tìm thấy hoặc 1:1 ratio
        // (vd: nắp/ly — "≈ 220 ly cà phê sữa" cho "Dư 220 cái" không thêm thông tin)
        for (const ing of Object.keys(map)) {
            const ref = map[ing];
            const p = products.find(pp => pp.id === ref.productId);
            if (!p?.name || ref.amountPerCup === 1) {
                delete map[ing];
                continue;
            }
            ref.productName = p.name.toLowerCase();
        }
        return map;
    }, [recipes, products, orders]);

    const auditData = useMemo(() => {
        if (!shiftClosings || shiftClosings.length === 0) return { rows: [], totalLossValue: 0 };

        // Bao bì/vật tư không có công thức (ống hút, bịch chữ T) chỉ đếm tồn — tiêu hao của
        // chúng là dùng thật, không phải thất thoát. Bỏ khỏi card "Hao hụt trong kỳ" (đã ghi
        // tên riêng trong COGS), khớp với cách FinanceCards tách chúng ra.
        const recipeSet = buildRecipeIngredientSet(recipes, extraIngredients);

        // --- Step 1: Build daily order-item lists keyed by YYYY-MM-DD ---
        const dailyOrderItems = {};
        orders.forEach(o => {
            if (o.deleted_at) return;
            const dayStr = dateStringVN(new Date(o.created_at)); // YYYY-MM-DD theo giờ VN
            if (!dailyOrderItems[dayStr]) dailyOrderItems[dayStr] = [];

            (o.order_items || []).forEach(i => dailyOrderItems[dayStr].push({
                productId: i.product_id || i.productId, qty: i.quantity || i.qty || 1,
                extras: i.extra_ids ? i.extra_ids.map(id => ({ id })) : (i.extras || [])
            }));
        });

        // Pre-calculate estimated consumption per day
        const dailyConsumption = {};
        for (const [dayStr, items] of Object.entries(dailyOrderItems)) {
            dailyConsumption[dayStr] = calculateEstimatedConsumption(items, recipes, extraIngredients);
        }

        // --- Step 2: Keep only the LAST closing per calendar day, oldest → newest.
        // Mỗi ngày có thể có nhiều ca (sáng/tối). dailyConsumption là tổng cả ngày,
        // nếu audit từng ca sẽ bị đếm trùng tiêu hao. Daily audit (RPC LIMIT 1) cũng
        // chỉ dùng ca cuối ngày — range giữ đúng convention đó để tổng = tổng daily.
        const lastClosingPerDay = {};
        for (const c of shiftClosings) {
            const dayStr = dateStringVN(new Date(c.closed_at));
            const prev = lastClosingPerDay[dayStr];
            if (!prev || new Date(c.closed_at) > new Date(prev.closed_at)) {
                lastClosingPerDay[dayStr] = c;
            }
        }

        // --- Step 3+4: Đi từng ngày, tính diff (opening/restock/used/theoretical) —
        // công thức dùng CHUNG với calculateLossValue/buildDailyHaoHutMap (walkDailyIngredientDiff),
        // tránh 3 nơi chép tay cùng 1 công thức rồi lệch nhau khi sửa.
        const totalLossPerIngredient = {};
        let totalLossValue = 0;
        // Index 1 lần: vòng dưới chạy (số ngày × số nguyên liệu) lần, tháng là cả nghìn
        // dòng — .find() tuyến tính mỗi dòng là quét lại cả bảng config mỗi lần.
        const configByIngredient = new Map((ingredientConfigs || []).map(c => [c.ingredient, c]));

        for (const { dayStr, ingredient, diff } of walkDailyIngredientDiff({
            shiftClosings: Object.values(lastClosingPerDay), dailyConsumption, prevShiftClosings,
        })) {
            // Không trong công thức nào → tiêu hao thật, không phải thất thoát.
            if (!recipeSet.has(ingredient)) continue;

            const unitCost = configByIngredient.get(ingredient)?.unit_cost || 0;
            const diffValue = diff * unitCost;

            if (!totalLossPerIngredient[ingredient]) {
                totalLossPerIngredient[ingredient] = { diff: 0, diffValue: 0, daily: [] };
            }
            totalLossPerIngredient[ingredient].diff += diff;
            totalLossPerIngredient[ingredient].diffValue += diffValue;
            totalLossPerIngredient[ingredient].daily.push({ dayStr, diff, diffValue });

            if (diffValue < 0) totalLossValue += Math.abs(diffValue);
        }

        // --- Step 5: Build display rows ---
        // Card này chỉ quan tâm thất thoát (hụt). Bỏ row có net dư.
        // Giữ row "Bù trừ" (net ≈ 0) nếu có ngày hụt — ngày hụt là anomaly thật.
        const rows = Object.entries(totalLossPerIngredient)
            .filter(([_, data]) => data.diff <= 0.05 && data.daily.some(d => d.diff < -0.05))
            .map(([ingredient, data]) => {
                const unit = getIngredientUnit(ingredient, '', ingredientUnits);
                const diff = Math.round(data.diff * 10) / 10;
                const hasAnomaly = data.daily.some(d => Math.abs(d.diff) > 0.05);
                let diffText, diffColor, diffBg;

                if (diff < -0.05) {
                    diffText = `Hụt ${Math.abs(diff)} ${unit}`;
                    diffColor = 'text-danger';
                    diffBg = 'bg-danger/10';
                } else if (diff > 0.05) {
                    diffText = `Dư ${diff} ${unit}`;
                    diffColor = 'text-warning';
                    diffBg = 'bg-warning/10';
                } else if (hasAnomaly) {
                    diffText = 'Bù trừ';
                    diffColor = 'text-text-secondary';
                    diffBg = 'bg-surface-light';
                } else {
                    diffText = 'Khớp';
                    diffColor = 'text-success';
                    diffBg = 'bg-success/10';
                }

                // Sort daily entries chronologically, only keep anomalous days
                const dailyAnomalies = data.daily
                    .filter(d => Math.abs(d.diff) > 0.05)
                    .sort((a, b) => a.dayStr.localeCompare(b.dayStr))
                    .map(d => {
                        let dText, dColor;
                        if (d.diff < 0) {
                            dText = `Hụt ${Math.abs(d.diff)} ${unit}`;
                            dColor = 'text-danger';
                        } else {
                            dText = `Dư ${d.diff} ${unit}`;
                            dColor = 'text-warning';
                        }
                        const [, m, day] = d.dayStr.split('-');
                        return { ...d, dateLabel: `${day}/${m}`, dText, dColor };
                    });

                // Quy đổi sang số ly tương đương dựa trên best-seller dùng nguyên liệu này
                const ref = ingredientToProduct[ingredient];
                let equivText = null;
                if (ref && ref.amountPerCup > 0) {
                    const cups = Math.round(Math.abs(diff) / ref.amountPerCup);
                    if (cups > 0) equivText = `≈ ${cups} ly ${ref.productName}`;
                }

                return {
                    ingredient, diff,
                    diffValue: data.diffValue,
                    diffText, diffColor, diffBg, unit,
                    dailyAnomalies,
                    equivText
                };
            }).sort((a, b) => a.diffValue - b.diffValue);

        return { rows, totalLossValue };
    }, [shiftClosings, prevShiftClosings, orders, recipes, extraIngredients, ingredientConfigs, ingredientUnits, ingredientToProduct]);

    if (!auditData.rows.length && auditData.totalLossValue === 0) return null;

    return (
        <div className="bg-surface rounded-[20px] p-4 border border-border/60 shadow-sm flex flex-col gap-2.5">
            <div className="flex items-center justify-center border-b border-border/40 pb-2.5">
                <span className="text-[12px] font-bold text-text uppercase tracking-widest opacity-80">Hao hụt trong kỳ</span>

            </div>

            <div className="flex flex-col space-y-2">
                {auditData.rows.map(item => {
                    const isExpanded = !!expandedRows[item.ingredient];
                    const moneyVal = Math.abs(item.diffValue);
                    return (
                        <div key={item.ingredient} className="flex flex-col border-b border-border/20 last:border-0 pb-2 last:pb-0">
                            <div
                                className="flex items-center justify-between cursor-pointer group"
                                onClick={() => toggleRow(item.ingredient)}
                            >
                                <div className="flex flex-col flex-1 pr-2 min-w-0">
                                    <div className="flex items-center gap-1">
                                        <span className="text-[13px] font-bold text-text leading-tight truncate">
                                            {ingredientLabel(item.ingredient)}
                                        </span>
                                        <ChevronDown size={12} className={`text-text-dim shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                                    </div>
                                    <span className={`text-[11px] font-black tabular-nums mt-1 ${item.diffColor}`}>
                                        {item.equivText && <span className="opacity-80 font-medium text-[10px]">{item.equivText}</span>}
                                    </span>
                                </div>
                                <div className="flex flex-col items-end shrink-0 gap-1">
                                    <div className={`px-2 py-0.5 rounded border border-transparent ${item.diffBg} border-${item.diffColor.replace('text-', '')}/20`}>
                                        <span className={`text-[11px] font-black tabular-nums ${item.diffColor}`}>
                                            {item.diffText}
                                        </span>
                                    </div>
                                    {moneyVal >= 1 && item.diffValue < 0 && (
                                        <span className={`text-[11px] font-black tabular-nums ${item.diffColor}`}>
                                            -{formatVND(moneyVal)}
                                        </span>
                                    )}
                                </div>
                            </div>

                            {isExpanded && item.dailyAnomalies.length > 0 && (
                                <div className="mt-2 px-3 py-2 bg-surface-light rounded-[10px] border border-border/40 flex flex-col gap-1">
                                    <span className="text-[9px] font-black text-text-dim uppercase mb-0.5">Chi tiết theo ngày</span>
                                    {item.dailyAnomalies.map(d => (
                                        <div key={d.dayStr} className="flex items-center justify-between">
                                            <span className="text-[11px] font-medium text-text-secondary tabular-nums">{d.dateLabel}</span>
                                            <div className="flex items-center gap-2">
                                                <span className={`text-[11px] font-bold tabular-nums ${d.dColor}`}>{d.dText}</span>
                                                {Math.abs(d.diffValue) >= 1 && d.diffValue < 0 && (
                                                    <span className={`text-[11px] font-black tabular-nums ${d.dColor} min-w-[60px] text-right`}>
                                                        -{formatVND(Math.abs(d.diffValue))}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            <div className="mt-2 flex flex-col">
                <div
                    className="pt-3 border-t border-border/40 flex items-center justify-between cursor-pointer"
                >
                    <div className="flex items-center gap-1">
                        <span className="text-[14px] font-bold text-text-secondary">Tổng cộng:</span>
                    </div>
                    <span className="text-[14px] font-black text-danger tabular-nums">-{formatVND(auditData.totalLossValue)}</span>
                </div>

            </div>
        </div>
    );
}
