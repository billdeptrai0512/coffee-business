import { useState } from 'react'
import { Warehouse, X, Pencil, Trash2, Loader } from 'lucide-react'
import { Dialog } from '../common/ModalShell'

// Modal kho tổng chung — chọn/tạo nhóm để dùng chung kho tổng với địa chỉ khác.
// Không phải thao tác phá dữ liệu (ON DELETE SET NULL khi xoá nhóm) nên không cần
// gõ lại tên xác nhận như xoá địa chỉ — chỉ 1 lần tap xác nhận cho việc xoá nhóm.
export default function WarehouseGroupModal({
    addr, addresses, warehouseGroups,
    onCreateWarehouseGroup, onRenameWarehouseGroup, onRemoveWarehouseGroup, onSetAddressGroup,
    onClose,
}) {
    const [groupSaving, setGroupSaving] = useState(false)
    const [groupError, setGroupError] = useState('')
    const [newGroupName, setNewGroupName] = useState('')
    const [creatingGroup, setCreatingGroup] = useState(false)
    const [confirmDeleteGroupId, setConfirmDeleteGroupId] = useState(null)
    const [renamingGroupId, setRenamingGroupId] = useState(null)
    const [renameGroupName, setRenameGroupName] = useState('')

    async function handleJoinGroup(groupId) {
        if (groupSaving) return
        setGroupSaving(true)
        setGroupError('')
        try {
            await onSetAddressGroup(addr.id, groupId)
        } catch (err) {
            setGroupError(err.message || 'Không thể đổi nhóm kho tổng')
        } finally {
            setGroupSaving(false)
        }
    }

    async function handleCreateAndJoinGroup() {
        const name = newGroupName.trim()
        if (!name || creatingGroup) return
        setCreatingGroup(true)
        setGroupError('')
        try {
            const groupId = await onCreateWarehouseGroup(name)
            await onSetAddressGroup(addr.id, groupId)
            setNewGroupName('')
        } catch (err) {
            setGroupError(err.message || 'Không thể tạo nhóm')
        } finally {
            setCreatingGroup(false)
        }
    }

    async function handleRenameGroup(groupId) {
        const name = renameGroupName.trim()
        if (!name || groupSaving) return
        setGroupSaving(true)
        setGroupError('')
        try {
            await onRenameWarehouseGroup(groupId, name)
            setRenamingGroupId(null)
        } catch (err) {
            setGroupError(err.message || 'Không thể đổi tên nhóm')
        } finally {
            setGroupSaving(false)
        }
    }

    async function handleDeleteGroup(groupId) {
        setGroupSaving(true)
        setGroupError('')
        try {
            await onRemoveWarehouseGroup(groupId)
            setConfirmDeleteGroupId(null)
        } catch (err) {
            setGroupError(err.message || 'Không thể xoá nhóm')
        } finally {
            setGroupSaving(false)
        }
    }

    return (
        <Dialog
            onClose={() => { if (!groupSaving && !creatingGroup) onClose() }}
            panelClassName="w-full max-w-sm mx-4 my-4 bg-surface border border-border/60 rounded-[24px] shadow-2xl overflow-hidden max-h-[calc(100dvh-2rem)] flex flex-col"
        >
            <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border/40 shrink-0">
                <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-[10px] bg-warning/10 flex items-center justify-center">
                        <Warehouse size={15} className="text-warning" />
                    </div>
                    <p className="text-text font-black text-sm leading-none">Kho tổng chung</p>
                </div>
                <button
                    onClick={onClose}
                    className="p-1.5 text-text-secondary hover:text-text transition-colors rounded-lg hover:bg-surface-light"
                >
                    <X size={16} />
                </button>
            </div>
            <div className="p-5 flex flex-col gap-2.5 overflow-y-auto">
                <p className="text-text-secondary text-xs leading-relaxed mb-1">
                    Gộp <span className="font-bold text-text">{addr.name}</span> vào 1 nhóm để dùng chung kho tổng —
                    mua ở đâu cũng cộng chung, giá vốn hợp nhất, quầy vẫn riêng từng địa chỉ.{' '}
                    <span className="text-warning font-bold">Số tồn đổi ngay khi gộp/rời nhóm.</span>
                </p>

                <button
                    onClick={() => handleJoinGroup(null)}
                    disabled={groupSaving || !addr.warehouse_group_id}
                    className={`flex items-center justify-between px-4 py-3 rounded-[12px] border text-sm font-bold transition-colors disabled:opacity-100 ${!addr.warehouse_group_id ? 'border-primary bg-primary/10 text-primary' : 'border-border/60 bg-bg text-text hover:bg-surface-light'}`}
                >
                    Không gộp nhóm
                </button>

                {warehouseGroups.map(g => {
                    const memberCount = addresses.filter(a => a.warehouse_group_id === g.id).length
                    const isCurrent = addr.warehouse_group_id === g.id
                    const confirming = confirmDeleteGroupId === g.id
                    const isRenaming = renamingGroupId === g.id

                    if (isRenaming) {
                        return (
                            <div key={g.id} className="flex items-center gap-1.5">
                                <input
                                    type="text"
                                    value={renameGroupName}
                                    onChange={e => setRenameGroupName(e.target.value)}
                                    disabled={groupSaving}
                                    autoFocus
                                    className="flex-1 min-w-0 px-4 py-2.5 rounded-[12px] bg-bg border border-primary/60 text-text text-sm font-medium focus:outline-none disabled:opacity-50"
                                />
                                <button
                                    onClick={() => handleRenameGroup(g.id)}
                                    disabled={groupSaving || !renameGroupName.trim()}
                                    className="shrink-0 px-3 py-2.5 rounded-[12px] bg-primary text-black font-black text-xs disabled:opacity-50"
                                >
                                    Lưu
                                </button>
                                <button
                                    onClick={() => setRenamingGroupId(null)}
                                    disabled={groupSaving}
                                    className="shrink-0 p-2.5 rounded-[12px] bg-surface-light text-text-secondary"
                                >
                                    <X size={14} />
                                </button>
                            </div>
                        )
                    }

                    return (
                        <div
                            key={g.id}
                            className={`flex items-center gap-2 px-4 py-3 rounded-[12px] border text-sm font-bold transition-colors ${isCurrent ? 'border-primary bg-primary/10 text-primary' : 'border-border/60 bg-bg text-text'}`}
                        >
                            <button
                                onClick={() => handleJoinGroup(g.id)}
                                disabled={groupSaving || isCurrent}
                                className="flex-1 min-w-0 text-left disabled:opacity-100"
                            >
                                <span className="truncate block">{g.name}</span>
                                <span className="block text-[11px] font-medium text-text-secondary">{memberCount} địa chỉ</span>
                            </button>
                            {confirming ? (
                                <div className="flex items-center gap-1.5 shrink-0">
                                    <button
                                        onClick={() => handleDeleteGroup(g.id)}
                                        disabled={groupSaving}
                                        className="px-2 py-1.5 rounded-lg bg-danger text-white text-[11px] font-black disabled:opacity-50"
                                    >
                                        Xoá
                                    </button>
                                    <button
                                        onClick={() => setConfirmDeleteGroupId(null)}
                                        className="px-2 py-1.5 rounded-lg bg-surface-light text-text-secondary text-[11px] font-bold"
                                    >
                                        Hủy
                                    </button>
                                </div>
                            ) : (
                                <div className="flex items-center gap-0.5 shrink-0">
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setRenamingGroupId(g.id); setRenameGroupName(g.name) }}
                                        className="p-1.5 text-text-secondary hover:text-text transition-colors"
                                        title="Đổi tên nhóm"
                                    >
                                        <Pencil size={14} />
                                    </button>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setConfirmDeleteGroupId(g.id) }}
                                        className="p-1.5 text-text-secondary hover:text-danger transition-colors"
                                        title="Xoá nhóm"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            )}
                        </div>
                    )
                })}

                <div className="flex items-center gap-2 pt-1">
                    <input
                        type="text"
                        value={newGroupName}
                        onChange={e => setNewGroupName(e.target.value)}
                        placeholder="Tên nhóm mới…"
                        disabled={creatingGroup}
                        className="flex-1 min-w-0 px-4 py-2.5 rounded-[12px] bg-bg border border-border/60 text-text text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary disabled:opacity-50"
                    />
                    <button
                        onClick={handleCreateAndJoinGroup}
                        disabled={creatingGroup || !newGroupName.trim()}
                        className="shrink-0 px-4 py-2.5 rounded-[12px] bg-primary text-black font-black text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                    >
                        {creatingGroup ? <Loader size={14} className="animate-spin" /> : 'Tạo & gộp'}
                    </button>
                </div>

                {groupError && <p className="text-danger text-xs font-medium">{groupError}</p>}
            </div>
        </Dialog>
    )
}
