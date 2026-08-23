// Vietnam timezone helpers. The app and the Postgres DB live in different timezones
// (browser local vs UTC), so any "today" boundary computed via browser-local
// `setHours(0,0,0,0)` or `toDateString()` drifts whenever the runtime isn't Asia/Ho_Chi_Minh.
//
// All date boundaries used for filtering / fetching / reporting MUST go through
// these helpers so the semantics stay consistent regardless of where the code
// runs (laptop in HCMC, server in UTC, future client in another TZ).

// VN là UTC+7 quanh năm, không có DST → dịch đúng 7 giờ rồi đọc phần UTC là
// chính xác tuyệt đối.
//
// KHÔNG dùng toLocaleDateString('en-CA') / ('sv-SE') để lấy chuỗi ISO nữa: mấy
// locale đó CHỈ tình cờ định dạng yyyy-mm-dd, và WebView / in-app browser bị cắt
// dữ liệu Intl sẽ lặng lẽ rơi về locale mặc định (vd "03/08/2026"). Lúc đó
// split('-') bên dưới trả undefined và màn hình hiện "undefined/undefined/undefined".
// toISOString() thì được spec khoá cứng định dạng, không phụ thuộc Intl hay tz database.
const VN_OFFSET_MS = 7 * 60 * 60 * 1000
function vnISO(date) {
    // Date rác (parse chuỗi null/hỏng) → trả '' thay vì để toISOString ném lỗi
    // làm trắng cả trang; trước đây nó chỉ in ra "Invalid Date".
    if (Number.isNaN(date?.getTime?.())) return ''
    return new Date(date.getTime() + VN_OFFSET_MS).toISOString()
}

// "YYYY-MM-DD" string in Vietnam timezone for the given Date (defaults to now).
export function dateStringVN(date = new Date()) {
    return vnISO(date).slice(0, 10)
}

// "HH:mm" (24h) string in Vietnam timezone for the given Date (defaults to now).
export function timeStringVN(date = new Date()) {
    return vnISO(date).slice(11, 16)
}

// "dd/mm" in Vietnam timezone. Built on dateStringVN instead of Date#getDate()/
// getMonth() (browser-local) so display stays correct if the runtime TZ isn't VN.
export function dateShortVN(date = new Date()) {
    const [, m, d] = dateStringVN(date).split('-')
    return `${d}/${m}`
}

// "dd/mm" từ 1 timestamp bất kỳ, chuỗi rỗng nếu thiếu/hỏng — dùng cho dòng chi phí
// trong báo cáo (scope nhiều ngày cần biết khoản đó rơi vào ngày nào).
export function dayMonthVN(ts) {
    if (!ts) return ''
    const d = new Date(ts)
    return isNaN(d) ? '' : dateShortVN(d)
}

// "dd/mm/yyyy" in Vietnam timezone.
export function dateFullVN(date = new Date()) {
    const [y] = dateStringVN(date).split('-')
    return `${dateShortVN(date)}/${y}`
}

// Start of "today in Vietnam" — i.e. 00:00:00.000 local VN time, as a UTC-aware Date.
// Equivalent to: midnight in VN expressed in absolute time.
//   At 02:00 VN on 2026-05-18 (= 19:00 UTC on 2026-05-17):
//     startOfDayVN() → 2026-05-18 00:00:00 +07:00 = 2026-05-17 17:00:00 UTC
export function startOfDayVN(date = new Date()) {
    return new Date(`${dateStringVN(date)}T00:00:00+07:00`)
}

// End of "today in Vietnam" — 23:59:59.999 local VN time.
export function endOfDayVN(date = new Date()) {
    return new Date(`${dateStringVN(date)}T23:59:59.999+07:00`)
}

// Compare two dates for "same day in Vietnam". Replaces toDateString() equality
// (which depends on browser TZ and would compare wrong dates near midnight).
export function isSameDayVN(d1, d2) {
    return dateStringVN(new Date(d1)) === dateStringVN(new Date(d2))
}

// Nhãn giờ mở đợt/đơn: chỉ giờ nếu cùng ngày hôm nay, kèm ngày nếu khác — bàn/đơn mang đi
// ngồi/tồn qua đêm là chuyện thường (xem fetchOpenTables) nên không thể luôn chỉ hiện giờ.
// Dùng ở TableDetailModal + TakeawayListModal.
export function openedLabelVN(iso) {
    const d = new Date(iso)
    return isSameDayVN(d, new Date()) ? timeStringVN(d) : `${timeStringVN(d)} ${dateShortVN(d)}`
}

// Add (or subtract) days from a date, anchored to VN midnight.
export function addDaysVN(date, days) {
    const start = startOfDayVN(date)
    return new Date(start.getTime() + days * 86_400_000)
}

// Start of "this week in VN" — Monday 00:00:00.000 VN.
export function startOfWeekVN(date = new Date()) {
    const todayVN = startOfDayVN(date)
    // Noon-UTC anchor of the VN date guarantees the same weekday everywhere.
    const dow = new Date(`${dateStringVN(date)}T12:00:00Z`).getUTCDay() // 0=Sun..6=Sat
    const mondayOffset = (dow + 6) % 7 // Mon=0..Sun=6
    return new Date(todayVN.getTime() - mondayOffset * 86_400_000)
}

// Start of "month X+offset in VN" — day 1, 00:00:00.000 VN.
export function startOfMonthVN(date = new Date(), offset = 0) {
    const [y, m] = dateStringVN(date).split('-').map(Number)
    const targetMonth0 = m - 1 + offset // 0-based
    const targetYear = y + Math.floor(targetMonth0 / 12)
    const normalizedMonth = ((targetMonth0 % 12) + 12) % 12 + 1
    return new Date(`${targetYear}-${String(normalizedMonth).padStart(2, '0')}-01T00:00:00+07:00`)
}

// End of "month X" — last millisecond before next month's start.
export function endOfMonthVN(date = new Date(), offset = 0) {
    return new Date(startOfMonthVN(date, offset + 1).getTime() - 1)
}
