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
import DayOfWeekPicker from '../components/common/DayOfWeekPicker'
import ToggleSwitch from '../components/common/ToggleSwitch'
import { formatVND, parseVNDInput } from '../utils'
import { insertDiscountProgram } from '../services/discountService'
import { clampPercentInput } from '../utils/discountPrograms'

const initialForm = { name: '', type: 'fixed', value: '', days: [], startDate: '', endDate: '', enabled: false }

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
    const [form, setForm] = useState(initialForm)
    const [saving, setSaving] = useState(false)

    const rawValue = form.type === 'percent' ? Math.min(parseInt(form.value, 10) || 0, 100) : parseVNDInput(form.value)
    const canSubmit = form.name.trim() && rawValue > 0 && selectedAddress?.id && !saving

    function setField(patch) {
        setForm(f => ({ ...f, ...patch }))
    }

    function resetForm() {
        setForm(initialForm)
        setShowCreate(false)
    }

    async function handleCreate() {
        if (!canSubmit) return
        setSaving(true)
        try {
            await insertDiscountProgram({
                name: form.name.trim(), type: form.type, value: rawValue, address_id: selectedAddress.id,
                days_of_week: form.days, start_date: form.startDate || null, end_date: form.endDate || null, enabled: form.enabled,
            })
            await refreshProducts()
            resetForm()
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
                            value={form.name}
                            onChange={e => setField({ name: e.target.value })}
                            className="bg-surface-light border border-border/60 rounded-[12px] px-3 py-2.5 text-[14px] font-medium text-text placeholder:text-text-secondary/50 focus:outline-none focus:border-primary/40 transition-colors"
                        />
                        <DiscountTypePicker value={form.type} onChange={t => setField({ type: t, value: '' })} />
                        {form.type === 'percent' ? (
                            <input
                                type="text"
                                inputMode="numeric"
                                placeholder="% giảm (VD: 20)"
                                value={form.value}
                                onChange={e => setField({ value: clampPercentInput(e.target.value) })}
                                className="bg-surface-light border border-border/60 rounded-[12px] px-3 py-2.5 text-[14px] font-bold text-text text-right tabular-nums placeholder:text-text-secondary/50 placeholder:font-normal focus:outline-none focus:border-primary/40 transition-colors"
                            />
                        ) : (
                            <MoneyInput
                                value={form.value}
                                onChange={v => setField({ value: v })}
                                onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
                                placeholder={form.type === 'fixed' ? 'Giá bán mới' : 'Số tiền giảm'}
                            />
                        )}

                        <div className="pt-2 border-t border-border/40">
                            <span className="block text-[11px] font-black text-text-secondary uppercase tracking-wide mb-1">Lịch áp dụng</span>
                            <p className="text-[11px] text-text-secondary mb-2">Không chọn thứ nào = mọi ngày. Để trống ngày = không giới hạn.</p>
                            <DayOfWeekPicker value={form.days} onChange={days => setField({ days })} />
                            <div className="flex gap-2 mt-2">
                                <div className="flex-1">
                                    <span className="block text-[11px] font-bold text-text-secondary mb-1">Từ ngày</span>
                                    <input
                                        type="date"
                                        value={form.startDate}
                                        onChange={e => setField({ startDate: e.target.value })}
                                        className="w-full bg-surface-light border border-border/60 rounded-[12px] px-3 py-2 text-[13px] font-medium text-text focus:outline-none focus:border-primary/40 transition-colors"
                                    />
                                </div>
                                <div className="flex-1">
                                    <span className="block text-[11px] font-bold text-text-secondary mb-1">Đến ngày</span>
                                    <input
                                        type="date"
                                        value={form.endDate}
                                        onChange={e => setField({ endDate: e.target.value })}
                                        className="w-full bg-surface-light border border-border/60 rounded-[12px] px-3 py-2 text-[13px] font-medium text-text focus:outline-none focus:border-primary/40 transition-colors"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center justify-between pt-2 border-t border-border/40">
                            <div className="min-w-0">
                                <p className="text-text text-[13px] font-black">Bật chương trình</p>
                                <p className="text-text-secondary text-[11px] leading-tight">Có thể để tắt rồi bật sau khi kiểm tra lại lịch</p>
                            </div>
                            <ToggleSwitch checked={form.enabled} onChange={enabled => setField({ enabled })} />
                        </div>

                        <div className="flex gap-2">
                            <button
                                onClick={handleCreate}
                                disabled={!canSubmit}
                                className="flex-1 py-3 rounded-[12px] bg-primary text-bg text-[14px] font-black hover:bg-primary/90 active:bg-primary/80 transition-colors disabled:opacity-50 uppercase"
                            >
                                {saving ? 'Đang...' : 'Tạo'}
                            </button>
                            <button
                                onClick={resetForm}
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
