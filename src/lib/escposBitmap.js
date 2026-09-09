import { Capacitor } from '@capacitor/core'

// Chuyển ảnh (chụp từ DOM #print-bill qua html2canvas) sang ESC/POS raster (GS v 0)
// rồi in thẳng qua mạng bằng plugin native — bitmap là cách DUY NHẤT in đúng dấu
// tiếng Việt trên máy in nhiệt dòng Xprinter: máy dùng bảng mã TCVN-3 riêng mà JS/
// Android không tự encode sang được (xem issue #238 DantSu/ESCPOS-ThermalPrinter-
// Android — tác giả thư viện xác nhận phải in ảnh).
//
// Chụp thẳng DOM thay vì tự vẽ lại layout bằng canvas: khớp 100% với bản web
// (PrintBill.jsx) vĩnh viễn, kể cả sau này sửa layout — không có 2 bản song song
// lệch nhau dần.
//
// Thuật toán đóng gói bit copy nguyên từ EscPosPrinterCommands.bitmapToBytes (Java)
// của thư viện DantSu để plugin @albgen/capacitor-escpos-plugin (dựng trên thư viện
// này) hiểu đúng dữ liệu qua tag <img>hex</img>.
const PRINTER_WIDTH_PX = 576 // 80mm @ 203dpi, quy ước phổ biến cho máy in 80mm
const BLACK_THRESHOLD = 160 // độ sáng kênh màu (0-255) dưới ngưỡng này → tính là điểm đen khi in đơn sắc
const CAPTURE_TIMEOUT_MS = 8000 // chụp #print-bill qua html2canvas (nghi có thể treo trên WebView thật)
const PRINT_TIMEOUT_MS = 20000 // gửi + in vật lý qua mạng — bill dài (nhiều món) có thể mất >10s vẫn bình thường
const PRINT_RETRY_ATTEMPTS = 3
const PRINT_RETRY_DELAY_MS = 800
const AFTERPRINT_FALLBACK_MS = 5000 // WebView Capacitor không đảm bảo bắn 'afterprint' sau window.print()

export function packGSv0(imageData, widthPx, heightPx) {
    const bytesPerLine = Math.ceil(widthPx / 8)
    const out = new Uint8Array(8 + bytesPerLine * heightPx)
    out[0] = 0x1D; out[1] = 0x76; out[2] = 0x30; out[3] = 0x00
    out[4] = bytesPerLine & 0xFF; out[5] = (bytesPerLine >> 8) & 0xFF
    out[6] = heightPx & 0xFF; out[7] = (heightPx >> 8) & 0xFF
    const px = imageData.data
    for (let y = 0; y < heightPx; y++) {
        const rowStart = y * widthPx * 4
        for (let bx = 0; bx < bytesPerLine; bx++) {
            let b = 0
            let i = rowStart + bx * 8 * 4 // index của pixel (bx*8, y) — tăng dần theo k thay vì nhân lại mỗi bit
            for (let k = 0; k < 8; k++) {
                if (bx * 8 + k < widthPx) {
                    if (px[i] < BLACK_THRESHOLD || px[i + 1] < BLACK_THRESHOLD || px[i + 2] < BLACK_THRESHOLD) b |= 1 << (7 - k)
                }
                i += 4
            }
            out[8 + y * bytesPerLine + bx] = b
        }
    }
    return out
}

// Bảng tra sẵn 256 giá trị byte → hex — tránh gọi toString(16).padStart() lặp lại cho
// từng byte (ảnh 1 bill dài có thể tới hàng trăm nghìn byte).
const HEX_BYTE = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'))

export function bytesToHex(bytes) {
    const out = new Array(bytes.length)
    for (let i = 0; i < bytes.length; i++) out[i] = HEX_BYTE[bytes[i]]
    return out.join('')
}

