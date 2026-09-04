import { useRef, useState, useCallback } from 'react'
import { X, Check, ChevronDown, Settings2 } from 'lucide-react'
import MoneyInput from '../common/MoneyInput'
import DatePicker from '../common/DatePicker'
import ChangeCategorySheet from './ChangeCategorySheet'
import { formatIsoDisplay } from '../common/datePickerUtils'
import { parseVNDInput } from '../../utils'
import { dateStringVN } from '../../utils/dateVN'
import { EXPENSE_GROUPS, groupMeta, labelsInGroup } from '../../constants/expenseGroups'
import { BottomSheet } from '../common/ModalShell'
import { useClickOutside } from '../../hooks/useClickOutside'

// Create flow: pick label → name → amount → (date) → submit. Payment defaults to
// cash on insert; user toggles it on the expense card (ExpensePanel) after the row
// appears. Ngày chi defaults to today; pick a past day to backdate the expense.
export default function AddExpenseModal({
    isEditing = false,
    onDelete,
    expenseCategory, costName, costAmount, isSubmitting,
    isAfterShift, onAfterShiftChange,
    // Tag picker
    expenseCategories = [],
    selectedCategoryId,
    onCategoryIdChange,
    onCreateCategory,
    onUpdateCategory,
    onDeleteCategory,
    onListCategoryExpenses,
    onMoveExpense,
    onCountCategories,
    onRestoreCategory,
    showToast,
    // Date (backdate support)
    expenseDate, onDateChange,
    // Payment method toggle
    paymentMethod = 'cash', onPaymentMethodChange,
    //
    onClose, onSubmit,
    onCategoryChange, onNameChange, onAmountChange,
}) {
    const canSubmit = parseVNDInput(costAmount) > 0 && costName.trim() && !isSubmitting
    const submitColor = expenseCategory === 'fixed' ? 'bg-warning' : 'bg-danger'
    const today = dateStringVN()

    const nameRef = useRef(null)
    const amountRef = useRef(null)

    // Chọn category 2 bước: PHÂN LOẠI (group) → NHÃN (category trong group). activeGroup
    // suy từ nhãn đang chọn; khi parent đổi selection (mở modal / reset) thì đồng bộ lại
    // bằng pattern "adjust state during render" (tránh setState trong effect).
    const selectedCat = expenseCategories.find(c => c.id === selectedCategoryId)
    const [activeGroup, setActiveGroup] = useState(() => (selectedCat ? groupMeta(selectedCat.group_section).key : 'operating'))
    const [prevSelId, setPrevSelId] = useState(selectedCategoryId)
    if (selectedCategoryId !== prevSelId) {
        setPrevSelId(selectedCategoryId)
        if (selectedCat) setActiveGroup(groupMeta(selectedCat.group_section).key)
    }
    // Chỉ 1 dropdown mở tại 1 thời điểm: 'group' | 'label' | null.
    const [openDd, setOpenDd] = useState(null)
    const closeDd = useCallback(() => setOpenDd(null), [setOpenDd])
    // Sheet CRUD nhãn (lọc theo nhóm đang chọn).
    const [manageOpen, setManageOpen] = useState(false)

    const groupLabels = labelsInGroup(expenseCategories, activeGroup)

    // Mirror group → expenseCategory ('fixed' cho overhead, 'expense' còn lại) để
    // route save path + tông nút Xác nhận, không cần tab riêng.
    const mirrorGroup = (key) => {
        const next = key === 'overhead' ? 'fixed' : 'expense'
        if (next !== expenseCategory) onCategoryChange?.(next)
    }
    // Đổi PHÂN LOẠI: set group + mirror; nếu nhãn đang chọn không thuộc nhóm mới thì
    // tự chọn nhãn đầu (luôn có category hợp lệ, khỏi để trống).
    const applyGroup = (key) => {
        setActiveGroup(key)
        mirrorGroup(key)
        const labels = labelsInGroup(expenseCategories, key)
        if (!labels.some(l => l.id === selectedCategoryId) && labels[0]) onCategoryIdChange(labels[0].id)
        setOpenDd(null)
    }
    const handlePickCategory = (id) => {
        const chip = expenseCategories.find(c => c.id === id)
        if (chip) mirrorGroup(chip.group_section)
        onCategoryIdChange(id)
        setOpenDd(null)
        // Advance focus only when the user hasn't started typing — avoid
        // yanking caret away if they reach back to fix the label.
        if (!costName.trim()) nameRef.current?.focus()
    }

    return (
        <>
        {/* max-h + scroll: sheet neo đáy màn, nội dung cao hơn viewport (thêm dòng
            cảnh báo backdate / bàn phím mở) thì tràn lên trên, mất luôn nút X. */}
        <BottomSheet
            onClose={onClose}
            panelClassName="w-full max-w-lg max-h-[92dvh] overflow-y-auto [&>*]:shrink-0 bg-surface rounded-t-[24px] border-t border-border/60 shadow-2xl p-5 pb-8 flex flex-col gap-4 animate-slide-up"
        >
                <div className="flex items-center justify-between">
                    <span className="text-[16px] font-black text-text">{isEditing ? 'Sửa chi phí' : 'Thêm chi phí'}</span>
                    <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-surface-light border border-border/60 text-text-secondary hover:text-text transition-all">
                        <X size={16} />
                    </button>
                </div>

                {/* Ngày chi — lên đầu modal, full-width. Mặc định hôm nay; chọn ngày quá khứ để ghi lùi. */}
                <div className="flex flex-col gap-1.5">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">Ngày chi</span>
                    <DatePicker
                        value={expenseDate || today}
                        max={today}
                        onChange={onDateChange}
                        presets={false}
                        align="start"
                        trigger={(label, toggle) => (
                            <button
                                type="button"
                                onClick={toggle}
                                className="w-full bg-surface-light border border-border/60 rounded-[12px] px-4 py-3 text-[14px] font-bold text-text text-left hover:border-primary/40 transition-all"
                            >
                                {formatIsoDisplay(expenseDate || today)}
                            </button>
                        )}
                    />
                </div>

                {/* Thời điểm — toggle full-width dưới nhãn */}
                <div className="flex flex-col gap-1.5">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">Thời điểm</span>
                    <div className="w-full flex items-center gap-0.5 bg-surface-light border border-border/60 rounded-lg p-0.5">
                        <button
                            type="button"
                            onClick={() => onAfterShiftChange?.(false)}
                            className={`flex-1 px-1 py-2 rounded-md text-[12px] font-bold transition-all ${!isAfterShift ? 'bg-primary text-white' : 'text-text-secondary'}`}
                        >
                            Trong ca
                        </button>
                        <button
                            type="button"
                            onClick={() => onAfterShiftChange?.(true)}
                            className={`flex-1 px-1 py-2 rounded-md text-[12px] font-bold transition-all ${isAfterShift ? 'bg-primary text-white' : 'text-text-secondary'}`}
                        >
                            Sau ca
                        </button>
                    </div>
                </div>

                {/* Phân loại — dropdown chọn nhóm */}
                <div className="flex flex-col gap-1.5">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">Phân loại</span>
                    <SelectRow
                        valueLabel={groupMeta(activeGroup).label}
                        valueDot={groupMeta(activeGroup).dotCls}
                        disabled={isSubmitting}
                        open={openDd === 'group'}
                        onToggle={() => setOpenDd(o => (o === 'group' ? null : 'group'))}
                        onClose={closeDd}
                    >
                        {EXPENSE_GROUPS.map(g => (
                            <OptionRow
                                key={g.key}
                                dotCls={g.dotCls}
                                name={g.label}
                                active={activeGroup === g.key}
                                onClick={() => applyGroup(g.key)}
                            />
                        ))}
                    </SelectRow>
                </div>

                {/* Nhãn — dropdown chọn nhãn thuộc nhóm đang chọn + quản lý nhãn */}
                <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">Nhãn</span>
                        {/* Lối tắt vào màn Quản lý nhãn — không phải mở dropdown mới thấy. */}
                        <button
                            type="button"
                            onClick={() => { setOpenDd(null); setManageOpen(true) }}
                            className="flex items-center gap-1 text-[11px] font-bold text-text-secondary hover:text-primary transition-all"
                        >
                            <Settings2 size={12} strokeWidth={2.5} />
                            Quản lý
                        </button>
                    </div>
                    <SelectRow
                        valueLabel={groupLabels.find(c => c.id === selectedCategoryId)?.name}
                        valueDot={groupMeta(activeGroup).dotCls}
                        placeholder="Chọn nhãn…"
                        disabled={isSubmitting}
                        open={openDd === 'label'}
                        onToggle={() => setOpenDd(o => (o === 'label' ? null : 'label'))}
                        onClose={closeDd}
                    >
                        {groupLabels.map(c => (
                            <OptionRow
                                key={c.id}
                                dotCls={groupMeta(activeGroup).dotCls}
                                name={c.name}
                                active={c.id === selectedCategoryId}
                                onClick={() => handlePickCategory(c.id)}
                            />
                        ))}
                        {/* Mở sheet CRUD nhãn (lọc theo nhóm đang chọn) thay cho inline-create */}
                        <button
                            type="button"
                            onClick={() => { setOpenDd(null); setManageOpen(true) }}
                            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-[10px] text-[12px] font-bold border border-dashed border-border text-text-secondary hover:text-primary hover:border-primary/50 transition-all"
                        >
                            <Settings2 size={13} strokeWidth={2.5} />
                            Quản lý nhãn
                        </button>
                    </SelectRow>
                </div>

                <input
                    ref={nameRef}
                    type="text"
                    placeholder="Tên chi phí..."
                    value={costName}
                    onChange={e => onNameChange(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === 'Tab') {
                            e.preventDefault()
                            amountRef.current?.focus()
                        }
                    }}
                    className="w-full bg-surface-light border border-border/60 rounded-[12px] px-4 py-3 text-[16px] font-medium text-text placeholder:text-text-secondary/40 focus:outline-none focus:border-primary/50"
                />

                <MoneyInput
                    value={costAmount}
                    onChange={onAmountChange}
                    onKeyDown={e => { if (e.key === 'Enter') canSubmit && onSubmit() }}
                    inputRef={amountRef}
                    size="lg"
                    align="left"
                    weight="medium"
                    placeholder="Số tiền..."
                />

                {/* Phương thức — toggle full-width dưới nhãn */}
                <div className="flex flex-col gap-1.5">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">Phương thức</span>
                    <div className="w-full flex items-center gap-0.5 bg-surface-light border border-border/60 rounded-lg p-0.5">
                        <button
                            type="button"
                            onClick={() => onPaymentMethodChange?.('cash')}
                            className={`flex-1 px-1 py-2 rounded-md text-[12px] font-bold transition-all ${paymentMethod === 'cash' ? 'bg-primary text-white' : 'text-text-secondary'}`}
                        >
                            Tiền mặt
                        </button>
                        <button
                            type="button"
                            onClick={() => onPaymentMethodChange?.('transfer')}
                            className={`flex-1 px-1 py-2 rounded-md text-[12px] font-bold transition-all ${paymentMethod === 'transfer' ? 'bg-primary text-white' : 'text-text-secondary'}`}
                        >
                            Bank
                        </button>
                    </div>
                </div>

                <button
                    onClick={() => canSubmit && onSubmit()}
                    disabled={!canSubmit}
                    className={`w-full py-3.5 rounded-[14px] text-white text-[15px] font-black uppercase tracking-wide transition-all disabled:opacity-40 disabled:cursor-not-allowed ${submitColor}`}
                >
                    {isSubmitting ? 'Đang lưu...' : isEditing ? 'Lưu thay đổi' : 'Xác nhận'}
                </button>

                {isEditing && onDelete && (
                    <button
                        type="button"
                        onClick={onDelete}
                        disabled={isSubmitting}
                        className="w-full -mt-1 py-2 rounded-[12px] text-[13px] font-bold text-danger hover:bg-danger/10 transition-all disabled:opacity-40"
                    >
                        Xoá chi phí
                    </button>
                )}
        </BottomSheet>

        {/* Màn Quản lý nhãn — CRUD nhãn theo nhóm + tái phân loại chi phí khi xoá.
            Việc CHỌN nhãn cho chi phí dùng 2 dropdown phía trên; ở đây tạo nhãn mới
            thì onPick set luôn nhãn đó vào form (không đóng sheet). */}
        <ChangeCategorySheet
            open={manageOpen}
            categories={expenseCategories}
            selectedId={selectedCategoryId}
            onPick={handlePickCategory}
            onCreate={onCreateCategory}
            onUpdate={onUpdateCategory}
            onDelete={onDeleteCategory}
            onListCategoryExpenses={onListCategoryExpenses}
            onMoveExpense={onMoveExpense}
            onCountCategories={onCountCategories}
            onRestoreCategory={onRestoreCategory}
            showToast={showToast}
            onClose={() => setManageOpen(false)}
        />
        </>
    )
}

