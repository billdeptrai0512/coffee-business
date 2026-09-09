import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Trash2 } from 'lucide-react'
import { useProducts } from '../contexts/ProductContext'
import { useAuth } from '../contexts/AuthContext'
import { useConfirm } from '../contexts/ConfirmContext'
import { useToast } from '../hooks/useToast'
import Toast from '../components/POSPage/Toast'
import InlineEditor from '../components/RecipeIngredientPage/InlineEditor'
import DayOfWeekPicker from '../components/common/DayOfWeekPicker'
import DiscountTypePicker from '../components/common/DiscountTypePicker'
import MoneyInput from '../components/common/MoneyInput'
import ToggleSwitch from '../components/common/ToggleSwitch'
import { parseVNDInput } from '../utils'
import { clampPercentInput } from '../utils/discountPrograms'
import {
    updateDiscountProgram, deleteDiscountProgram,
    fetchDiscountProgramProductLinks, setDiscountProgramProducts,
} from '../services/discountService'

export default function DiscountProgramDetailPage() {
    const navigate = useNavigate()
    const { id: programId } = useParams()
    const { discountPrograms, products, refreshProducts } = useProducts()
    const { isManager, isAdmin } = useAuth()
    const canEdit = isManager || isAdmin
    const { toast, showToast, showError } = useToast()
    const confirm = useConfirm()

    const program = discountPrograms.find(p => p.id === programId)

    const [saving, setSaving] = useState(false)
    const [selectedProductIds, setSelectedProductIds] = useState(new Set())
    const [savedProductIds, setSavedProductIds] = useState(new Set())

    useEffect(() => {
        let cancelled = false
        async function load() {
            const links = await fetchDiscountProgramProductLinks([programId])
            if (cancelled) return
            const ids = new Set(links.map(l => l.product_id))
            setSelectedProductIds(ids)
            setSavedProductIds(ids)
        }
        load()
        return () => { cancelled = true }
    }, [programId])

    const withSaving = async (errorContext, fn) => {
        setSaving(true)
        try { await fn() } catch (err) { showError(err, errorContext) } finally { setSaving(false) }
    }

    async function saveName(name) {
        if (!name.trim()) return
        await withSaving('Lưu tên chương trình', async () => {
            await updateDiscountProgram(programId, { name: name.trim() })
            await refreshProducts()
        })
    }

    async function saveValue(type, rawValue) {
        if (rawValue <= 0) return
        await withSaving('Lưu mức giảm', async () => {
            await updateDiscountProgram(programId, { type, value: rawValue })
            await refreshProducts()
        })
    }

    async function saveSchedule(days, startDate, endDate) {
        await withSaving('Lưu lịch áp dụng', async () => {
            await updateDiscountProgram(programId, { days_of_week: days, start_date: startDate || null, end_date: endDate || null })
            await refreshProducts()
        })
    }

    async function toggleEnabled() {
        await withSaving('Bật/tắt chương trình', async () => {
            await updateDiscountProgram(programId, { enabled: !program.enabled })
            await refreshProducts()
        })
    }

    function toggleProduct(productId) {
        setSelectedProductIds(prev => {
            const next = new Set(prev)
            if (next.has(productId)) next.delete(productId)
            else next.add(productId)
            return next
        })
    }

    const linksDirty = useMemo(() => {
        if (selectedProductIds.size !== savedProductIds.size) return true
        for (const id of selectedProductIds) if (!savedProductIds.has(id)) return true
        return false
    }, [selectedProductIds, savedProductIds])

    async function saveLinks() {
        await withSaving('Lưu danh sách món áp dụng', async () => {
            await setDiscountProgramProducts(programId, [...selectedProductIds])
            setSavedProductIds(new Set(selectedProductIds))
            await refreshProducts()
            showToast('Đã lưu', 'success')
        })
    }

    async function handleDelete() {
        if (!await confirm({ title: `Xoá chương trình "${program.name}"?`, danger: true, confirmLabel: 'Xoá' })) return
        await withSaving('Xoá chương trình', async () => {
            await deleteDiscountProgram(programId)
            await refreshProducts()
            navigate('/discounts')
        })
    }

    if (!program) {
        return (
            <div className="flex flex-col h-full bg-bg items-center justify-center gap-3 px-6">
                <p className="text-text-secondary text-[13px] text-center">Không tìm thấy chương trình này (có thể đã bị xoá).</p>
                <button onClick={() => navigate('/discounts')} className="text-primary text-[13px] font-bold">Về danh sách chương trình</button>
            </div>
        )
    }

    const sellableProducts = products.filter(p => !p.is_divider)

    return (
        <div className="flex flex-col h-full bg-bg">
            <Toast toast={toast} />

            <header className="shrink-0 pt-6 pb-3 bg-surface border-b border-border/60 shadow-sm relative z-20 flex flex-col px-4 gap-3">
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => navigate('/discounts')}
                        className="w-10 h-10 flex items-center justify-center rounded-[14px] bg-surface-light border border-border/60 text-text hover:bg-border/40 active:bg-border/60 transition-colors shadow-sm focus:outline-none shrink-0"
                        title="Trở về"
                    >
                        <ArrowLeft size={20} strokeWidth={2.5} />
                    </button>

                    <div className="flex-1 bg-primary/5 border border-primary/10 shadow-sm rounded-[14px] px-2 py-2 flex flex-col items-center justify-center text-center min-w-0">
                        <InlineEditor
                            value={program.name}
                            canEdit={canEdit}
                            onSave={saveName}
                            type="text"
                            inputWidthClassName="w-full"
                            displayClassName="text-[13px] font-black text-primary uppercase line-clamp-1 break-words w-full px-2"
                            inputClassName="!text-center uppercase"
                            renderDisplay={(v) => <span title={v}>{v}</span>}
                        />
                    </div>

                    {canEdit && (
                        <button
                            onClick={handleDelete}
                            className="w-10 h-10 flex items-center justify-center rounded-[14px] border border-danger/20 text-danger hover:bg-danger/10 active:scale-95 transition-all shadow-sm focus:outline-none shrink-0"
                            title="Xoá chương trình"
                        >
                            <Trash2 size={20} strokeWidth={2.5} />
                        </button>
                    )}
                </div>
            </header>

            <main className="flex-1 overflow-y-auto px-4 py-4 space-y-4 bg-bg">
                <section className="bg-surface border border-border/60 rounded-[16px] p-4 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                        <p className="text-text text-sm font-black">Bật chương trình</p>
                        <p className="text-text-secondary text-[11px] leading-tight">
                            {program.enabled ? 'Đang tự động áp giá đúng lịch bên dưới' : 'Đang tắt — không áp giá dù đúng lịch'}
                        </p>
                    </div>
                    <ToggleSwitch checked={program.enabled} onChange={toggleEnabled} disabled={!canEdit || saving} />
                </section>

                <ValueSection key={program.id} program={program} canEdit={canEdit} saving={saving} onSave={saveValue} />

                <ScheduleSection key={program.id} program={program} canEdit={canEdit} saving={saving} onSave={saveSchedule} />

                <section className="pt-4 border-t border-border/40">
                    <div className="flex items-center justify-between mb-3">
                        <span className="text-[13px] font-black text-text uppercase tracking-wide">Áp dụng cho món</span>
                        {selectedProductIds.size > 0 && (
                            <span className="text-[10px] text-primary font-bold bg-primary/10 px-1.5 py-0.5 rounded">
                                Đã chọn {selectedProductIds.size}
                            </span>
                        )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                        {sellableProducts.map(p => {
                            const isSelected = selectedProductIds.has(p.id)
                            return (
                                <button
                                    key={p.id}
                                    disabled={!canEdit}
                                    onClick={() => toggleProduct(p.id)}
                                    className={`text-[12px] border px-2.5 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-60 ${isSelected
                                        ? 'bg-primary text-bg border-primary shadow-sm'
                                        : 'bg-primary/10 text-primary border-primary/20 hover:bg-primary/20 active:bg-primary/30'
                                        }`}
                                >
                                    {isSelected ? '✓ ' : '+ '}{p.name}
                                </button>
                            )
                        })}
                    </div>
                    {canEdit && linksDirty && (
                        <button
                            onClick={saveLinks}
                            disabled={saving}
                            className="w-full mt-3 py-2.5 rounded-[12px] bg-primary text-bg text-[13px] font-black hover:bg-primary/90 active:bg-primary/80 transition-colors disabled:opacity-50 uppercase"
                        >
                            Lưu danh sách món
                        </button>
                    )}
                </section>
            </main>
        </div>
    )
}

