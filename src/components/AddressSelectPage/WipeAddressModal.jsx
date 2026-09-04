import { useState } from 'react'
import { Eraser, X, Loader } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { Dialog } from '../common/ModalShell'

// Modal xoá dữ liệu bán hàng (Admin) — bắt gõ lại tên địa chỉ vì đây là hard-delete
// không thể hoàn tác (orders/expenses/shift_closings), không đụng config/menu.
// "Hủy" quay lại modal thao tác (onCancel), X/tap-outside mới thoát hẳn (onClose).
export default function WipeAddressModal({ addr, onCancel, onClose, error, setError }) {
    const [wipeConfirmName, setWipeConfirmName] = useState('')
    const [wiping, setWiping] = useState(false)

    async function handleWipeSalesData() {
        if (wipeConfirmName.trim().toUpperCase() !== addr.name.toUpperCase() || wiping) return
        setWiping(true)
        setError('')
        try {
            const { error: rpcError } = await supabase.rpc('admin_wipe_address_sales_data', { p_address_id: addr.id })
            if (rpcError) throw rpcError
            window.location.reload() // đơn giản nhất để làm mới cupsMap/revenueMap sau khi xoá
        } catch (err) {
            setError(err.message || 'Không thể xoá dữ liệu bán hàng')
            setWiping(false)
        }
    }

    return (
        <Dialog
            onClose={() => { if (!wiping) onClose() }}
            panelClassName="w-full max-w-sm mx-4 bg-surface border border-border/60 rounded-[24px] shadow-2xl overflow-hidden"
        >
            <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border/40">
                <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-[10px] bg-danger/10 flex items-center justify-center">
                        <Eraser size={15} className="text-danger" />
                    </div>
                    <p className="text-text font-black text-sm leading-none">Xoá dữ liệu bán hàng</p>
                </div>
                {!wiping && (
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
                <p className="text-text-secondary text-xs leading-relaxed">
                    Xoá toàn bộ đơn hàng, chi phí, phiếu chốt ca của <span className="font-bold text-text">{addr.name}</span>. Menu, công thức, nguyên liệu, gói đăng ký được giữ nguyên. <span className="text-danger font-bold">Không thể hoàn tác.</span>
                </p>
                <div>
                    <label className="block text-xs font-bold text-text-secondary uppercase tracking-wider mb-1.5">Gõ lại tên địa chỉ để xác nhận</label>
                    <input
                        type="text"
                        value={wipeConfirmName}
                        onChange={e => setWipeConfirmName(e.target.value)}
                        disabled={wiping}
                        placeholder={addr.name}
                        className="w-full px-4 py-3 rounded-[12px] bg-bg border border-border/60 text-text text-sm font-medium focus:outline-none focus:ring-2 focus:ring-danger/40 focus:border-danger disabled:opacity-50"
                        autoFocus
                    />
                </div>
                {/* Modal là overlay z-50 toàn màn hình nên ErrorBanner cuối trang bị che khuất —
                    lỗi RPC phải hiện ngay trong modal, không thì admin không biết vì sao thất bại. */}
                {error && (
                    <p className="text-danger text-xs font-medium -mt-2">{error}</p>
                )}
                <div className="flex gap-2">
                    <button
                        type="button"
                        disabled={wiping}
                        onClick={onCancel}
                        className="flex-1 py-3 rounded-[14px] bg-bg border border-border/60 text-text-secondary font-bold text-sm hover:bg-surface-light transition-colors disabled:opacity-50"
                    >
                        Hủy
                    </button>
                    <button
                        type="button"
                        disabled={wiping || wipeConfirmName.trim().toUpperCase() !== addr.name.toUpperCase()}
                        onClick={handleWipeSalesData}
                        className="flex-1 py-3 rounded-[14px] bg-danger text-white font-black text-sm hover:bg-danger/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                        {wiping ? <Loader size={14} className="animate-spin" /> : 'Xoá vĩnh viễn'}
                    </button>
                </div>
            </div>
        </Dialog>
    )
}