// canvas: kết quả html2canvas(#print-bill) — scale về đúng bề rộng máy in, giữ tỉ lệ.
function canvasToEscPosImage(canvas) {
    const scale = PRINTER_WIDTH_PX / canvas.width
    const heightPx = Math.round(canvas.height * scale)
    const scaled = document.createElement('canvas')
    scaled.width = PRINTER_WIDTH_PX
    scaled.height = heightPx
    const ctx = scaled.getContext('2d')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, PRINTER_WIDTH_PX, heightPx)
    ctx.drawImage(canvas, 0, 0, PRINTER_WIDTH_PX, heightPx)
    const imageData = ctx.getImageData(0, 0, PRINTER_WIDTH_PX, heightPx)
    const bytes = packGSv0(imageData, PRINTER_WIDTH_PX, heightPx)
    return bytesToHex(bytes)
}

// Chặn treo vô thời hạn — nghi html2canvas/lệnh in mạng có thể treo (không lỗi, không xong)
// trên WebView thật dù chạy êm trên Chrome desktop. Timeout ném lỗi thay vì để spinner quay
// mãi, dù chưa chắc chắn nguyên nhân gốc. LƯU Ý: race kiểu này không HUỶ được promise thật
// — hết giờ chỉ là JS-side bỏ cuộc, việc gốc (chụp ảnh, gửi lệnh in) có thể vẫn đang chạy.
// isTimeout đánh dấu RIÊNG lỗi do chính đây tạo ra — printWithRetry cần phân biệt với lỗi
// THẬT ném từ plugin/network (xem comment ở đó).
function withTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => {
            const err = new Error(`${label}: quá ${ms}ms, có thể bị treo`)
            err.isTimeout = true
            reject(err)
        }, ms)),
    ])
}

// Chờ ms mili giây — dùng cho khoảng nghỉ giữa các lần thử lại bên dưới.
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

// Máy in nhiệt rẻ tiền (Xprinter...) qua TCP thường chỉ có 1 khe kết nối — bận in đợt
// trước, hoặc socket cũ chưa kịp giải phóng hẳn phía OS (dù plugin đã đóng đúng cách,
// xem patches/), là lần connect kế tiếp bị từ chối "Unable to connect to TCP device"
// dù cùng mạng, cùng IP — CHẬP CHỜN theo thời điểm, không phải lỗi cấu hình. Thử lại
// vài lần với khoảng nghỉ ngắn trước khi thật sự báo lỗi cho người dùng — attempt sau
// tạo TCP connection MỚI HOÀN TOÀN (không phải nối lại cái cũ), nên gần như luôn qua
// được nếu đây đúng là tranh chấp khe kết nối thoáng qua.
async function printWithRetry(ESCPOSPlugin, payload, attempts = PRINT_RETRY_ATTEMPTS) {
    let lastErr
    for (let i = 0; i < attempts; i++) {
        try {
            return await withTimeout(ESCPOSPlugin.printFormattedText(payload), PRINT_TIMEOUT_MS, 'printFormattedText')
        } catch (err) {
            lastErr = err
            // err.isTimeout (xem withTimeout) KHÔNG có nghĩa lệnh in thất bại — withTimeout
            // không huỷ được promise thật, máy in có thể đang in dở dang (bill dài, ảnh cao,
            // gửi/in >20s vẫn bình thường). Thử lại ở đây gửi NGUYÊN payload thêm lần nữa trong
            // lúc máy còn đang in lần trước → in trùng liên tiếp, ra 1 bill dài gấp 2-3 lần,
            // không ngừng (sự cố thật đã gặp với đơn nhiều món). Chỉ retry lỗi THẬT từ plugin
            // (vd "Unable to connect to TCP device" — bị từ chối ngay trước khi gửi dữ liệu, an
            // toàn để mở kết nối mới thử lại).
            if (err?.isTimeout) throw err
            if (i < attempts - 1) await sleep(PRINT_RETRY_DELAY_MS)
        }
    }
    throw lastErr
}

