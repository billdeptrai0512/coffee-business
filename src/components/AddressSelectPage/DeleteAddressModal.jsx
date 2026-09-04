import { useState } from 'react'
import { Trash2, X, Loader } from 'lucide-react'
import { Dialog } from '../common/ModalShell'

// Modal xoá địa chỉ — bắt gõ lại tên như modal xoá dữ liệu bán hàng, vì đây cũng là
// hard-delete không thể hoàn tác. "Hủy" quay lại modal thao tác (onCancel),
// X/tap-outside mới thoát hẳn (onClose).
export default function DeleteAddressModal({ addr, addresses, onRemove, onCancel, onClose, onSuccess, error, setError }) {
    const [deleteConfirmName, setDeleteConfirmName] = useState('')
    const [deleting, setDeleting] = useState(false)

    async function handleRemoveAddress() {
        if (deleteConfirmName.trim().toUpperCase() !== addr.name.toUpperCase() || deleting) return
        setDeleting(true)
        setError('')
        try {
            await onRemove(addr.id)
            onSuccess()
        } catch (err) {
            setError(err.message || 'Không thể xóa địa chỉ')
        } finally {
            setDeleting(false)
        }
    }

    return (
        <Dialog
            onClose={() => { if (!deleting) onClose() }}
            panelClassName="w-full max-w-sm mx-4 bg-surface border border-border/60 rounded-[24px] shadow-2xl overflow-hidden"
        >
            <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border/40">
                <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-[10px] bg-danger/10 flex items-center justify-center">
                        <Trash2 size={15} className="text-danger" />
                    </div>
                    <p className="text-text font-black text-sm leading-none">Xóa địa chỉ</p>
                </div>
                {!deleting && (
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
                    Xoá toàn bộ dữ liệu của <span className="font-bold text-text">{addr.name}</span> — menu, công thức, nguyên liệu, đơn hàng, chi phí, gói đăng ký. <span className="text-danger font-bold">Không thể hoàn tác.</span>
                </p>
                {addr.warehouse_group_id && addresses.some(a => a.id !== addr.id && a.warehouse_group_id === addr.warehouse_group_id) && (
                    <p className="text-warning text-xs font-bold leading-relaxed -mt-1">
                        {addr.name} đang dùng chung kho tổng với địa chỉ khác — xoá sẽ làm mất phần đóng góp của {addr.name} trong số tồn kho tổng của các địa chỉ đó.
                    </p>
                )}
                <div>
                    <label className="block text-xs font-bold text-text-secondary uppercase tracking-wider mb-1.5">Gõ lại tên địa chỉ để xác nhận</label>
                    <input
                        type="text"
                        value={deleteConfirmName}
                        onChange={e => setDeleteConfirmName(e.target.value)}
                        disabled={deleting}
                        placeholder={addr.name}
                        className="w-full px-4 py-3 rounded-[12px] bg-bg border border-border/60 text-text text-sm font-medium focus:outline-none focus:ring-2 focus:ring-danger/40 focus:border-danger disabled:opacity-50"
                        autoFocus
                    />
                </div>
                {error && (
                    <p className="text-danger text-xs font-medium -mt-2">{error}</p>
                )}
                <div className="flex gap-2">
                    <button
                        type="button"
                        disabled={deleting}
                        onClick={onCancel}
                        className="flex-1 py-3 rounded-[14px] bg-bg border border-border/60 text-text-secondary font-bold text-sm hover:bg-surface-light transition-colors disabled:opacity-50"
                    >
                        Hủy
                    </button>
                    <button
                        type="button"
                        disabled={deleting || deleteConfirmName.trim().toUpperCase() !== addr.name.toUpperCase()}
                        onClick={handleRemoveAddress}
                        className="flex-1 py-3 rounded-[14px] bg-danger text-white font-black text-sm hover:bg-danger/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                        {deleting ? <Loader size={14} className="animate-spin" /> : 'Xóa vĩnh viễn'}
                    </button>
                </div>
            </div>
        </Dialog>
    )
}