// Dropdown select dùng chung cho Phân loại + Nhãn. Trigger hiện giá trị (chấm màu
// + tên); panel mở LÊN trên (modal neo đáy màn hình) chứa các option (children).
// Click ra ngoài (trigger + panel) → đóng (onClose). ref bọc cả trigger nên bấm
// lại trigger không bị listener đóng trước rồi onToggle mở lại.
function SelectRow({ valueLabel, valueDot, placeholder = 'Chọn…', disabled, open, onToggle, onClose, children }) {
    const ref = useRef(null)
    useClickOutside(ref, () => onClose?.(), { active: open })
    return (
        <div ref={ref} className="relative">
            <button
                type="button"
                disabled={disabled}
                onClick={onToggle}
                className="flex items-center justify-between gap-2 w-full bg-surface-light border border-border/60 rounded-[12px] px-4 py-3 hover:border-primary/40 transition-all"
            >
                {valueLabel ? (
                    <span className="flex items-center gap-2 text-[14px] font-bold text-text min-w-0">
                        <span className={`w-1.5 h-1.5 rounded-full ${valueDot} opacity-80 shrink-0`} />
                        <span className="truncate">{valueLabel}</span>
                    </span>
                ) : (
                    <span className="text-[14px] font-medium text-text-secondary/60 truncate">{placeholder}</span>
                )}
                <ChevronDown size={16} className={`text-text-secondary shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && (
                <div className="absolute bottom-full left-0 right-0 mb-1.5 z-10 bg-surface border border-border/60 rounded-[12px] shadow-xl p-2 flex flex-col gap-1 max-h-[50vh] overflow-y-auto hide-scrollbar">
                    {children}
                </div>
            )}
        </div>
    )
}

// 1 option trong dropdown — chấm màu + tên + check khi đang chọn.
function OptionRow({ dotCls, name, active, onClick }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-[10px] text-[13px] font-bold border transition-all ${
                active ? 'bg-primary/15 border-primary/50 text-primary' : 'bg-surface-light border-border/60 text-text-secondary hover:text-text hover:border-border'
            }`}
        >
            <span className="flex items-center gap-2 min-w-0">
                <span className={`w-1.5 h-1.5 rounded-full ${dotCls} opacity-70 shrink-0`} />
                <span className="truncate">{name}</span>
            </span>
            {active && <Check size={12} strokeWidth={3} className="shrink-0" />}
        </button>
    )
}