// Mức giảm: type/value cục bộ tách khỏi form cha vì có nút Lưu riêng — cha truyền
// key={program.id} nên state seed lại đúng (lazy initializer) mỗi khi đổi chương trình,
// khỏi cần effect đồng bộ riêng (cùng lý do DiscountEditor.jsx không cần effect đó).
function ValueSection({ program, canEdit, saving, onSave }) {
    const [type, setType] = useState(program.type)
    const [valueInput, setValueInput] = useState(String(program.value))

    const rawValue = type === 'percent' ? Math.min(parseInt(valueInput, 10) || 0, 100) : parseVNDInput(valueInput)
    const dirty = type !== program.type || rawValue !== program.value

    return (
        <section>
            <span className="block text-[13px] font-black text-text uppercase tracking-wide mb-3">Mức giảm</span>
            <div className="mb-2">
                <DiscountTypePicker value={type} onChange={t => { setType(t); setValueInput('') }} disabled={!canEdit} />
            </div>
            {type === 'percent' ? (
                <input
                    type="text"
                    inputMode="numeric"
                    disabled={!canEdit}
                    value={valueInput}
                    onChange={e => setValueInput(clampPercentInput(e.target.value))}
                    className="w-full bg-surface-light border border-border/60 rounded-[12px] px-3 py-2.5 text-[14px] font-bold text-text text-right tabular-nums focus:outline-none focus:border-primary/40 transition-colors disabled:opacity-60"
                />
            ) : (
                <MoneyInput value={valueInput} onChange={setValueInput} disabled={!canEdit} />
            )}
            {canEdit && dirty && rawValue > 0 && (
                <button
                    onClick={() => onSave(type, rawValue)}
                    disabled={saving}
                    className="w-full mt-2 py-2.5 rounded-[12px] bg-primary text-bg text-[13px] font-black hover:bg-primary/90 active:bg-primary/80 transition-colors disabled:opacity-50 uppercase"
                >
                    Lưu mức giảm
                </button>
            )}
        </section>
    )
}

