import { dateStringVN } from './dateVN'

// Client-side mirror của phần resolve giá trong bulk_create_orders (xem
// supabase/migrations/20260909_bulk_create_orders_scheduled_discount.sql) — chỉ dùng để hiện
// đúng giá ở POS trước khi gửi, server luôn tính lại giá thật, không tin giá này.

// 0=CN..6=T7, cùng convention EXTRACT(DOW) phía SQL. Trick giống startOfWeekVN (dateVN.js):
// neo 12:00Z của ngày VN để .getUTCDay() luôn đúng bất kể TZ máy chạy.
export function todayDowVN() {
    return new Date(`${dateStringVN()}T12:00:00Z`).getUTCDay()
}

// days_of_week rỗng = không lọc theo thứ; start/end_date null = không giới hạn phía đó —
// mirror đúng điều kiện SQL. So sánh chuỗi 'YYYY-MM-DD' theo thứ tự từ điển vẫn đúng thứ tự
// thời gian.
export function activePrograms(programsForProduct) {
    const dow = todayDowVN()
    const today = dateStringVN()
    return (programsForProduct || []).filter(p => {
        if (!p.enabled) return false
        if (p.start_date && today < p.start_date) return false
        if (p.end_date && today > p.end_date) return false
        if (p.days_of_week.length > 0 && !p.days_of_week.includes(dow)) return false
        return true
    })
}

// null nếu không có chương trình nào đang active cho món này hôm nay. Công thức PHẢI khớp
// hệt SQL ở bulk_create_orders — không tái dùng computeDiscount() vì nó làm tròn SỐ TIỀN
// GIẢM trước rồi trừ, trong khi ở đây (và SQL) làm tròn GIÁ CÒN LẠI trực tiếp; 2 cách làm
// tròn có thể lệch nhau 1đ khi số tiền giảm rơi đúng mốc .5 (client hiện 1 giá, server tính
// tiền 1 giá khác).
export function resolveDiscountedPrice(basePrice, programsForProduct) {
    const active = activePrograms(programsForProduct)
    if (active.length === 0) return null
    return Math.min(...active.map(p => {
        if (p.type === 'fixed') return p.value
        if (p.type === 'amount') return Math.max(basePrice - p.value, 0)
        return Math.round(basePrice * (100 - Math.min(p.value, 100)) / 100)
    }))
}

// Chuẩn hoá ô nhập %: chỉ giữ số, kẹp 0-100, trả '' khi người dùng xoá trắng (không ép về
// '0'). Dùng chung ở form tạo (DiscountProgramsPage) và form sửa (DiscountProgramDetailPage)
// — trước đây mỗi nơi tự viết `Math.min(...) || ''`, gõ "0" bị xoá trắng nhầm vì 0 là falsy.
export function clampPercentInput(raw) {
    const digits = raw.replace(/[^\d]/g, '')
    if (!digits) return ''
    return String(Math.min(parseInt(digits, 10), 100))
}
