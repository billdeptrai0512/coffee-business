import { forwardRef, useImperativeHandle, useRef } from 'react'
import { createPortal } from 'react-dom'
import { QRCodeSVG } from 'qrcode.react'
import { formatVND } from '../../utils'
import { timeStringVN, dateShortVN, dateFullVN } from '../../utils/dateVN'

// Tờ bill khổ 80mm dùng chung cho bill theo BÀN (TableDetailModal) và bill ĐƠN LẺ
// mang đi (OrdersList) — một mẫu in duy nhất, tránh 2 thiết kế lệch nhau khi sửa.
// Ẩn trên màn hình, chỉ hiện khi in (@media print + @page trong index.css).
const BILL_RULE = { borderTop: '1px dashed #000', margin: '6px 0' }
const BILL_COLS = { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 58px 26px 58px', gap: 6 }

// ponytail: wifi quán hardcode cùng chỗ với logo/địa chỉ/SĐT (xem comment ngay dưới) —
// đổi mật khẩu wifi sau này chỉ cần sửa 2 hằng này, QR tự sinh lại theo giá trị mới.
const WIFI_SSID = 'KOPHIN COFFEE'
const WIFI_PASSWORD = 'kophin xinchao'
const WIFI_QR_VALUE = `WIFI:T:WPA;S:${WIFI_SSID};P:${WIFI_PASSWORD};;`

const fullLabel = (d) => `${timeStringVN(d)} ${dateShortVN(d)}`

// tableName truthy → bill theo bàn: "Bàn: <tên>" + "Giờ vào" (openedAt, cố định) + "Giờ ra"
// (thời điểm bấm in, cập nhật lại mỗi lần in). tableName null → đơn mang đi: "Bàn: Mang đi"
// + 1 mốc "Giờ" (openedAt = order.createdAt, cố định, chỉ giờ không kèm ngày — ngày đã có
// ở dòng "Ngày:" chung phía trên rồi).
const PrintBill = forwardRef(function PrintBill(
    { orderNo, tableName, openedAt, staffName, lines, subtotal, discountTotal, discountPct, total, printCount, onPrinted },
    ref
) {
    const printedAtRef = useRef(null)
    const printDateRef = useRef(null)
    const printCountLabelRef = useRef(null)
    // Seed từ số lần đã in LƯU Ở SERVER (đơn.print_count, xem TableDetailModal/OrdersList) —
    // không phải đếm lại từ 0 mỗi lần component này mount. Trước đây đếm bằng ref cục bộ nên
    // đóng bàn/mở lại hoặc in ở Nhật ký (PrintBill chỉ mount lúc bấm in, xem usePrintArmed) là
    // về lại "In lần: 1", sai với thực tế đã in bao nhiêu tờ cho đơn đó.
    const printCountRef = useRef(printCount ?? 0)

    // Cập nhật "Giờ ra"/"Ngày"/"In lần" ngay trước khi lấy bản in — dùng chung cho cả
    // print() (web) và captureImage() (native) nên 2 đường in không lệch giờ/lần in.
    function bumpPrintMeta() {
        const now = new Date()
        if (printedAtRef.current) printedAtRef.current.textContent = fullLabel(now)
        if (printDateRef.current) printDateRef.current.textContent = dateFullVN(now)
        printCountRef.current += 1
        if (printCountLabelRef.current) printCountLabelRef.current.textContent = String(printCountRef.current)
        // Ghi lại server SAU khi đã cập nhật màn hình — không chặn thao tác in vì lỗi mạng.
        onPrinted?.(printCountRef.current)
    }

    useImperativeHandle(ref, () => ({
        // Ghi thẳng vào DOM chứ không qua state: window.print() chạy đồng bộ, React
        // chưa kịp render lại thì hộp in đã chụp mất tờ bill với giờ/lần in cũ.
        print() {
            bumpPrintMeta()
            window.print()
        },
        // App native: chụp #print-bill bằng html2canvas thay vì window.print() — khớp
        // 100% layout web vì dùng chung DOM. Phần tử đang `hidden` (display:none) nên
        // phải tạm hiện lên NGOÀI màn hình (position:fixed, left âm) mới chụp được —
        // html2canvas không đọc được phần tử display:none. Import html2canvas động vì
        // chỉ đường native cần, không kéo vào bundle web.
        async captureImage() {
            bumpPrintMeta()
            const el = document.getElementById('print-bill')
            if (!el) return null
            const prevClassName = el.className
            const prevStyle = el.getAttribute('style')
            el.className = ''
            // color:#000 bắt buộc — chữ trong PrintBill không tự set màu, vốn ăn theo
            // default (đen trên nền trắng khi in thật qua @media print). Chụp ở ngữ cảnh
            // MÀN HÌNH thường (@media print không áp dụng) thì chữ kế thừa màu SÁNG từ
            // theme tối của app → trắng trên nền trắng tôi ép, chữ vô hình dù đường viền
            // (inline #000 riêng) vẫn thấy.
            el.style.cssText = 'position:fixed; left:-9999px; top:0; width:300px; background:#fff; color:#000; padding:10px 12px;'
            // Đợi 1 khung hình để trình duyệt thực sự layout/paint xong trước khi chụp —
            // đổi style xong gọi html2canvas ngay có thể chụp trúng lúc chưa kịp vẽ.
            await new Promise(requestAnimationFrame)
            try {
                const { default: html2canvas } = await import('html2canvas')
                return await html2canvas(el, { backgroundColor: '#fff' })
            } finally {
                el.className = prevClassName
                if (prevStyle) el.setAttribute('style', prevStyle)
                else el.removeAttribute('style')
            }
        },
    }), [])

    // Portal thẳng ra document.body — #print-bill vốn nằm sâu trong cây DOM của modal/thẻ
    // (sau header, danh sách món, nút bấm...). CSS in chỉ ẩn phần còn lại bằng
    // visibility:hidden (vẫn chiếm chỗ layout), trong khi position:fixed của #print-bill
    // lại không được Chromium tôn trọng khi phần tử nằm sâu như vậy lúc in — nó bị đẩy
    // xuống đúng bằng chiều cao phần nội dung ẩn phía trước, ra khoảng trắng lớn đầu bill.
    // Portal ra body loại bỏ hẳn mọi tổ tiên/nội dung đứng trước nó.
    return createPortal((
        <div id="print-bill" className="hidden">
            {/* ponytail: logo/địa chỉ/SĐT hardcode cho 1 quán (Kôphin) — addresses
                chưa có cột logo/address/phone (xem AddressContext), nên chưa thể tự
                set theo từng địa chỉ. Sau này mỗi khách cần tự upload logo + nhập
                địa chỉ/SĐT riêng cho quán của họ thay vì dùng chung khối này. */}
            <div style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                <div style={{ textAlign: 'center', fontWeight: 800, fontSize: 20, letterSpacing: 0.5 }}>KÔPHiN COFFEE</div>
                {/* <div style={{ textAlign: 'center', fontWeight: 800, fontSize: 9, letterSpacing: 3, marginTop: 2 }}>COFFEE TO GO</div> */}
            </div>
            <div style={{ textAlign: 'center', marginTop: 4, whiteSpace: 'nowrap' }}>Địa chỉ: 31 Nguyễn Thị Tươi,</div>
            <div style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>P. Tân Đông Hiệp, TPHCM</div>
            <div style={{ textAlign: 'center' }}>Điện thoại: 0794 466 366</div>
            <div style={BILL_RULE} />
            <div style={{ textAlign: 'center', fontWeight: 700, textTransform: 'uppercase' }}>
                Hoá đơn thanh toán
            </div>
            {orderNo != null && <div style={{ textAlign: 'center' }}>Số: HĐ{String(orderNo).padStart(6, '0')}</div>}
            <div style={{ textAlign: 'center' }}>Ngày: <span ref={printDateRef}>{dateFullVN(new Date())}</span></div>
            {tableName ? (
                <>
                    <div style={{ marginTop: 8 }}><b>Bàn:</b> {tableName}</div>
                    <div><b>Giờ vào:</b> {fullLabel(new Date(openedAt))}</div>
                    <div><b>Giờ ra:</b> <span ref={printedAtRef}>{fullLabel(new Date())}</span></div>
                </>
            ) : (
                <>
                    <div style={{ marginTop: 8 }}><b>Bàn:</b> Mang đi</div>
                    <div><b>Giờ:</b> {timeStringVN(new Date(openedAt))}</div>
                </>
            )}
            {staffName && <div><b>Nhân viên:</b> {staffName}</div>}
            <div><b>In lần:</b> <span ref={printCountLabelRef}>{(printCount ?? 0) + 1}</span></div>
            <div style={BILL_RULE} />
            <div style={{ ...BILL_COLS, fontWeight: 700 }}>
                <span style={{ whiteSpace: 'nowrap' }}>Tên hàng</span>
                <span style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>Đơn giá</span>
                <span style={{ textAlign: 'right' }}>SL</span>
                <span style={{ textAlign: 'center' }}>TT</span>
            </div>
            {lines.map(l => {
                // Dòng có giảm giá riêng → cột Đơn giá tách 2 tầng: giá gốc gạch ngang ở
                // trên, giá thực khách trả (đã trừ phần giảm của riêng dòng này, chia đều
                // cho SL) ở dưới. TT = thành tiền THỰC (đã trừ giảm giá dòng) — TIỀN HÀNG/
                // GIẢM GIÁ/TỔNG THANH TOÁN ở cuối bill tính riêng từ subtotal/discountTotal
                // cấp đơn (props), không cộng lại từ TT nên không bị đếm giảm giá 2 lần.
                const discounted = l.discountAmount > 0
                const netUnit = discounted ? Math.round((l.unitPrice * l.qty - l.discountAmount) / l.qty) : l.unitPrice
                return (
                    <div key={l.key} style={BILL_COLS}>
                        {/* Tên món + extras gộp chung 1 cột — extras bám sát ngay dưới tên, không
                            phụ thuộc chiều cao cột Đơn giá (2 dòng khi có giảm giá riêng dòng). */}
                        <div>
                            <div style={{ wordBreak: 'break-word' }}>{l.name}</div>
                            {l.extras.map(e => (
                                <div key={e.id} style={{ fontStyle: 'italic', fontSize: 11, whiteSpace: 'nowrap' }}>• {e.name}</div>
                            ))}
                        </div>
                        <span style={{ textAlign: 'right' }}>
                            {discounted ? (
                                <>
                                    <span style={{ display: 'block', textDecoration: 'line-through', fontSize: 10, opacity: 0.65 }}>{formatVND(l.unitPrice)}</span>
                                    <span style={{ display: 'block' }}>{formatVND(netUnit)}</span>
                                </>
                            ) : formatVND(l.unitPrice)}
                        </span>
                        <span style={{ textAlign: 'right' }}>{l.qty}</span>
                        <span style={{ textAlign: 'right' }}>{formatVND(l.unitPrice * l.qty - l.discountAmount)}</span>
                    </div>
                )
            })}
            <div style={BILL_RULE} />
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 700 }}>TIỀN HÀNG</span>
                <span>{formatVND(subtotal)}</span>
            </div>
            {discountTotal > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontWeight: 700 }}>GIẢM GIÁ ({discountPct}%)</span>
                    <span>-{formatVND(discountTotal)}</span>
                </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                <span>TỔNG THANH TOÁN</span>
                <span>{formatVND(total)}</span>
            </div>
            <div style={BILL_RULE} />
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 6 }}>
                <QRCodeSVG value={WIFI_QR_VALUE} size={90} />
            </div>
            <div style={{ textAlign: 'center', marginTop: 4 }}>Quét mã QR để truy cập Wifi</div>
            <div style={{ textAlign: 'center', marginTop: 8, fontWeight: 700, whiteSpace: 'nowrap' }}>
                Xin cảm ơn và hẹn gặp lại quý khách!
            </div>
            <div style={{ textAlign: 'center', fontStyle: 'italic' }}>Powered by KOPOS</div>
        </div>
    ), document.body)
})

export default PrintBill
