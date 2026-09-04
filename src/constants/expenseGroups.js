// Phân nhóm nhãn chi phí (expense_categories.group_section). Một nguồn chân lý
// cho cả picker (chọn/tạo nhãn) lẫn báo cáo (Dòng tiền / Lợi nhuận).
//
// Hành vi từng nhóm ở 2 báo cáo:
//   operating     — Vận hành: Dòng tiền (section Vận hành) + Lợi nhuận (chi phí vận hành)
//   overhead      — Quản lý & khác: Dòng tiền (section riêng) + Lợi nhuận (chi phí quản lý)
//   inventory     — Tồn kho: Dòng tiền (section Tồn kho, cạnh mua NVL) + Lợi nhuận
//                   (1 dòng "Chi phí tồn kho" riêng, KHÔNG lẫn COGS tiêu hao công thức)
//   non_operating — Ngoài kinh doanh: Dòng tiền (section riêng) NHƯNG KHÔNG vào Lợi nhuận
//                   (không hiện, không trừ — tiền ra ngoài hoạt động KD)
export const EXPENSE_GROUPS = [
    { key: 'operating',     label: 'Vận hành',         dotCls: 'bg-danger',  tabCls: 'bg-danger/20 text-danger',   inProfit: true },
    { key: 'overhead',      label: 'Quản lý & khác',   dotCls: 'bg-warning', tabCls: 'bg-warning/20 text-warning', inProfit: true },
    { key: 'inventory',     label: 'Chi phí tồn kho',  dotCls: 'bg-primary', tabCls: 'bg-primary/20 text-primary', inProfit: true },
    { key: 'non_operating', label: 'Ngoài kinh doanh', dotCls: 'bg-text-dim', tabCls: 'bg-border/40 text-text-secondary', inProfit: false },
]

export const groupMeta = (key) =>
    EXPENSE_GROUPS.find(g => g.key === key) || EXPENSE_GROUPS[0]

const KNOWN_GROUP_KEYS = new Set(EXPENSE_GROUPS.map(g => g.key))

// Nhãn thuộc 1 nhóm — nhãn cũ chưa gán group_section (hoặc gán giá trị lạ) mặc định
// rơi vào "operating" thay vì biến mất khỏi mọi nhóm.
export const labelsInGroup = (categories, key) => categories.filter(c =>
    c.group_section === key || (key === 'operating' && !KNOWN_GROUP_KEYS.has(c.group_section))
)
