import { useEffect, useRef, useState } from 'react'
import { printBillJob } from '../lib/escposBitmap'

// Chỉ 1 thẻ được mang id="print-bill" tại 1 thời điểm (CSS @media print chọn theo id) —
// bấm in mới gắn id cho ĐÚNG thẻ này (mount PrintBill), in xong gỡ luôn để thẻ kế bấm sau
// không bị dính id cũ. Dùng ở mọi nơi có NHIỀU PrintBill tiềm năng cùng lúc trên 1 màn
// (danh sách đơn trong Nhật ký, danh sách đơn mang đi) — mount thường trực ở mọi thẻ thì
// nhiều #print-bill cùng tồn tại, CSS in sẽ hiện chồng lên nhau.
//
// printerIp: IP máy in mạng (selectedAddress.counter_printer_ip) — truyền thẳng cho
// printBillJob (escposBitmap.js, dùng chung với TableDetailModal): có IP + đang chạy app
// native (Capacitor) thì in bitmap ESC/POS qua mạng, không thì mở hộp in trình duyệt/hệ điều
// hành. Nhánh native từng THIẾU ở bản cũ là bug thật: PrintBill.print() gọi thẳng
// window.print() — API này KHÔNG TỒN TẠI trên WebView Android (window.print === undefined),
// ném TypeError ngay trong effect bên dưới, TRƯỚC dòng setPrintArmed(false) → cờ printArmed
// kẹt ở true mãi mãi → nút in bấm hoài không phản hồi nữa (chỉ tái hiện được trên APK thật,
// browser thường luôn có window.print nên không lộ ra khi test qua web).
// onError(err): gọi khi printBillJob ném lỗi — KHÔNG được nuốt lỗi lặng lẽ (bản trước làm
// vậy): người bấm in không thấy gì cả (không ra giấy, không báo lỗi) thì không cách nào biết
// là mất mạng/máy in tắt hay app đang có bug thật.
export function usePrintArmed(printerIp, onError) {
    const billRef = useRef(null)
    const [printArmed, setPrintArmed] = useState(false)

    // setState ở đây là chủ đích: đây LÀ đích đến của effect (gỡ mount sau khi đã đồng bộ
    // với thao tác in, có thể là external API window.print() hoặc network call native), không
    // phải suy ra state từ props/state khác.
    //
    // .finally() thay vì gọi setPrintArmed(false) ngay sau — PHẢI đợi in xong (kể cả nhánh
    // native, có network) mới gỡ mount PrintBill, nếu không unmount giữa chừng làm mất
    // #print-bill khỏi DOM trước khi kịp chụp/gọi in. Luôn setPrintArmed(false) dù thành công
    // hay lỗi — lỗi (mất mạng, máy in tắt...) không được để cờ kẹt lại, nếu không nút in liệt
    // luôn từ lần lỗi đó trở đi.
    useEffect(() => {
        if (!printArmed) return
        let cancelled = false
        Promise.resolve(printBillJob(billRef, printerIp))
            .catch(err => onError?.(err))
            .finally(() => {
                if (!cancelled) setPrintArmed(false)
            })
        return () => { cancelled = true }
    }, [printArmed, printerIp, onError])

    return { billRef, printArmed, arm: () => setPrintArmed(true) }
}