// Lịch áp dụng: 2 bộ lọc độc lập — thứ trong tuần (rỗng = mọi thứ) và khoảng ngày (để trống =
// không giới hạn phía đó). State cục bộ tách khỏi form cha cùng lý do như ValueSection ở trên.
function ScheduleSection({ program, canEdit, saving, onSave }) {
    const [days, setDays] = useState(program.days_of_week)
    const [startDate, setStartDate] = useState(program.start_date || '')
    const [endDate, setEndDate] = useState(program.end_date || '')

    const dirty = days.join(',') !== program.days_of_week.join(',')
        || startDate !== (program.start_date || '') || endDate !== (program.end_date || '')

    return (
        <section className="pt-4 border-t border-border/40">
            <span className="block text-[13px] font-black text-text uppercase tracking-wide mb-1">Lịch áp dụng</span>
            <p className="text-[11px] text-text-secondary mb-3">Không chọn thứ nào = áp dụng mọi ngày. Để trống ngày = không giới hạn.</p>

            <DayOfWeekPicker value={days} onChange={setDays} disabled={!canEdit} />

            <div className="flex gap-2 mt-3">
                <div className="flex-1">
                    <span className="block text-[11px] font-bold text-text-secondary mb-1">Từ ngày</span>
                    <input
                        type="date"
                        disabled={!canEdit}
                        value={startDate}
                        onChange={e => setStartDate(e.target.value)}
                        className="w-full bg-surface-light border border-border/60 rounded-[12px] px-3 py-2 text-[13px] font-medium text-text focus:outline-none focus:border-primary/40 transition-colors disabled:opacity-60"
                    />
                </div>
                <div className="flex-1">
                    <span className="block text-[11px] font-bold text-text-secondary mb-1">Đến ngày</span>
                    <input
                        type="date"
                        disabled={!canEdit}
                        value={endDate}
                        onChange={e => setEndDate(e.target.value)}
                        className="w-full bg-surface-light border border-border/60 rounded-[12px] px-3 py-2 text-[13px] font-medium text-text focus:outline-none focus:border-primary/40 transition-colors disabled:opacity-60"
                    />
                </div>
            </div>

            {canEdit && dirty && (
                <button
                    onClick={() => onSave(days, startDate, endDate)}
                    disabled={saving}
                    className="w-full mt-3 py-2.5 rounded-[12px] bg-primary text-bg text-[13px] font-black hover:bg-primary/90 active:bg-primary/80 transition-colors disabled:opacity-50 uppercase"
                >
                    Lưu lịch áp dụng
                </button>
            )}
        </section>
    )
}
