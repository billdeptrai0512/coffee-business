import { useState, useEffect } from 'react'
import { X, Plus, Check, Pencil, Trash2, ChevronDown } from 'lucide-react'
import { EXPENSE_GROUPS, groupMeta } from '../../constants/expenseGroups'
import { formatVND } from '../../utils/money'
import { dayMonthVN } from '../../utils/dateVN'
import { BottomSheet } from '../common/ModalShell'

// Nhãn fallback (Vận hành · "Chi phí khác") là nơi dồn chi phí khi chi phí không
// gắn nhãn — KHÓA xoá VÀ khoá đổi nhóm để không gãy fallback. Nhãn còn lại tự do.
const isProtectedFallback = (c) =>
    c.is_default && c.group_section === 'operating' && c.name === 'Chi phí khác'

// Nhãn thuộc 1 nhóm; nhãn legacy không khớp nhóm nào → coi như Vận hành.
const KNOWN_GROUP_KEYS = new Set(EXPENSE_GROUPS.map(g => g.key))
const labelsInGroup = (categories, key) => categories.filter(c =>
    c.group_section === key || (key === 'operating' && !KNOWN_GROUP_KEYS.has(c.group_section))
)

// Màn QUẢN LÝ NHÃN (mở từ AddExpenseModal). Vai trò: CRUD nhãn theo nhóm + tái
// phân loại chi phí khi xoá nhãn còn chi phí. Việc CHỌN nhãn cho chi phí dùng 2
// dropdown ở modal — ở đây tạo nhãn mới thì onPick set luôn nhãn đó vào form.
export default function ChangeCategorySheet({
    open,
    categories,
    selectedId,        // nhãn đang chọn ở form (để highlight)
    onPick,            // (id) => set nhãn vào form (không đóng sheet) — sau khi tạo
    onCreate,          // ({name, group_section}) => Promise<{id, name}>
    onUpdate,          // (id, { name?, group_section? }) => Promise
    onDelete,          // (id) => Promise — soft-delete nhãn RỖNG
    onListCategoryExpenses, // (id) => Promise<expense[]>
    onMoveExpense,     // (expenseId, toId) => Promise — re-tag 1 chi phí
    onCountCategories, // () => Promise<{ [id]: count }>
    onRestoreCategory, // (category) => Promise — hoàn tác xoá
    showToast,         // (msg, type, action) => void
    onClose,
}) {
    const [counts, setCounts] = useState({})
    const [busy, setBusy] = useState(false)
    // tạo nhãn mới
    const [creating, setCreating] = useState(false)
    const [newName, setNewName] = useState('')
    const [newGroup, setNewGroup] = useState('operating')
    // sửa nhãn (tên + nhóm)
    const [editingId, setEditingId] = useState(null)
    const [editName, setEditName] = useState('')
    const [editGroup, setEditGroup] = useState('operating')
    // xác nhận xoá nhãn rỗng (inline, không dùng window.confirm)
    const [confirmId, setConfirmId] = useState(null)
    // bước chuyển chi phí khi xoá nhãn còn chi phí
    const [reassign, setReassign] = useState(null) // { category, remaining, movedIds }

    const refreshCounts = () => { if (onCountCategories) onCountCategories().then(setCounts).catch(() => {}) }
    useEffect(() => { if (open) refreshCounts() }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

    if (!open) return null

    const toast = (msg, type = 'success', action = null) => showToast?.(msg, type, action)

    // Action "Hoàn tác": bật lại nhãn + trả các chi phí đã chuyển về nhãn cũ.
    const undoAction = (category, movedIds) => ({
        label: 'Hoàn tác',
        onClick: async () => {
            await onRestoreCategory?.(category)
            for (const id of movedIds) await onMoveExpense?.(id, category.id)
            refreshCounts()
            toast('Đã hoàn tác', 'info')
        },
    })

    // ── Tạo nhãn ──
    const submitCreate = async () => {
        if (!newName.trim() || busy) return
        setBusy(true)
        try {
            const created = await onCreate({ name: newName.trim(), group_section: newGroup })
            if (created?.id) onPick?.(created.id)
            setCreating(false); setNewName('')
            toast(`Đã tạo nhãn “${created?.name || newName.trim()}”`)
            refreshCounts()
        } finally { setBusy(false) }
    }

    // ── Sửa nhãn (tên + nhóm) ──
    const startEdit = (c) => {
        setConfirmId(null)
        setEditingId(c.id); setEditName(c.name); setEditGroup(groupMeta(c.group_section).key)
    }
    const cancelEdit = () => { setEditingId(null); setEditName('') }
    const submitEdit = async (c) => {
        if (!editName.trim() || busy) return
        const updates = {}
        if (editName.trim() !== c.name) updates.name = editName.trim()
        if (!isProtectedFallback(c) && editGroup !== groupMeta(c.group_section).key) updates.group_section = editGroup
        if (Object.keys(updates).length === 0) { cancelEdit(); return }
        setBusy(true)
        try { await onUpdate(c.id, updates); cancelEdit(); toast('Đã cập nhật nhãn') }
        finally { setBusy(false) }
    }

    // ── Xoá nhãn ──
    const requestDelete = async (c) => {
        if (busy) return
        setBusy(true)
        try {
            const expenses = onListCategoryExpenses ? await onListCategoryExpenses(c.id) : []
            if (expenses.length > 0) { setReassign({ category: c, remaining: expenses, movedIds: [] }); cancelEdit() }
            else setConfirmId(c.id)
        } finally { setBusy(false) }
    }
    const confirmDeleteEmpty = async (c) => {
        if (busy) return
        setBusy(true)
        try {
            await onDelete(c.id)
            setConfirmId(null)
            refreshCounts()
            toast(`Đã xoá nhãn “${c.name}”`, 'success', undoAction(c, []))
        } finally { setBusy(false) }
    }

    const handleClose = () => {
        setReassign(null); setConfirmId(null); cancelEdit(); setCreating(false)
        onClose()
    }

    // ===== Bước CHUYỂN CHI PHÍ trước khi xoá =====
    if (reassign) {
        const targets = categories.filter(c => c.id !== reassign.category.id)
        const total = reassign.remaining.length + reassign.movedIds.length

        const moveOne = async (expense, toId) => {
            if (busy) return
            setBusy(true)
            try {
                await onMoveExpense(expense.id, toId)
                setReassign(r => ({ ...r, remaining: r.remaining.filter(e => e.id !== expense.id), movedIds: [...r.movedIds, expense.id] }))
            } finally { setBusy(false) }
        }
        const moveAll = async (toId) => {
            if (busy) return
            setBusy(true)
            try {
                const ids = reassign.remaining.map(e => e.id)
                for (const e of reassign.remaining) await onMoveExpense(e.id, toId)
                setReassign(r => ({ ...r, remaining: [], movedIds: [...r.movedIds, ...ids] }))
            } finally { setBusy(false) }
        }
        const finishDelete = async () => {
            if (busy) return
            const { category, movedIds } = reassign
            setBusy(true)
            try {
                await onDelete(category.id)
                setReassign(null)
                refreshCounts()
                toast(`Đã chuyển ${movedIds.length} chi phí · xoá nhãn “${category.name}”`, 'success', undoAction(category, movedIds))
            } finally { setBusy(false) }
        }

        return (
            <ReassignView
                category={reassign.category}
                remaining={reassign.remaining}
                moved={reassign.movedIds.length}
                total={total}
                targets={targets}
                busy={busy}
                onMoveOne={moveOne}
                onMoveAll={moveAll}
                onFinish={finishDelete}
                onClose={handleClose}
            />
        )
    }

    // ===== Màn QUẢN LÝ NHÃN =====
    return (
        <BottomSheet
            onClose={handleClose}
            panelClassName="w-full max-w-lg bg-surface rounded-t-[24px] border-t border-border/60 shadow-2xl p-5 pb-8 flex flex-col gap-4 animate-slide-up max-h-[85vh] overflow-y-auto"
        >
                <div className="flex items-center justify-between">
                    <span className="text-[16px] font-black text-text">Quản lý nhãn</span>
                    <button onClick={handleClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-surface-light border border-border/60 text-text-secondary hover:text-text transition-all">
                        <X size={16} />
                    </button>
                </div>

                {EXPENSE_GROUPS.map(g => {
                    const labels = labelsInGroup(categories, g.key)
                    return (
                        <div key={g.key} className="flex flex-col gap-2">
                            <div className="flex items-center gap-1.5">
                                <span className={`w-1.5 h-1.5 rounded-full ${g.dotCls} opacity-80`} />
                                <span className="text-[10px] font-black uppercase tracking-wider text-text-secondary">{g.label}</span>
                            </div>
                            {labels.length === 0 ? (
                                <span className="text-[12px] text-text-dim italic pl-3">Chưa có nhãn.</span>
                            ) : (
                                <div className="flex flex-col gap-1.5">
                                    {labels.map(c => (
                                        <LabelRow
                                            key={c.id}
                                            category={c}
                                            count={counts[c.id] || 0}
                                            selected={c.id === selectedId}
                                            dotCls={g.dotCls}
                                            busy={busy}
                                            isEditing={editingId === c.id}
                                            isConfirming={confirmId === c.id}
                                            editName={editName}
                                            editGroup={editGroup}
                                            onEditNameChange={setEditName}
                                            onEditGroupChange={setEditGroup}
                                            onStartEdit={() => startEdit(c)}
                                            onSubmitEdit={() => submitEdit(c)}
                                            onCancelEdit={cancelEdit}
                                            onRequestDelete={() => requestDelete(c)}
                                            onConfirmDelete={() => confirmDeleteEmpty(c)}
                                            onCancelDelete={() => setConfirmId(null)}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    )
                })}

                {!creating ? (
                    <button
                        type="button"
                        disabled={busy}
                        onClick={() => { setNewName(''); setNewGroup('operating'); setCreating(true) }}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-[10px] text-[12px] font-bold border border-dashed border-border text-text-secondary hover:text-primary hover:border-primary/50 transition-all self-start disabled:opacity-40"
                    >
                        <Plus size={12} strokeWidth={2.5} />
                        Tạo nhãn mới
                    </button>
                ) : (
                    <div className="flex flex-col gap-2 p-3 bg-surface-light border border-border/60 rounded-[12px]">
                        <input
                            autoFocus
                            type="text"
                            placeholder="Tên nhãn mới…"
                            value={newName}
                            onChange={e => setNewName(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') submitCreate() }}
                            className="w-full bg-surface border border-border/60 rounded-[10px] px-3 py-2 text-[13px] text-text placeholder:text-text-secondary/40 focus:outline-none focus:border-primary/50"
                        />
                        <GroupTabs value={newGroup} onChange={setNewGroup} />
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => { setCreating(false); setNewName('') }}
                                className="flex-1 py-1.5 rounded-[10px] text-[12px] font-bold text-text-secondary border border-border/60 hover:bg-border/20"
                            >
                                Huỷ
                            </button>
                            <button
                                type="button"
                                disabled={!newName.trim() || busy}
                                onClick={submitCreate}
                                className="flex-1 py-1.5 rounded-[10px] text-[12px] font-black uppercase tracking-wide text-white bg-primary disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                {busy ? 'Đang lưu…' : 'Tạo'}
                            </button>
                        </div>
                    </div>
                )}

                <span className="text-[11px] text-text-dim leading-snug">
                    Số bên cạnh nhãn = số chi phí đang gắn. Xoá nhãn còn chi phí → phải chuyển từng chi phí (hoặc tất cả) sang nhãn khác trước. Riêng "Chi phí khác" (Vận hành) không xoá / đổi nhóm được vì là nơi dồn mặc định.
                </span>
        </BottomSheet>
    )
}

// 1 hàng nhãn: chấm + tên + badge số chi phí + sửa + xoá. Có 3 trạng thái:
// thường / đang-sửa (tên + nhóm) / đang-xác-nhận-xoá.
function LabelRow({
    category: c, count, selected, dotCls, busy,
    isEditing, isConfirming,
    editName, editGroup, onEditNameChange, onEditGroupChange,
    onStartEdit, onSubmitEdit, onCancelEdit,
    onRequestDelete, onConfirmDelete, onCancelDelete,
}) {
    const protectedFb = isProtectedFallback(c)

    if (isEditing) {
        return (
            <div className="flex flex-col gap-2 p-2.5 bg-surface-light border border-primary/40 rounded-[10px]">
                <input
                    autoFocus
                    value={editName}
                    onChange={e => onEditNameChange(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') onSubmitEdit(); if (e.key === 'Escape') onCancelEdit() }}
                    className="w-full bg-surface border border-border/60 rounded-[8px] px-2.5 py-1.5 text-[13px] font-bold text-text focus:outline-none focus:border-primary/50"
                />
                {protectedFb ? (
                    <span className="text-[10px] text-text-dim italic">Nhãn mặc định — không đổi nhóm được.</span>
                ) : (
                    <GroupTabs value={editGroup} onChange={onEditGroupChange} />
                )}
                <div className="flex gap-2">
                    <button onClick={onCancelEdit} className="flex-1 py-1.5 rounded-[8px] text-[12px] font-bold text-text-secondary border border-border/60 hover:bg-border/20">Huỷ</button>
                    <button onClick={onSubmitEdit} disabled={!editName.trim() || busy} className="flex-1 py-1.5 rounded-[8px] text-[12px] font-black uppercase tracking-wide text-white bg-primary disabled:opacity-40">Lưu</button>
                </div>
            </div>
        )
    }

    if (isConfirming) {
        return (
            <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-[10px] bg-danger/5 border border-danger/40">
                <span className="text-[12px] font-bold text-text truncate">Xoá nhãn “{c.name}”?</span>
                <div className="flex items-center gap-1.5 shrink-0">
                    <button onClick={onCancelDelete} className="px-2.5 py-1 rounded-full text-[11px] font-bold text-text-secondary border border-border/60 hover:bg-border/20">Huỷ</button>
                    <button onClick={onConfirmDelete} disabled={busy} className="px-2.5 py-1 rounded-full text-[11px] font-black uppercase tracking-wide text-white bg-danger disabled:opacity-40">Xoá</button>
                </div>
            </div>
        )
    }

    return (
        <div className="flex items-center justify-between gap-2 pl-3 pr-1 py-1.5 rounded-[10px] bg-surface-light border border-border/60">
            <span className="flex items-center gap-2 min-w-0">
                <span className={`w-1.5 h-1.5 rounded-full ${dotCls} opacity-70 shrink-0`} />
                <span className={`text-[13px] font-bold truncate ${selected ? 'text-primary' : 'text-text'}`}>{c.name}</span>
                <span className="text-[11px] font-bold text-text-dim tabular-nums shrink-0">· {count}</span>
            </span>
            <div className="flex items-center gap-0.5 shrink-0">
                <button
                    type="button"
                    disabled={busy}
                    onClick={onStartEdit}
                    className="w-7 h-7 flex items-center justify-center rounded-full text-text-secondary hover:bg-primary/10 hover:text-primary transition-colors disabled:opacity-40"
                    aria-label="Sửa nhãn"
                >
                    <Pencil size={12} />
                </button>
                {!protectedFb && (
                    <button
                        type="button"
                        disabled={busy}
                        onClick={onRequestDelete}
                        className="w-7 h-7 flex items-center justify-center rounded-full text-text-secondary hover:bg-danger/10 hover:text-danger transition-colors disabled:opacity-40"
                        aria-label="Xoá nhãn"
                    >
                        <Trash2 size={12} />
                    </button>
                )}
            </div>
        </div>
    )
}

// Bước chuyển chi phí: tiến độ + chuyển hàng loạt + chuyển từng dòng + nút xoá cuối.
function ReassignView({ category, remaining, moved, total, targets, busy, onMoveOne, onMoveAll, onFinish, onClose }) {
    const [bulkOpen, setBulkOpen] = useState(false)
    const pct = total > 0 ? Math.round((moved / total) * 100) : 0
    const done = remaining.length === 0

    return (
        <BottomSheet
            onClose={onClose}
            panelClassName="w-full max-w-lg bg-surface rounded-t-[24px] border-t border-border/60 shadow-2xl p-5 pb-8 flex flex-col gap-4 animate-slide-up max-h-[85vh] overflow-y-auto"
        >
                <div className="flex items-center justify-between">
                    <span className="text-[16px] font-black text-text">Chuyển chi phí trước khi xoá</span>
                    <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-surface-light border border-border/60 text-text-secondary hover:text-text transition-all">
                        <X size={16} />
                    </button>
                </div>

                <div className="flex flex-col gap-1.5">
                    <p className="text-[12px] text-text-secondary leading-snug">
                        Nhãn <span className="font-bold text-text">“{category.name}”</span> — chuyển chi phí sang nhãn khác rồi xoá.
                    </p>
                    <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 rounded-full bg-surface-light overflow-hidden">
                            <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-[11px] font-bold text-text-secondary tabular-nums shrink-0">Đã chuyển {moved}/{total}</span>
                    </div>
                </div>

                {targets.length === 0 ? (
                    <span className="text-[12px] text-text-dim italic">Không còn nhãn nào khác để chuyển sang.</span>
                ) : done ? (
                    <div className="flex flex-col gap-3">
                        <span className="text-[12px] text-text-secondary">Đã chuyển hết chi phí. Có thể xoá nhãn.</span>
                        <button
                            type="button"
                            disabled={busy}
                            onClick={onFinish}
                            className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-[12px] text-[13px] font-black uppercase tracking-wide text-white bg-danger disabled:opacity-40"
                        >
                            <Trash2 size={14} strokeWidth={2.5} />
                            {busy ? 'Đang xoá…' : `Xoá nhãn “${category.name}”`}
                        </button>
                    </div>
                ) : (
                    <>
                        {/* #7 — chuyển TẤT CẢ còn lại sang 1 nhãn */}
                        <div className="flex flex-col gap-2 p-3 rounded-[12px] border border-dashed border-border">
                            {!bulkOpen ? (
                                <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => setBulkOpen(true)}
                                    className="self-start flex items-center gap-1.5 text-[12px] font-bold text-text-secondary hover:text-primary transition-all disabled:opacity-40"
                                >
                                    Chuyển TẤT CẢ {remaining.length} chi phí sang…
                                    <ChevronDown size={12} strokeWidth={2.5} />
                                </button>
                            ) : (
                                <>
                                    <span className="text-[11px] font-black uppercase tracking-wider text-text-secondary">Chuyển tất cả còn lại sang</span>
                                    <LabelPicker targets={targets} disabled={busy} onPickLabel={(id) => { setBulkOpen(false); onMoveAll(id) }} />
                                    <button type="button" onClick={() => setBulkOpen(false)} className="self-start text-[11px] font-bold text-text-dim hover:text-danger transition-all">Huỷ</button>
                                </>
                            )}
                        </div>

                        {/* #8 — từng chi phí (ngày · tên · số tiền) + picker riêng */}
                        <div className="flex flex-col gap-2">
                            {remaining.map(exp => (
                                <ReassignRow key={exp.id} expense={exp} targets={targets} disabled={busy} onMove={(toId) => onMoveOne(exp, toId)} />
                            ))}
                        </div>
                    </>
                )}

                <button
                    type="button"
                    disabled={busy}
                    onClick={onClose}
                    className="self-start px-3 py-2 rounded-[10px] text-[12px] font-bold text-text-secondary border border-border/60 hover:bg-border/20 disabled:opacity-40"
                >
                    Đóng
                </button>
        </BottomSheet>
    )
}

// 1 dòng chi phí trong bước chuyển: ngày · tên + số tiền, mở ra LabelPicker.
function ReassignRow({ expense, targets, disabled, onMove }) {
    const [open, setOpen] = useState(false)
    return (
        <div className="flex flex-col gap-2 p-3 bg-surface-light border border-border/60 rounded-[12px]">
            <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-bold text-text truncate min-w-0">
                    {dayMonthVN(expense.created_at) && <span className="text-text-dim tabular-nums font-medium">{dayMonthVN(expense.created_at)} · </span>}
                    {expense.name || 'Chi phí'}
                </span>
                <span className="text-[13px] font-bold text-danger shrink-0">{formatVND(expense.amount || 0)}</span>
            </div>
            {!open ? (
                <button
                    type="button"
                    disabled={disabled}
                    onClick={() => setOpen(true)}
                    className="self-start flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-bold border border-dashed border-border text-text-secondary hover:text-primary hover:border-primary/50 transition-all disabled:opacity-40"
                >
                    Chuyển sang nhãn…
                    <ChevronDown size={12} strokeWidth={2.5} />
                </button>
            ) : (
                <>
                    <LabelPicker targets={targets} disabled={disabled} onPickLabel={onMove} />
                    <button type="button" disabled={disabled} onClick={() => setOpen(false)} className="self-start text-[11px] font-bold text-text-dim hover:text-danger transition-all disabled:opacity-40">Huỷ</button>
                </>
            )}
        </div>
    )
}

// Bộ chọn 2 bước Phân loại (nhóm) → Nhãn. Đổi nhóm thì danh sách nhãn cập nhật;
// bấm 1 nhãn → onPickLabel(id). Dùng chung cho chuyển từng dòng lẫn chuyển tất cả.
function LabelPicker({ targets, disabled, onPickLabel }) {
    const groups = EXPENSE_GROUPS.filter(g => labelsInGroup(targets, g.key).length > 0)
    const [group, setGroup] = useState(groups[0]?.key || 'operating')
    const labels = labelsInGroup(targets, group)
    return (
        <div className="flex flex-col gap-2.5">
            <div className="flex flex-col gap-1.5">
                <span className="text-[10px] font-black uppercase tracking-wider text-text-secondary">Phân loại</span>
                <div className="flex flex-wrap gap-1.5">
                    {groups.map(g => (
                        <button
                            key={g.key}
                            type="button"
                            disabled={disabled}
                            onClick={() => setGroup(g.key)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-bold border transition-all disabled:opacity-40 ${
                                group === g.key
                                    ? 'bg-primary/15 border-primary/50 text-primary'
                                    : 'bg-surface border-border/60 text-text-secondary hover:text-text hover:border-border'
                            }`}
                        >
                            <span className={`w-1.5 h-1.5 rounded-full ${g.dotCls} opacity-70`} />
                            {g.label}
                        </button>
                    ))}
                </div>
            </div>
            <div className="flex flex-col gap-1.5">
                <span className="text-[10px] font-black uppercase tracking-wider text-text-secondary">Nhãn</span>
                <div className="flex flex-wrap gap-1.5">
                    {labels.map(l => (
                        <button
                            key={l.id}
                            type="button"
                            disabled={disabled}
                            onClick={() => onPickLabel(l.id)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-bold border bg-surface border-border/60 text-text-secondary hover:text-text hover:border-primary/50 transition-all disabled:opacity-40"
                        >
                            <span className={`w-1.5 h-1.5 rounded-full ${groupMeta(group).dotCls} opacity-70`} />
                            {l.name}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    )
}

// 4 ô nhóm (Phân loại) dùng cho form tạo/sửa nhãn.
function GroupTabs({ value, onChange }) {
    return (
        <div className="grid grid-cols-2 gap-1 bg-surface border border-border/60 rounded-[10px] p-0.5">
            {EXPENSE_GROUPS.map(g => (
                <button
                    key={g.key}
                    type="button"
                    onClick={() => onChange(g.key)}
                    className={`flex-1 py-1 rounded-[8px] text-[11px] font-bold transition-all ${value === g.key ? `${g.tabCls} shadow-sm` : 'text-text-secondary hover:text-text'}`}
                >
                    {g.label}
                </button>
            ))}
        </div>
    )
}
