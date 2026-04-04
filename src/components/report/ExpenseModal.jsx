import { useState } from 'react'
import { MinusCircle } from 'lucide-react'
import { formatVND } from '../../utils'

export default function ExpenseModal({ todayExpenses, onClose, onAddExpense, onDeleteExpense }) {
    const [costName, setCostName] = useState('')
    const [costAmount, setCostAmount] = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [deletingId, setDeletingId] = useState(null)

    const submitExpense = async () => {
        if (!costName.trim() || !costAmount || isNaN(costAmount) || Number(costAmount) <= 0) return
        setIsSubmitting(true)
        try {
            await onAddExpense(costName.trim(), Number(costAmount))
            setCostName('')
            setCostAmount('')
        } catch (err) {
            console.error(err)
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 sm:p-4 animate-fade-in backdrop-blur-sm">
            <div className="bg-bg w-full h-[85dvh] sm:h-[80dvh] sm:max-h-[600px] sm:max-w-md rounded-t-[24px] sm:rounded-[24px] shadow-lg animate-slide-up sm:animate-scale-up flex flex-col border-t sm:border border-border/40 overflow-hidden">
                <div className="flex items-center justify-between p-4 border-b border-border/60 bg-surface">
                    <div className="flex items-center gap-2">
                        <MinusCircle className="text-danger" size={20} />
                        <h3 className="text-[15px] font-black text-danger uppercase">Quản Lý Chi Phí</h3>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-[14px] font-bold text-text-secondary hover:text-text transition-colors p-1"
                    >
                        Đóng
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {(!todayExpenses || todayExpenses.length === 0) ? (
                        <div className="text-center text-text-secondary text-[13px] py-10 bg-surface-light rounded-xl border border-border/40">
                            Chưa có chi phí nào phát sinh hôm nay.
                        </div>
                    ) : (
                        [...todayExpenses].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).map(expense => {
                            const time = `${new Date(expense.created_at).getHours().toString().padStart(2, '0')}:${new Date(expense.created_at).getMinutes().toString().padStart(2, '0')}`
                            return (
                                <div key={expense.id} className="bg-surface border border-border/60 rounded-[20px] p-4 shadow-sm flex flex-col gap-2 relative overflow-hidden opacity-90">
                                    <div className="absolute top-0 right-0 bg-danger/10 text-danger text-[10px] font-black px-2 py-1 rounded-bl-[14px] uppercase tracking-wider">
                                        Chi phí
                                    </div>
                                    <div className="flex justify-between items-center mb-1">
                                        <div className="flex items-center gap-2 mt-1">
                                            <span className="font-black text-[14px] text-danger">- {formatVND(expense.amount)}</span>
                                        </div>
                                    </div>
                                    <div className="flex justify-between items-stretch mb-1 border-t border-border/40 pt-2">
                                        <div className="flex flex-col flex-1 gap-1.5 mt-0.5 mr-2">
                                            <span className="text-[14px] leading-snug font-medium max-w-[85%] whitespace-pre-wrap text-text">{expense.name}</span>
                                        </div>
                                        <div className="flex flex-col justify-end items-end gap-2 shrink-0 mt-0.5">
                                            <span
                                                className="text-text-secondary text-[14px] text-end font-bold cursor-pointer underline decoration-dashed decoration-text-secondary/50 underline-offset-4 hover:text-danger hover:decoration-danger active:text-danger/80 transition-all select-none disabled:opacity-40"
                                                onClick={() => {
                                                    if (deletingId === expense.id) return
                                                    if (window.confirm(`Xóa chi phí ${expense.name}?\n\nHành động này không thể hoàn tác!`)) {
                                                        setDeletingId(expense.id)
                                                        onDeleteExpense(expense.id, expense.amount).finally(() => setDeletingId(null))
                                                    }
                                                }}
                                            >
                                                {deletingId === expense.id ? '⏳' : time}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            )
                        })
                    )}
                </div>

                <div className="p-4 bg-surface border-t border-border/60 flex flex-col gap-3">
                    <div className="flex gap-2">
                        <input
                            type="text"
                            placeholder="Tên chi phí (VD: Nước đá)"
                            value={costName}
                            onChange={e => setCostName(e.target.value)}
                            className="flex-1 min-w-0 bg-surface-light border border-border/60 rounded-[12px] px-3 py-2 text-[14px] font-medium text-text placeholder:text-text-secondary/50 focus:outline-none focus:border-danger/40 transition-colors"
                        />
                        <input
                            type="number"
                            placeholder="Số tiền..."
                            value={costAmount}
                            onChange={e => setCostAmount(e.target.value)}
                            className="w-[110px] shrink-0 bg-surface-light border border-border/60 rounded-[12px] px-3 py-2 text-[14px] font-medium text-text placeholder:text-text-secondary/50 focus:outline-none focus:border-danger/40 transition-colors"
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') submitExpense()
                            }}
                        />
                    </div>
                    <button
                        onClick={submitExpense}
                        disabled={!costName.trim() || !costAmount || isNaN(costAmount) || Number(costAmount) <= 0 || isSubmitting}
                        className="w-full py-3 rounded-[12px] bg-danger text-white text-[14px] font-black hover:bg-danger/90 active:bg-danger/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isSubmitting ? 'Đang thêm...' : '+ Thêm chi phí'}
                    </button>
                </div>
            </div>
        </div>
    )
}
