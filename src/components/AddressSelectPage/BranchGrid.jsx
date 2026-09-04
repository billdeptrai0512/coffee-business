import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
    Pencil, Trash2, ClipboardCopy, MoreVertical, X,
    Coffee, FileText, Package, ChevronRight, Eraser,
    Banknote, Receipt, Wallet, Boxes, TrendingUp, ChefHat, Box, Warehouse, Armchair, Printer,
} from 'lucide-react'
import ErrorBanner from '../common/ErrorBanner'
import Skeleton from '../common/Skeleton'
import { formatVND } from '../../utils'
import SubscriptionBadge from './SubscriptionBadge'
import BackupModal from './BackupModal'
import RenameAddressModal from './RenameAddressModal'
import PrinterIpModal from './PrinterIpModal'
import WarehouseGroupModal from './WarehouseGroupModal'
import WipeAddressModal from './WipeAddressModal'
import DeleteAddressModal from './DeleteAddressModal'
import { Dialog } from '../common/ModalShell'

const isManagerRole = (role) => (role === 'manager' || role === 'co-manager') ? 1 : 0

export default function BranchGrid({
    addresses, fetchError, cupsMap, revenueMap, prevCupsMap = {}, prevRevenueMap = {}, sessionsMap, subscriptionRowsMap = {}, subscriptionStatusMap = {}, subscriptionLoading, statsLoading,
    isStaff, isAdmin, error, setError,
    onSelect, onSelectReport, onSelectHistory, onSelectIngredients, onSelectRecipes,
    onRename, onRemove, onDefaultTemplate, onSupportClick, onToggleDineIn, onSetPrinters,
    warehouseGroups = [], onCreateWarehouseGroup, onRenameWarehouseGroup, onRemoveWarehouseGroup, onSetAddressGroup,
}) {
    // Which per-card sub-modal (rename/delete/backup/wipe/group/printers) is open, and for which
    // address. Layers ON TOP of expandedActionsId's action-sheet (both can be open at once —
    // "Hủy" inside a sub-modal clears just this, returning to the sheet; X/backdrop clears
    // both). Mỗi modal tự quản lý form state riêng (xem RenameAddressModal, PrinterIpModal,
    // WarehouseGroupModal, WipeAddressModal, DeleteAddressModal) — BranchGrid chỉ còn giữ
    // subModal (đang mở modal nào, cho địa chỉ nào) và error dùng chung cho ErrorBanner cuối trang.
    const [subModal, setSubModal] = useState(null) // { type: 'rename'|'printers'|'delete'|'backup'|'wipe'|'group', addressId } | null
    const closeSubModal = () => setSubModal(null)
    const [expandedActionsId, setExpandedActionsId] = useState(null) // which card has the 3-action menu open
    const [actionsTab, setActionsTab] = useState('shortcuts') // tab đang mở trong modal thao tác: 'shortcuts' | 'manage'
    const [actionsScrollFade, setActionsScrollFade] = useState(false) // còn nội dung bên dưới trong modal thao tác?
    const navigate = useNavigate()

    function checkActionsScrollFade(el) {
        if (!el) return
        setActionsScrollFade(el.scrollHeight - el.scrollTop - el.clientHeight > 4)
    }

    // Đóng chỉ sub-modal, quay lại modal thao tác phía sau (nút "Hủy" trong form).
    const cancelSubModal = () => { closeSubModal(); setError('') }
    // Đóng cả sub-modal lẫn modal thao tác (X/backdrop, hoặc submit thành công).
    const closeAll = () => { closeSubModal(); setExpandedActionsId(null) }
    const closeAllWithError = () => { closeAll(); setError('') }

    return (
        <>
            <div className="grid grid-cols-1 gap-3 mb-4">
                {addresses.length === 0 && (
                    fetchError ? (
                        <div className="bg-surface border border-danger/40 rounded-[20px] p-6 text-center">
                            <p className="text-danger text-sm font-bold mb-1">Không tải được danh sách địa chỉ</p>
                            <p className="text-text-secondary text-xs">{fetchError}</p>
                        </div>
                    ) : (
                        <div className="bg-surface border border-border/60 rounded-[20px] p-6 text-center">
                            <Coffee size={24} className="text-text-secondary mx-auto mb-2" />
                            <p className="text-text-secondary text-sm">Chưa có địa chỉ nào. Tạo địa chỉ mới để bắt đầu!</p>
                        </div>
                    )
                )}

                {addresses.map(addr => {
                    const cups = cupsMap[addr.id] || 0
                    const revenue = revenueMap[addr.id] || 0
                    // Số ly hôm qua tính đến cùng giờ này → delta ↑/↓%. 0 (chưa migrate
                    // RPC / hôm qua nghỉ) thì ẩn delta, tránh chia 0.
                    const prevCups = prevCupsMap[addr.id] || 0
                    const cupsDeltaPct = prevCups > 0
                        ? Math.round(((cups - prevCups) / prevCups) * 100)
                        : null
                    const prevRevenue = prevRevenueMap[addr.id] || 0
                    const revenueDeltaPct = prevRevenue > 0
                        ? Math.round(((revenue - prevRevenue) / prevRevenue) * 100)
                        : null
                    const sessionUsers = sessionsMap[addr.id] || []
                    const isEditing = subModal?.type === 'rename' && subModal.addressId === addr.id
                    const isEditingPrinters = subModal?.type === 'printers' && subModal.addressId === addr.id
                    // Stale-while-revalidate: only hide stats on initial load.
                    // Once cupsMap has any value (incl. 0), keep rendering it
                    // during background refreshes (visibilitychange refetch).
                    const hasStats = cupsMap[addr.id] !== undefined

                    return (
                        <div
                            key={addr.id}
                            className="bg-surface border border-border/60 rounded-[20px] overflow-hidden shadow-sm group hover:border-border/80 hover:shadow-[0_4px_20px_rgba(0,0,0,0.15)] transition-all flex flex-col"
                        >
                            <>
                                {/* Main click area — bọc trong div.relative vì nút ⋮ góc phải KHÔNG được lồng
                                    trong button này (HTML không cho button-trong-button). */}
                                <div className="relative flex-1 min-w-0">
                                    <button
                                        onClick={() => onSelect(addr)}
                                        className="group w-full p-3 pr-11 text-left hover:bg-surface-light active:bg-border/30 transition-colors"
                                    >
                                        <div className="mb-1.5">
                                            <span className="text-text font-black text-sm transition-colors line-clamp-2 leading-tight">{addr.name}</span>
                                        </div>

                                        {/* Uniform label:value list — số liệu vận hành */}
                                        <div className="flex flex-col gap-1.5 text-sm">
                                            {/* Skeleton giữ chỗ 2 dòng stats trong lần load đầu — card không còn trống trơn */}
                                            {statsLoading && !hasStats && (
                                                <>
                                                    <Skeleton className="h-4 w-32 rounded-md" />
                                                    <Skeleton className="h-4 w-44 rounded-md" />
                                                </>
                                            )}
                                            {/* Mỗi người đang trong ca một dòng — nhãn theo vai trò, quản lý trước */}
                                            {hasStats && [...sessionUsers]
                                                .sort((a, b) => isManagerRole(b.role) - isManagerRole(a.role))
                                                .map((u, i) => (
                                                    <div key={i} className="flex items-baseline gap-1.5 min-w-0">
                                                        <span className="text-text-secondary shrink-0">{isManagerRole(u.role) ? 'Quản lý:' : 'Nhân viên:'}</span>
                                                        <span className="text-text truncate">{u.name}</span>
                                                    </div>
                                                ))}
                                            {hasStats && (
                                                <>
                                                    <div className="flex items-baseline gap-1.5">
                                                        <span className="text-text-secondary">Hôm nay bán:</span>
                                                        <span className="text-text">{cups} ly</span>
                                                        {cupsDeltaPct !== null && cupsDeltaPct !== 0 && (
                                                            <span
                                                                title="So với hôm qua cùng giờ"
                                                                className={`text-[12px] font-bold tabular-nums ${cupsDeltaPct > 0 ? 'text-success' : 'text-danger'}`}
                                                            >
                                                                {cupsDeltaPct > 0 ? '↑' : '↓'}{Math.abs(cupsDeltaPct)}%
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="flex items-baseline gap-1.5">
                                                        <span className="text-text-secondary">Tổng doanh thu:</span>
                                                        <span className="text-text">{formatVND(revenue)}</span>
                                                        {revenueDeltaPct !== null && revenueDeltaPct !== 0 && (
                                                            <span
                                                                title="So với hôm qua cùng giờ"
                                                                className={`text-[12px] font-bold tabular-nums ${revenueDeltaPct > 0 ? 'text-success' : 'text-danger'}`}
                                                            >
                                                                {revenueDeltaPct > 0 ? '↑' : '↓'}{Math.abs(revenueDeltaPct)}%
                                                            </span>
                                                        )}
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    </button>

                                    {/* Góc trên phải: manager bấm mở thẳng modal Lối tắt/Quản lý. Staff không có
                                        quyền vào modal đó nên vẫn giữ chevron làm tín hiệu "bấm card để vào quán".
                                        shadow-sm + before:-inset-2 = nổi khối hơn nền card + vùng bấm vô hình
                                        44px (chuẩn touch target tối thiểu) dù hình tròn hiển thị chỉ 28px. */}
                                    {!isStaff ? (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setExpandedActionsId(addr.id); setActionsTab('shortcuts') }}
                                            className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center rounded-full bg-surface-light border border-border/50 shadow-sm text-text-secondary hover:text-text hover:bg-border/40 active:scale-95 transition-all before:absolute before:-inset-2 before:content-['']"
                                            title="Lối tắt & quản lý"
                                            aria-label="Mở menu lối tắt và quản lý"
                                        >
                                            <MoreVertical size={16} />
                                        </button>
                                    ) : (
                                        <ChevronRight size={18} strokeWidth={2.5} className="pointer-events-none absolute top-3.5 right-3 text-text-secondary" />
                                    )}
                                </div>

                                {/* Footer: trạng thái gói (mọi role) — menu thao tác đã chuyển lên nút ⋮ góc trên.
                                    px-3 khớp đúng p-3 của header phía trên → "Đã đăng ký" thẳng hàng với tên quán. */}
                                <div className="border-t border-border/40 px-3 py-2">
                                    <div className="flex items-center">
                                        {/* Trạng thái gói — tự ẩn khi monetization OFF (badge return null) */}
                                        <SubscriptionBadge
                                            addressId={addr.id}
                                            rows={subscriptionRowsMap[addr.id]}
                                            pending={subscriptionStatusMap[addr.id] === 'pending'}
                                            hasActivity={cups > 0 || revenue > 0}
                                            loading={subscriptionLoading || !hasStats}
                                            onRenewClick={() => navigate('/subscription', {
                                                state: { preselectAddressId: addr.id, from: '/addresses' },
                                            })}
                                        />
                                    </div>
                                </div>
                            </>

                            {/* Modal thao tác — Lối tắt (pill grid, điều hướng) tách riêng khỏi Quản lý (list, sửa/xoá địa chỉ). */}
                            {expandedActionsId === addr.id && (
                                <Dialog
                                    onClose={() => setExpandedActionsId(null)}
                                    panelClassName="w-full max-w-sm mx-4 my-4 bg-surface border border-border/60 rounded-[24px] shadow-2xl overflow-hidden max-h-[calc(100dvh-2rem)] flex flex-col"
                                >
                                        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border/40 shrink-0">
                                            <p className="text-text font-black text-sm leading-none truncate pr-2">{addr.name}</p>
                                            <button
                                                onClick={() => setExpandedActionsId(null)}
                                                className="p-1.5 text-text-secondary hover:text-text transition-colors rounded-lg hover:bg-surface-light shrink-0"
                                            >
                                                <X size={16} />
                                            </button>
                                        </div>
                                        {!isStaff && (
                                            <div className="flex gap-1.5 px-3 pt-3 pb-2 shrink-0">
                                                <button
                                                    onClick={() => setActionsTab('shortcuts')}
                                                    className={`flex-1 py-2 rounded-[10px] text-xs font-black uppercase tracking-wider transition-colors ${actionsTab === 'shortcuts' ? 'bg-primary/10 text-primary' : 'bg-surface-light text-text-secondary hover:text-text'}`}
                                                >
                                                    Lối tắt
                                                </button>
                                                <button
                                                    onClick={() => setActionsTab('manage')}
                                                    className={`flex-1 py-2 rounded-[10px] text-xs font-black uppercase tracking-wider transition-colors ${actionsTab === 'manage' ? 'bg-primary/10 text-primary' : 'bg-surface-light text-text-secondary hover:text-text'}`}
                                                >
                                                    Quản lý
                                                </button>
                                            </div>
                                        )}
                                        <div
                                            className="overflow-y-auto"
                                            ref={checkActionsScrollFade}
                                            onScroll={(e) => checkActionsScrollFade(e.currentTarget)}
                                        >
                                            {!isStaff && actionsTab === 'shortcuts' && (
                                                <div className="px-3 pt-3 pb-5 flex flex-col gap-4">
                                                    <div>
                                                        <p className="px-1 pb-2 text-[10px] font-black uppercase tracking-wider text-text-secondary">Nhật ký</p>
                                                        <div className="grid grid-cols-2 gap-2">
                                                            <ActionPill
                                                                icon={<Banknote size={16} />}
                                                                label="Thu nhập"
                                                                tone="primary"
                                                                onClick={() => { onSelectHistory?.(addr, 'orders'); setExpandedActionsId(null) }}
                                                            />
                                                            <ActionPill
                                                                icon={<Receipt size={16} />}
                                                                label="Chi phí"
                                                                tone="primary"
                                                                onClick={() => { onSelectHistory?.(addr, 'expense'); setExpandedActionsId(null) }}
                                                            />
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <p className="px-1 pb-2 text-[10px] font-black uppercase tracking-wider text-text-secondary">Báo cáo</p>
                                                        <div className="grid grid-cols-2 gap-2">
                                                            <ActionPill
                                                                icon={<Wallet size={16} />}
                                                                label="Dòng tiền"
                                                                tone="success"
                                                                className="col-span-2"
                                                                onClick={() => { onSelectReport?.(addr, 'cashflow'); setExpandedActionsId(null) }}
                                                            />
                                                            <ActionPill
                                                                icon={<TrendingUp size={16} />}
                                                                label="Lợi nhuận"
                                                                tone="success"
                                                                onClick={() => { onSelectReport?.(addr, 'profit'); setExpandedActionsId(null) }}
                                                            />
                                                            <ActionPill
                                                                icon={<Boxes size={16} />}
                                                                label="Tồn quầy"
                                                                tone="warning"
                                                                onClick={() => { onSelectReport?.(addr, 'inventory'); setExpandedActionsId(null) }}
                                                            />
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <p className="px-1 pb-2 text-[10px] font-black uppercase tracking-wider text-text-secondary">Nguyên vật liệu</p>
                                                        <div className="grid grid-cols-2 gap-2">
                                                            <ActionPill
                                                                icon={<Warehouse size={16} />}
                                                                label="Kho chung"
                                                                tone="warning"
                                                                onClick={() => setSubModal({ type: 'group', addressId: addr.id })}
                                                            />
                                                            <ActionPill
                                                                icon={<ChefHat size={16} />}
                                                                label="Công thức"
                                                                tone="primary"
                                                                onClick={() => { onSelectRecipes?.(addr); setExpandedActionsId(null) }}
                                                            />
                                                            <ActionPill
                                                                icon={<Package size={16} />}
                                                                label="Nguyên liệu"
                                                                tone="primary"
                                                                onClick={() => { onSelectIngredients?.(addr); setExpandedActionsId(null) }}
                                                            />
                                                            <ActionPill
                                                                icon={<Box size={16} />}
                                                                label="Bao bì"
                                                                tone="warning"
                                                                onClick={() => { onSelectIngredients?.(addr, 'packaging'); setExpandedActionsId(null) }}
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            )}

                                            {actionsTab === 'manage' && (
                                            <div className="px-3 pt-3 pb-5">
                                                <div className="grid grid-cols-2 gap-2">
                                                    <ActionPill
                                                        icon={<ClipboardCopy size={16} />}
                                                        label="Nhân bản"
                                                        tone="primary"
                                                        onClick={() => setSubModal({ type: 'backup', addressId: addr.id })}
                                                    />
                                                    <ActionPill
                                                        icon={<Pencil size={16} />}
                                                        label="Đổi tên"
                                                        tone="primary"
                                                        onClick={() => { setSubModal({ type: 'rename', addressId: addr.id }); setError('') }}
                                                    />
                                                    {/* POS của địa chỉ này gộp nhiều ly thành 1 đơn + có nút Thanh toán
                                                        thay vì 1-chạm-1-đơn. Bật/tắt ngay, không cần modal xác nhận:
                                                        đảo lại chỉ là một cú chạm nữa và không đụng dữ liệu đã ghi. */}
                                                    <ActionPill
                                                        icon={<Armchair size={16} />}
                                                        label={addr.dine_in ? 'Bàn ngồi: Bật' : 'Bàn ngồi: Tắt'}
                                                        tone={addr.dine_in ? 'success' : 'primary'}
                                                        onClick={async () => {
                                                            setError('')
                                                            try { await onToggleDineIn?.(addr.id, !addr.dine_in) }
                                                            catch (err) { setError(err.message || 'Không thể đổi chế độ bán') }
                                                        }}
                                                    />
                                                    {/* Chỉ dùng cho app native (Capacitor) — máy in ESC/POS qua mạng, xem
                                                        escposBitmap.js. Web bỏ qua 2 cột này, vẫn window.print() như cũ. */}
                                                    <ActionPill
                                                        icon={<Printer size={16} />}
                                                        label="Máy in"
                                                        tone={addr.counter_printer_ip || addr.kitchen_printer_ip ? 'success' : 'primary'}
                                                        onClick={() => { setSubModal({ type: 'printers', addressId: addr.id }); setError('') }}
                                                    />
                                                    {isAdmin && (
                                                        <ActionPill
                                                            icon={<Eraser size={16} />}
                                                            label="Reset dữ liệu"
                                                            tone="danger"
                                                            onClick={() => { setSubModal({ type: 'wipe', addressId: addr.id }); setError('') }}
                                                        />
                                                    )}
                                                    <ActionPill
                                                        icon={<Trash2 size={16} />}
                                                        label="Xóa địa chỉ"
                                                        tone="danger"
                                                        onClick={() => { setSubModal({ type: 'delete', addressId: addr.id }); setError('') }}
                                                    />
                                                </div>
                                            </div>
                                            )}
                                        </div>
                                        {actionsScrollFade && (
                                            <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-surface to-transparent" />
                                        )}
                                </Dialog>
                            )}

                            {isEditing && (
                                <RenameAddressModal
                                    addr={addr}
                                    onRename={onRename}
                                    onCancel={cancelSubModal}
                                    onClose={closeAllWithError}
                                    onSuccess={closeAll}
                                    setError={setError}
                                />
                            )}

                            {isEditingPrinters && (
                                <PrinterIpModal
                                    addr={addr}
                                    onSetPrinters={onSetPrinters}
                                    onCancel={cancelSubModal}
                                    onClose={closeAllWithError}
                                    onSuccess={closeAll}
                                    setError={setError}
                                />
                            )}

                            {subModal?.type === 'group' && subModal.addressId === addr.id && (
                                <WarehouseGroupModal
                                    addr={addr}
                                    addresses={addresses}
                                    warehouseGroups={warehouseGroups}
                                    onCreateWarehouseGroup={onCreateWarehouseGroup}
                                    onRenameWarehouseGroup={onRenameWarehouseGroup}
                                    onRemoveWarehouseGroup={onRemoveWarehouseGroup}
                                    onSetAddressGroup={onSetAddressGroup}
                                    onClose={closeAll}
                                />
                            )}

                            {/* Modal sao lưu — "Hủy" quay lại modal thao tác (expandedActionsId giữ nguyên), X mới thoát hẳn. */}
                            {subModal?.type === 'backup' && subModal.addressId === addr.id && (
                                <BackupModal
                                    sourceAddress={addr}
                                    onClose={closeAll}
                                    onBack={() => closeSubModal()}
                                />
                            )}

                            {subModal?.type === 'wipe' && subModal.addressId === addr.id && (
                                <WipeAddressModal
                                    addr={addr}
                                    onCancel={cancelSubModal}
                                    onClose={closeAllWithError}
                                    error={error}
                                    setError={setError}
                                />
                            )}

                            {subModal?.type === 'delete' && subModal.addressId === addr.id && (
                                <DeleteAddressModal
                                    addr={addr}
                                    addresses={addresses}
                                    onRemove={onRemove}
                                    onCancel={cancelSubModal}
                                    onClose={closeAllWithError}
                                    onSuccess={closeAll}
                                    error={error}
                                    setError={setError}
                                />
                            )}
                        </div>
                    )
                })}
                {/* Admin: Mẫu mặc định card */}
                {isAdmin && (
                    <button
                        onClick={onDefaultTemplate}
                        className="bg-surface border border-dashed border-border/80 rounded-[20px] overflow-hidden shadow-sm flex flex-col items-center justify-center p-4 gap-2 hover:bg-surface-light hover:border-primary/30 active:bg-border/30 transition-all min-h-[100px]"
                    >
                        <FileText size={20} className="text-text-secondary" />
                        <span className="text-text-secondary font-bold text-sm">Mẫu mặc định</span>
                    </button>
                )}

                {/* Hỗ trợ & Góp ý */}
                <div className="flex flex-col items-center justify-center p-3">
                    <button
                        onClick={onSupportClick}
                        className="flex items-center gap-2.5 px-5 py-2.5 rounded-full bg-surface-light border border-border/50 hover:border-primary/40 hover:bg-primary/5 transition-all duration-300 cursor-pointer"
                    >
                        <span className="text-[10px] font-black uppercase tracking-[0.15em] whitespace-nowrap mt-[1px] text-primary">
                            Bạn cần hỗ trợ / có góp ý?
                        </span>
                    </button>
                </div>
            </div>

            <ErrorBanner message={error} small className="mb-3" />
        </>
    )
}

// Pill hành động — 2 cột, icon nhỏ + label 1 dòng. Dùng chung cho "Lối tắt" (điều hướng)
// và "Quản lý" (sửa/xoá địa chỉ), tone danger cho các thao tác nguy hiểm.
const PILL_TONES = {
    primary: 'bg-primary/10 text-primary',
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    danger: 'bg-danger/10 text-danger',
}
function ActionPill({ icon, label, tone = 'primary', onClick, className = '' }) {
    return (
        <button
            onClick={onClick}
            className={`flex flex-col items-center gap-1.5 px-2 py-3 rounded-[14px] bg-surface-light border border-border/50 hover:border-primary/40 hover:bg-border/20 active:scale-95 transition-all text-center min-w-0 ${className}`}
        >
            <span className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${PILL_TONES[tone]}`}>
                {icon}
            </span>
            <span className={`text-[10px] font-bold uppercase tracking-wider leading-tight ${tone === 'danger' ? 'text-danger' : 'text-text'}`}>{label}</span>
        </button>
    )
}