// In thẳng qua mạng bằng plugin native — dùng trên app Capacitor khi địa chỉ đã cấu
// hình IP máy in (xem setPrinters ở AddressContext). billRef: ref tới <PrintBill>
// đang mount sẵn trong DOM (đã có cùng props với bản in web). err.stage đánh dấu lỗi xảy
// ra ở bước nào (capture DOM hay gửi mạng) — showError/Sentry (useToast.js) đọc lại để
// debug từ xa không phải đoán, thay vì mọi lỗi in đều chung 1 message mù mờ như nhau.
async function printBillNative(billRef, printerIp) {
    let canvas
    try {
        canvas = await withTimeout(billRef.current?.captureImage(), CAPTURE_TIMEOUT_MS, 'captureImage')
        if (!canvas) throw new Error('Không tìm thấy #print-bill để chụp')
    } catch (err) {
        err.stage = 'capture'
        throw err
    }
    const hex = canvasToEscPosImage(canvas)
    const { ESCPOSPlugin } = await import('@albgen/capacitor-escpos-plugin')
    try {
        await printWithRetry(ESCPOSPlugin, {
            type: 'tcp',
            id: printerIp,
            address: printerIp,
            port: '9100',
            // action kết thúc bằng "Cut" → plugin gọi printFormattedTextAndCut thay vì
            // printFormattedText (xem ESCPOSPlugin.java) — thiếu cái này máy không tự cắt giấy.
            action: 'printAndCut',
            text: `[C]<img>${hex}</img>\n\n\n`,
        })
    } catch (err) {
        err.stage = 'send'
        throw err
    }
}

// Khoá in — CẤP MODULE: chỉ 1 máy in vật lý dùng chung cho MỌI lệnh in trong app (bàn ở
// TableDetailModal lẫn từng đơn lẻ ở Nhật ký/OrdersList), nhưng không nơi nào khoá nút in
// chéo giữa 2 bàn/đơn KHÁC nhau — bấm in bàn A rồi bấm in đơn B trong lúc A còn đang gửi dữ
// liệu (vài giây thật qua mạng) là 2 lệnh cùng chạm máy in vật lý cùng lúc. Từ chối NGAY
// (fail-fast, báo lỗi rõ luôn) thay vì âm thầm xếp hàng đợi — dễ trace hơn: người bấm biết
// ngay là phải đợi, log/Sentry cũng không lẫn giữa "lỗi in" thật với "in chồng do bấm nhanh".
let printBusy = false

// In bill dùng chung cho mọi nơi gọi in (TableDetailModal, usePrintArmed) — trước đây mỗi
// nơi tự chép lại y hệt logic native/web bên dưới, sửa 1 chỗ (như đợt vá timeout/retry ở
// printBillNative) dễ quên áp lại chỗ còn lại. Native (Capacitor + đã cấu hình IP máy in):
// in bitmap qua mạng, không dialog. Web hoặc chưa cấu hình: mở hộp in trình duyệt/hệ điều
// hành, đợi 'afterprint' hoặc tối đa AFTERPRINT_FALLBACK_MS.
export async function printBillJob(billRef, printerIp) {
    if (printBusy) {
        // expected: true — lỗi biết trước (đang in dở), không phải bug, useToast.js không
        // báo Sentry cho loại này.
        throw Object.assign(new Error('Máy in đang bận, đợi bill trước in xong rồi thử lại'), { expected: true })
    }
    printBusy = true
    try {
        if (Capacitor.isNativePlatform() && printerIp) {
            await printBillNative(billRef, printerIp)
            return
        }
        await new Promise((resolve) => {
            // resolve() gọi 2 lần vô hại (Promise chỉ ăn lần đầu); { once } tự gỡ listener.
            window.addEventListener('afterprint', resolve, { once: true })
            setTimeout(resolve, AFTERPRINT_FALLBACK_MS)
            billRef.current?.print()
        })
    } finally {
        printBusy = false
    }
}
