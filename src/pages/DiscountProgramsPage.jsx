import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useProducts } from '../contexts/ProductContext'
import { useAddress } from '../contexts/AddressContext'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../hooks/useToast'
import Toast from '../components/POSPage/Toast'
import IngredientDetailHeader from '../components/IngredientManagementPage/IngredientDetailHeader'
import MoneyInput from '../components/common/MoneyInput'
import DiscountTypePicker from '../components/common/DiscountTypePicker'
import { formatVND, parseVNDInput } from '../utils'
import { insertDiscountProgram } from '../services/discountService'
import { clampPercentInput } from '../utils/discountPrograms'

function programSummary(p) {
    if (p.type === 'fixed') return `Đồng giá ${formatVND(p.value)}`
    if (p.type === 'percent') return `Giảm ${p.value}%`
    return `Giảm ${formatVND(p.value)}`
}

export default function DiscountProgramsPage() {
    const navigate = useNavigate()
    const location = useLocation()
    const { discountPrograms, refreshProducts } = useProducts()
    const { selectedAddress } = useAddress()
    const { isManager, isAdmin } = useAuth()
    const canEdit = isManager || isAdmin
    const { toast, showToast, showError } = useToast()

    const [showCreate, setShowCreate] = useState(false)
    const [name, setName] = useState('')
    const [type, setType] = useState('fixed')
    const [value, setValue] = useState('')
    const [saving, setSaving] = useState(false)

    const rawValue = type === 'percent' ? Math.min(parseInt(value, 10) || 0, 100) : parseVNDInput(value)
    const canSubmit = name.trim() && rawValue > 0 && selectedAddress?.id && !saving

    async function handleCreate() {
        if (!canSubmit) return
        setSaving(true)
        try {
            await insertDiscountProgram(name.trim(), type, rawValue, selectedAddress.id)
            await refreshProducts()
            setName(''); setValue(''); setType('fixed'); setShowCreate(false)
            showToast('Đã tạo chương trình', 'success')
        } catch (err) {
            showError(err, 'Tạo chương trình giảm giá')
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="flex flex-col h-full bg-bg">
            <Toast toast={toast} />

            <IngredientDetailHeader
                title="Giảm giá"
                subtitle={`${discountPrograms.length} chương trình`}
                onBack={() => navigate('/recipes', { state: location.state })}
            />

            <main className="flex-1 overflow-y-auto px-4 py-4 pb-8 space-y-3">
                {!selectedAddress?.id && (
                    <p className="text-warning text-[13px] text-center py-4 bg-warning-soft rounded-[16px] border border-warning/20">
                        Chọn 1 địa chỉ cụ thể trước khi tạo chương trình giảm giá.
                    </p>
                )}

                {discountPrograms.length === 0 && !showCreate && (
                    <p className="text-text-secondary text-[13px] text-center py-8 bg-surface-light/50 rounded-[16px] border border-border/40">
                        Chưa có chương trình nào (VD: Đồng giá 10k thứ Hai...)
                    </p>
                )}

                {discountPrograms.map(p => (
                    <div
                        key={p.id}
                        onClick={() => navigate(`/discounts/${p.id}`)}
                        className="bg-surface border border-border/60 rounded-[16px] p-4 flex items-center justify-between gap-2 cursor-pointer transition-all shadow-sm hover:border-text/30 hover:shadow-md active:scale-[0.98]"
                    >
                        <div className="min-w-0">
                            <h3 className="font-black text-[15px] text-text truncate">{p.name}</h3>
                            <span className="text-[12px] text-text-secondary">{programSummary(p)}</span>
                        </div>
                        <span className={`text-[11px] font-black uppercase shrink-0 px-2 py-1 rounded-full ${p.enabled ? 'bg-success/10 text-success' : 'bg-border/40 text-text-secondary'}`}>
                            {p.enabled ? 'Đang bật' : 'Đang tắt'}
                        </span>
                    </div>
                ))}

                {canEdit && selectedAddress?.id && (showCreate ? (
                    <div className="bg-surface border border-border/60 rounded-[16px] p-4 flex flex-col gap-3">
                        <input
                            type="text"
                            placeholder="Tên chương trình (VD: Đồng giá thứ Hai)"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            className="bg-surface-light border border-border/60 rounded-[12px] px-3 py-2.5 text-[14px] font-medium text-text placeholder:text-text-secondary/50 focus:outline-none focus:border-primary/40 transition-colors"
                        />
                        <DiscountTypePicker value={type} onChange={t => { setType(t); setValue('') }} />
                        {type === 'percent' ? (
                            <input
                                type="text"
                                inputMode="numeric"
                                placeholder="% giảm (VD: 20)"
                                value={value}
                                onChange={e => setValue(clampPercentInput(e.target.value))}
                                className="bg-surface-light border border-border/60 rounded-[12px] px-3 py-2.5 text-[14px] font-bold text-text text-right tabular-nums placeholder:text-text-secondary/50 placeholder:font-normal focus:outline-none focus:border-primary/40 transition-colors"
                            />
                        ) : (
                            <MoneyInput
                                value={value}
                                onChange={setValue}
                                onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
                                placeholder={type === 'fixed' ? 'Giá bán mới' : 'Số tiền giảm'}
                            />
                        )}
                        <div className="flex gap-2">
                            <button
                                onClick={handleCreate}
                                disabled={!canSubmit}
                                className="flex-1 py-3 rounded-[12px] bg-primary text-bg text-[14px] font-black hover:bg-primary/90 active:bg-primary/80 transition-colors disabled:opacity-50 uppercase"
                            >
                                {saving ? 'Đang...' : 'Tạo'}
                            </button>
                            <button
                                onClick={() => { setShowCreate(false); setName(''); setValue(''); setType('fixed') }}
                                className="px-4 py-3 rounded-[12px] bg-surface-light border border-border/60 text-text text-[14px] font-bold"
                            >
                                Hủy
                            </button>
                        </div>
                    </div>
                ) : (
                    <button
                        onClick={() => setShowCreate(true)}
                        className="w-full text-[13px] text-primary/70 hover:text-primary font-medium transition-colors bg-surface border border-border/60 rounded-[16px] px-4 py-4 text-center"
                    >
                        + Tạo chương trình mới
                    </button>
                ))}
            </main>
        </div>
    )
}
