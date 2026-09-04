import { useRef, useState } from 'react'
import { Printer, X, Loader } from 'lucide-react'
import { Dialog } from '../common/ModalShell'

// Modal cấu hình IP máy in — chỉ có tác dụng trên app native (Capacitor), web vẫn
// window.print() bất kể có nhập gì ở đây. Xem escposBitmap.js.
export default function PrinterIpModal({ addr, onSetPrinters, onCancel, onClose, onSuccess, setError }) {
    const [printerForm, setPrinterForm] = useState({
        counterPrinterIp: addr.counter_printer_ip || '',
        kitchenPrinterIp: addr.kitchen_printer_ip || '',
    })
    const [savingPrinters, setSavingPrinters] = useState(false)
    const submitGuardRef = useRef(false)

    async function handleSubmit(e) {
        e.preventDefault()
        if (submitGuardRef.current) return
        submitGuardRef.current = true
        setSavingPrinters(true)
        setError('')
        try {
            await onSetPrinters(addr.id, printerForm)
            onSuccess()
        } catch (err) {
            setError(err.message || 'Không thể lưu IP máy in')
        } finally {
            setSavingPrinters(false)
            submitGuardRef.current = false
        }
    }

    return (
        <Dialog
            onClose={() => { if (!savingPrinters) onClose() }}
            panelClassName="w-full max-w-sm mx-4 bg-surface border border-border/60 rounded-[24px] shadow-2xl overflow-hidden"
        >
            <form onSubmit={handleSubmit}>
                <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border/40">
                    <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-[10px] bg-primary/10 flex items-center justify-center">
                            <Printer size={15} className="text-primary" />
                        </div>
                        <p className="text-text font-black text-sm leading-none">IP máy in (app native)</p>
                    </div>
                    {!savingPrinters && (
                        <button
                            type="button"
                            onClick={onClose}
                            className="p-1.5 text-text-secondary hover:text-text transition-colors rounded-lg hover:bg-surface-light"
                        >
                            <X size={16} />
                        </button>
                    )}
                </div>
                <div className="p-5 flex flex-col gap-4">
                    <p className="text-text-secondary text-xs font-medium -mt-1">
                        Để trống nếu chưa có máy in — app sẽ dùng hộp in của trình duyệt như bình thường.
                    </p>
                    <div className="flex flex-col gap-1.5">
                        <label className="text-text-secondary text-xs font-bold uppercase tracking-wide">Máy in quầy (Tính tiền)</label>
                        <input
                            type="text"
                            inputMode="decimal"
                            placeholder="192.168.1.100"
                            value={printerForm.counterPrinterIp}
                            onChange={e => setPrinterForm(f => ({ ...f, counterPrinterIp: e.target.value }))}
                            disabled={savingPrinters}
                            className="w-full px-4 py-3 rounded-[12px] bg-bg border border-border/60 text-text text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary disabled:opacity-50"
                            autoFocus
                        />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <label className="text-text-secondary text-xs font-bold uppercase tracking-wide">Máy in bếp (Tạo đơn)</label>
                        <input
                            type="text"
                            inputMode="decimal"
                            placeholder="192.168.1.101"
                            value={printerForm.kitchenPrinterIp}
                            onChange={e => setPrinterForm(f => ({ ...f, kitchenPrinterIp: e.target.value }))}
                            disabled={savingPrinters}
                            className="w-full px-4 py-3 rounded-[12px] bg-bg border border-border/60 text-text text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary disabled:opacity-50"
                        />
                    </div>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            disabled={savingPrinters}
                            onClick={onCancel}
                            className="flex-1 py-3 rounded-[14px] bg-bg border border-border/60 text-text-secondary font-bold text-sm hover:bg-surface-light transition-colors disabled:opacity-50"
                        >
                            Hủy
                        </button>
                        <button
                            type="submit"
                            disabled={savingPrinters}
                            className="flex-1 py-3 rounded-[14px] bg-primary text-black font-black text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                            {savingPrinters ? <Loader size={14} className="animate-spin" /> : 'Lưu'}
                        </button>
                    </div>
                </div>
            </form>
        </Dialog>
    )
}
