import { useRef, useState } from 'react'
import { Pencil, X, Loader } from 'lucide-react'
import { Dialog } from '../common/ModalShell'

// Modal đổi tên — "Hủy" quay lại modal thao tác (onCancel, chỉ đóng modal này),
// X/tap-outside mới thoát hẳn (onClose, đóng cả modal thao tác phía sau).
export default function RenameAddressModal({ addr, onRename, onCancel, onClose, onSuccess, setError }) {
    const [editName, setEditName] = useState(addr.name)
    const [renaming, setRenaming] = useState(false)
    const submitGuardRef = useRef(false)

    async function handleSubmit(e) {
        e.preventDefault()
        if (!editName.trim()) return
        if (submitGuardRef.current) return
        submitGuardRef.current = true
        setRenaming(true)
        setError('')
        try {
            await onRename(addr.id, editName.trim())
            onSuccess()
        } catch (err) {
            setError(err.message || 'Không thể đổi tên')
        } finally {
            setRenaming(false)
            submitGuardRef.current = false
        }
    }

    return (
        <Dialog
            onClose={() => { if (!renaming) onClose() }}
            panelClassName="w-full max-w-sm mx-4 bg-surface border border-border/60 rounded-[24px] shadow-2xl overflow-hidden"
        >
            <form onSubmit={handleSubmit}>
                <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border/40">
                    <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-[10px] bg-primary/10 flex items-center justify-center">
                            <Pencil size={15} className="text-primary" />
                        </div>
                        <p className="text-text font-black text-sm leading-none">Đổi tên địa chỉ</p>
                    </div>
                    {!renaming && (
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
                    <input
                        type="text"
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        disabled={renaming}
                        className="w-full px-4 py-3 rounded-[12px] bg-bg border border-border/60 text-text text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary disabled:opacity-50"
                        autoFocus
                    />
                    <div className="flex gap-2">
                        <button
                            type="button"
                            disabled={renaming}
                            onClick={onCancel}
                            className="flex-1 py-3 rounded-[14px] bg-bg border border-border/60 text-text-secondary font-bold text-sm hover:bg-surface-light transition-colors disabled:opacity-50"
                        >
                            Hủy
                        </button>
                        <button
                            type="submit"
                            disabled={renaming || !editName.trim()}
                            className="flex-1 py-3 rounded-[14px] bg-primary text-black font-black text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                            {renaming ? <Loader size={14} className="animate-spin" /> : 'Lưu'}
                        </button>
                    </div>
                </div>
            </form>
        </Dialog>
    )
}
