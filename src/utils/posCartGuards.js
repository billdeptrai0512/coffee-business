// Giỏ/bàn trong localStorage chỉ đáng tin nếu đúng địa chỉ đã đóng dấu lúc lưu — khác
// (hoặc chưa đóng dấu bao giờ) là giỏ/bàn của chi nhánh trước. Đổi chi nhánh qua /addresses
// làm POSProvider unmount rồi mount lại hẳn nên không có cách nào phân biệt ngoài dấu này
// (state trong RAM không sống sót qua unmount để so sánh trực tiếp).
export function cartBelongsToAddress(storedCartAddressId, addressId) {
    return !addressId || storedCartAddressId === addressId
}

// dineIn: handleConfirm dọn giỏ TRƯỚC khi gửi (guard double-tap không ghi 2 đơn). Gửi lỗi
// THẬT (không phải mất mạng — nhánh đó đã xếp hàng offline) phải trả giỏ về để bấm lại —
// NHƯNG chỉ khi giỏ đang trống thật: nhân viên có thể đã bắt đầu gọi món MỚI trong lúc đợi
// response, đè giỏ cũ lên đó là mất nguyên đợt mới.
export function shouldRestoreCartOnFailure(dineIn, currentCartLength) {
    return dineIn && currentCartLength === 0
}
