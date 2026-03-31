// Format VND currency
export function formatVND(amount) {
    return new Intl.NumberFormat('vi-VN').format(amount) + 'đ'
}
