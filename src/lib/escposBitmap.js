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

function packGSv0(imageData, widthPx, heightPx) {
    const bytesPerLine = Math.ceil(widthPx / 8)
    const out = new Uint8Array(8 + bytesPerLine * heightPx)
    out[0] = 0x1D; out[1] = 0x76; out[2] = 0x30; out[3] = 0x00
    out[4] = bytesPerLine & 0xFF; out[5] = (bytesPerLine >> 8) & 0xFF
    out[6] = heightPx & 0xFF; out[7] = (heightPx >> 8) & 0xFF
    const px = imageData.data
    for (let y = 0; y < heightPx; y++) {
        for (let bx = 0; bx < bytesPerLine; bx++) {
            let b = 0
            for (let k = 0; k < 8; k++) {
                const x = bx * 8 + k
                if (x < widthPx) {
                    const i = (y * widthPx + x) * 4
                    if (px[i] < 160 || px[i + 1] < 160 || px[i + 2] < 160) b |= 1 << (7 - k)
                }
            }
            out[8 + y * bytesPerLine + bx] = b
        }
    }
    return out
}

function bytesToHex(bytes) {
    let hex = ''
    for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0')
    return hex
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

// In thẳng qua mạng bằng plugin native — dùng trên app Capacitor khi địa chỉ đã cấu
// hình IP máy in (xem setPrinters ở AddressContext). billRef: ref tới <PrintBill>
// đang mount sẵn trong DOM (đã có cùng props với bản in web).
// Chặn treo vô thời hạn — nghi html2canvas có thể treo (không lỗi, không xong) trên
// WebView thật dù chạy êm trên Chrome desktop. Timeout ném lỗi thay vì để spinner
// quay mãi, dù chưa chắc chắn nguyên nhân gốc.
function withTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`${label}: quá ${ms}ms, có thể bị treo`)), ms)),
    ])
}

export async function printBillNative(billRef, printerIp) {
    const canvas = await withTimeout(billRef.current?.captureImage(), 8000, 'captureImage')
    if (!canvas) throw new Error('Không tìm thấy #print-bill để chụp')
    const hex = canvasToEscPosImage(canvas)
    const { ESCPOSPlugin } = await import('@albgen/capacitor-escpos-plugin')
    await withTimeout(ESCPOSPlugin.printFormattedText({
        type: 'tcp',
        id: printerIp,
        address: printerIp,
        port: '9100',
        // action kết thúc bằng "Cut" → plugin gọi printFormattedTextAndCut thay vì
        // printFormattedText (xem ESCPOSPlugin.java) — thiếu cái này máy không tự cắt giấy.
        action: 'printAndCut',
        text: `[C]<img>${hex}</img>\n\n\n`,
    }), 8000, 'printFormattedText')
}
