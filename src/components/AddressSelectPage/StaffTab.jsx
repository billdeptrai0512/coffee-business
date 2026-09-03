import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Users, Loader, MoreVertical, ArrowUp, ArrowDown, Trash2, X, Check, KeyRound, Store, LayoutDashboard, ChevronRight } from 'lucide-react'
import ErrorBanner from '../common/ErrorBanner'
import Skeleton from '../common/Skeleton'
import { BottomSheet } from '../common/ModalShell'
import { useAuth } from '../../contexts/AuthContext'
import { capitalizeWords } from '../../utils'
import { dateFullVN } from '../../utils/dateVN'
import { fetchStaffRevokedAddresses, fetchTeamRevokedAddresses, fetchStaffLastLogins, setStaffAddressAccess, setStaffPassword } from '../../services/authService'

// "Đăng nhập gần nhất: 5 phút trước" / "... 3 giờ trước" / "... 2 ngày trước" / ngày cụ thể nếu đã lâu.
function formatLastLogin(iso) {
    if (!iso) return 'Chưa đăng nhập'
    const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
    const rel = minutes < 1 ? 'Vừa xong'
        : minutes < 60 ? `${minutes} phút trước`
        : minutes < 1440 ? `${Math.floor(minutes / 60)} giờ trước`
        : minutes < 43200 ? `${Math.floor(minutes / 1440)} ngày trước`
        : dateFullVN(new Date(iso))
    return `Truy cập lần cuối: ${rel}`
}

// Full management sheet for one member: rename, change role, reset password,
// per-branch visibility, and remove. Each destructive action behind a confirm tap.
function MemberPanel({ member, addresses, initialRevoked, onRevokedChange, onRename, onSetRole, onRemove, onClose }) {
    const isStaff = member.role === 'staff'

    // Name — savedName tracks the last committed value (member prop is stale until reopen).
    const [nameDraft, setNameDraft] = useState(member.name)
    const [savedName, setSavedName] = useState(member.name)
    const [savingName, setSavingName] = useState(false)
    const [nameSaved, setNameSaved] = useState(false)
    const [nameErr, setNameErr] = useState('')

    // Role
    const [roleBusy, setRoleBusy] = useState(false)
    const [roleErr, setRoleErr] = useState('')

    // Password
    const [pwDraft, setPwDraft] = useState('')
    const [savingPw, setSavingPw] = useState(false)
    const [pwMsg, setPwMsg] = useState('') // success text
    const [pwErr, setPwErr] = useState('')

    // Branch visibility (staff + co-manager) — revoked is the set of BLOCKED address ids.
    // Seeded from the team prefetch (instant); only falls back to a per-open fetch when
    // the prefetch hasn't landed yet.
    const [revoked, setRevoked] = useState(initialRevoked ?? null) // null = loading
    const [accessErr, setAccessErr] = useState('')
    const [togglingId, setTogglingId] = useState(null)

    // Remove
    const [confirmRemove, setConfirmRemove] = useState(false)
    const [removing, setRemoving] = useState(false)
    const [removeErr, setRemoveErr] = useState('')

    const busy = savingName || roleBusy || savingPw || removing

    // Password requirement depends on the member's current role: staff = 6-digit PIN,
    // co-manager (role 'manager') = ≥8 chars with a letter and a number (mirrors signup).
    const pwValid = isStaff
        ? /^\d{6}$/.test(pwDraft)
        : pwDraft.length >= 8 && /[a-zA-Z]/.test(pwDraft) && /\d/.test(pwDraft)

    const nameDirty = nameDraft.trim() !== '' && nameDraft.trim() !== savedName

    useEffect(() => {
        if (initialRevoked) return // already seeded from the team prefetch
        let cancelled = false
        fetchStaffRevokedAddresses(member.id).then(ids => {
            if (!cancelled) setRevoked(new Set(ids))
        })
        return () => { cancelled = true }
    }, [member.id, initialRevoked])

    async function handleSaveName() {
        const name = nameDraft.trim()
        if (!name || name === savedName) return
        setSavingName(true); setNameErr(''); setNameSaved(false)
        try {
            await onRename(member.id, name)
            setSavedName(name)
            setNameSaved(true)
            setTimeout(() => setNameSaved(false), 1500)
        } catch (e) {
            setNameErr(e?.message || 'Không lưu được tên')
        } finally {
            setSavingName(false)
        }
    }

    async function handleSetRole() {
        setRoleBusy(true); setRoleErr('')
        try {
            await onSetRole(member.id, isStaff ? 'manager' : 'staff')
            onClose()
        } catch (e) {
            setRoleErr(e?.message || 'Không đổi được vai trò')
            setRoleBusy(false)
        }
    }

    async function handleSetPassword() {
        if (!pwValid) return
        setSavingPw(true); setPwErr(''); setPwMsg('')
        try {
            await setStaffPassword(member.id, pwDraft)
            setPwMsg('✓ Đã đổi mật khẩu')
            setPwDraft('')
            setTimeout(() => setPwMsg(''), 2000)
        } catch (e) {
            setPwErr(e?.message || 'Không đổi được mật khẩu')
        } finally {
            setSavingPw(false)
        }
    }

    async function handleToggleAccess(addrId) {
        if (!revoked) return
        const allowed = revoked.has(addrId) // currently revoked → this tap allows it
        const next = new Set(revoked)
        allowed ? next.delete(addrId) : next.add(addrId)
        setTogglingId(addrId); setAccessErr('')
        setRevoked(next); onRevokedChange?.(member.id, next) // optimistic + keep parent cache in sync
        try {
            await setStaffAddressAccess(member.id, addrId, allowed)
        } catch (e) {
            setRevoked(revoked); onRevokedChange?.(member.id, revoked) // revert
            setAccessErr(e?.message || 'Không đổi được quyền chi nhánh')
        } finally {
            setTogglingId(null)
        }
    }

    async function handleRemove() {
        setRemoving(true); setRemoveErr('')
        try {
            await onRemove(member.id)
            onClose()
        } catch (e) {
            setRemoveErr(e?.message || 'Không xoá được')
            setRemoving(false)
        }
    }

    return (
        <BottomSheet
            onClose={() => !busy && onClose()}
            panelClassName="w-full max-w-lg bg-surface rounded-t-[24px] border-t border-border/60 shadow-2xl p-5 pb-8 flex flex-col gap-5 animate-slide-up max-h-[88vh] overflow-y-auto overscroll-contain hide-scrollbar"
        >
                <div className="flex items-center justify-between">
                    <span className="text-[16px] font-black text-text truncate">Quản lý nhân sự</span>
                    <button
                        onClick={onClose}
                        disabled={busy}
                        className="w-8 h-8 flex items-center justify-center rounded-full bg-surface-light border border-border/60 text-text-secondary hover:text-text transition-all disabled:opacity-50 shrink-0"
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* ── Họ tên ── */}
                <div className="flex flex-col gap-1.5">
                    <div className="relative">
                        <input
                            id="member-name"
                            type="text"
                            value={nameDraft}
                            onChange={e => setNameDraft(capitalizeWords(e.target.value))}
                            onKeyDown={e => { if (e.key === 'Enter' && nameDirty) handleSaveName() }}
                            placeholder=" "
                            className="peer w-full bg-bg border border-border/60 rounded-[12px] pl-3 pr-[68px] py-2.5 text-[14px] font-bold text-text focus:outline-none focus:border-primary/40 transition-colors"
                        />
                        <label
                            htmlFor="member-name"
                            className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary text-xs font-black uppercase tracking-wide transition-all duration-150 pointer-events-none
                                peer-focus:top-0 peer-focus:text-[10px] peer-focus:px-1 peer-focus:bg-surface peer-focus:text-primary
                                peer-[:not(:placeholder-shown)]:top-0 peer-[:not(:placeholder-shown)]:text-[10px] peer-[:not(:placeholder-shown)]:px-1 peer-[:not(:placeholder-shown)]:bg-surface"
                        >
                            Họ tên
                        </label>
                        <button
                            onClick={handleSaveName}
                            disabled={savingName || !nameDirty}
                            className={`absolute right-1.5 top-1/2 -translate-y-1/2 px-3 py-1.5 rounded-[10px] text-[12px] font-black uppercase flex items-center gap-1.5 transition-all ${nameDirty && !savingName
                                ? 'bg-primary text-bg hover:bg-primary/90'
                                : 'bg-surface-light text-text-secondary/50 cursor-not-allowed'}`}
                        >
                            {savingName ? <Loader size={12} className="animate-spin" /> : nameSaved ? <Check size={13} /> : 'Lưu'}
                        </button>
                    </div>
                    <p className="text-text-secondary/60 text-[11px] px-1">Tự viết hoa chữ đầu mỗi từ</p>
                    <ErrorBanner message={nameErr} small />
                </div>

                {/* ── Tài khoản ── */}
                <div className="flex flex-col gap-1.5">
                    <label className="text-[11px] font-black uppercase tracking-wide text-text-secondary">Tài khoản</label>
                    <div className="bg-bg border border-border/40 rounded-[12px] px-3 py-2.5 text-[14px] font-bold text-text-secondary">
                        {member.username || <span className="italic font-medium opacity-60">chưa có tên đăng nhập</span>}
                    </div>
                    {member.username && (
                        <>
                            <div className="relative mt-1">
                                <input
                                    id="member-password"
                                    type="text"
                                    value={pwDraft}
                                    onChange={e => setPwDraft(isStaff ? e.target.value.replace(/\D/g, '') : e.target.value)}
                                    autoComplete="new-password"
                                    inputMode={isStaff ? 'numeric' : 'text'}
                                    maxLength={isStaff ? 6 : undefined}
                                    onKeyDown={e => { if (e.key === 'Enter' && pwValid) handleSetPassword() }}
                                    placeholder=" "
                                    className="peer w-full bg-bg border border-border/60 rounded-[12px] pl-3 pr-[82px] py-2.5 text-[14px] font-medium text-text focus:outline-none focus:border-primary/40 transition-colors"
                                />
                                <label
                                    htmlFor="member-password"
                                    className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary/70 text-xs font-black uppercase tracking-wide transition-all duration-150 pointer-events-none
                                        peer-focus:top-0 peer-focus:text-[10px] peer-focus:px-1 peer-focus:bg-surface peer-focus:text-primary
                                        peer-[:not(:placeholder-shown)]:top-0 peer-[:not(:placeholder-shown)]:text-[10px] peer-[:not(:placeholder-shown)]:px-1 peer-[:not(:placeholder-shown)]:bg-surface"
                                >
                                    Mật khẩu mới
                                </label>
                                <button
                                    onClick={handleSetPassword}
                                    disabled={savingPw || !pwValid}
                                    className={`absolute right-1.5 top-1/2 -translate-y-1/2 px-3 py-1.5 rounded-[10px] text-[12px] font-black uppercase flex items-center gap-1.5 transition-all ${pwValid && !savingPw
                                        ? 'bg-primary text-bg hover:bg-primary/90'
                                        : 'bg-surface-light text-text-secondary/50 cursor-not-allowed'}`}
                                >
                                    {savingPw ? <Loader size={12} className="animate-spin" /> : <KeyRound size={13} />}
                                    Đổi
                                </button>
                            </div>
                            <p className="text-text-secondary/60 text-[11px] px-1">
                                {isStaff ? 'Mã PIN gồm 6 chữ số' : 'Tối thiểu 8 ký tự, gồm cả chữ và số'}
                            </p>
                            {pwMsg && <p className="text-success text-[12px] font-bold px-1">{pwMsg}</p>}
                            <ErrorBanner message={pwErr} small />
                        </>
                    )}
                </div>

                {/* ── Chi nhánh được xem (nhân viên + co-manager) ── */}
                <div className="flex flex-col gap-1.5">
                        <label className="text-[11px] font-black uppercase tracking-wide text-text-secondary flex items-center gap-1.5">
                            <Store size={13} /> Chi nhánh được xem
                        </label>
                        {addresses.length === 0 ? (
                            <p className="text-text-secondary/70 text-[12px] px-1">Chưa có chi nhánh nào</p>
                        ) : (
                            <div className="flex flex-col gap-1.5">
                                {addresses.map(addr => {
                                    // Render rows instantly from the in-memory address list; the toggle
                                    // slot shows a spinner until revoked state loads (or while toggling),
                                    // so the panel never jumps and all toggles resolve together.
                                    const loading = revoked === null || togglingId === addr.id
                                    const allowed = revoked ? !revoked.has(addr.id) : true
                                    return (
                                        <button
                                            key={addr.id}
                                            onClick={() => handleToggleAccess(addr.id)}
                                            disabled={loading}
                                            className="flex items-center gap-2.5 bg-bg border border-border/40 rounded-[12px] px-3 py-2.5 text-left hover:bg-surface-light transition-colors disabled:hover:bg-bg"
                                        >
                                            <span className="flex-1 text-[14px] font-bold text-text truncate">{addr.name}</span>
                                            {loading ? (
                                                <Loader size={15} className="animate-spin text-text-secondary/50 shrink-0" />
                                            ) : (
                                                <span className={`w-9 h-5 rounded-full p-0.5 flex transition-colors shrink-0 ${allowed ? 'bg-primary justify-end' : 'bg-border justify-start'}`}>
                                                    <span className="w-4 h-4 rounded-full bg-white" />
                                                </span>
                                            )}
                                        </button>
                                    )
                                })}
                            </div>
                        )}
                        <ErrorBanner message={accessErr} small />
                    </div>

                {/* ── Vai trò + Xoá ── */}
                <div className="flex flex-col gap-2">
                    <button
                        onClick={handleSetRole}
                        disabled={roleBusy}
                        className="w-full py-3 px-3 rounded-[12px] bg-surface-light border border-border/60 text-text text-[14px] font-bold hover:bg-bg transition-colors flex items-center gap-2.5 disabled:opacity-50"
                    >
                        {roleBusy
                            ? <Loader size={16} className="animate-spin text-primary" />
                            : isStaff ? <ArrowUp size={16} className="text-primary" /> : <ArrowDown size={16} className="text-primary" />}
                        {isStaff ? 'Thăng lên quản lý' : 'Hạ xuống nhân viên'}
                    </button>
                    <ErrorBanner message={roleErr} small />

                    {confirmRemove ? (
                        <div className="flex gap-2">
                            <button
                                onClick={() => setConfirmRemove(false)}
                                disabled={removing}
                                className="flex-1 py-3 rounded-[12px] bg-surface-light border border-border/60 text-text text-[14px] font-black hover:bg-bg transition-colors disabled:opacity-50 uppercase"
                            >
                                Huỷ
                            </button>
                            <button
                                onClick={handleRemove}
                                disabled={removing}
                                className="flex-1 py-3 rounded-[12px] bg-danger text-white text-[14px] font-black hover:bg-danger/90 transition-colors disabled:opacity-50 uppercase flex items-center justify-center gap-1.5"
                            >
                                {removing ? <><Loader size={13} className="animate-spin" /> Đang xoá...</> : 'Xác nhận xoá'}
                            </button>
                        </div>
                    ) : (
                        <button
                            onClick={() => setConfirmRemove(true)}
                            className="w-full py-3 px-3 rounded-[12px] bg-danger/10 border border-danger/20 text-danger text-[14px] font-bold hover:bg-danger/15 transition-colors flex items-center gap-2.5"
                        >
                            <Trash2 size={16} />
                            Xoá khỏi cửa hàng
                        </button>
                    )}
                    <ErrorBanner message={removeErr} small />
                </div>
        </BottomSheet>
    )
}

export default function StaffTab({
    staffList, staffLoading, addresses = [],
    onSetMemberRole, onRemoveMember, onRenameMember,
}) {
    const navigate = useNavigate()
    const { isAdmin } = useAuth()
    const [actionMember, setActionMember] = useState(null)

    // Prefetch the whole team's revoked branches once so opening a panel is instant.
    // Map<userId, Set<addressId>>; null until the first fetch resolves.
    const [revokedByUser, setRevokedByUser] = useState(null)
    const staffIdsKey = staffList.map(m => m.id).join('|')
    useEffect(() => {
        let cancelled = false
        fetchTeamRevokedAddresses().then(rows => {
            if (cancelled) return
            const map = new Map()
            for (const r of rows) {
                if (!map.has(r.user_id)) map.set(r.user_id, new Set())
                map.get(r.user_id).add(r.address_id)
            }
            setRevokedByUser(map)
        })
        return () => { cancelled = true }
    }, [staffIdsKey])

    const handleRevokedChange = useCallback((userId, set) => {
        setRevokedByUser(prev => new Map(prev ?? []).set(userId, set))
    }, [])

    // Prefetch lần đăng nhập gần nhất của cả team, cùng nhịp với revokedByUser.
    const [lastLoginByUser, setLastLoginByUser] = useState(new Map())
    useEffect(() => {
        let cancelled = false
        fetchStaffLastLogins(staffList.map(m => m.id)).then(map => {
            if (!cancelled) setLastLoginByUser(map)
        })
        return () => { cancelled = true }
    }, [staffIdsKey])

    // 1 danh sách gộp, quản lý trước rồi nhân viên.
    const members = [...staffList].sort((a, b) => (b.role === 'manager') - (a.role === 'manager'))

    return (
        <div className="space-y-3">
            {/* Admin-only: tổng quan billing + customer health toàn hệ thống (công tắc thu
                phí + đối soát thanh toán đều nằm trong đó). */}
            {isAdmin && (
                <button
                    onClick={() => navigate('/admin/dashboard')}
                    className="w-full bg-surface border border-border/60 rounded-[20px] p-3 flex items-center gap-3 hover:bg-border/10 active:scale-[0.99] transition-all"
                >
                    <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 bg-primary/10">
                        <LayoutDashboard size={16} className="text-primary" />
                    </div>
                    <span className="flex-1 min-w-0 text-left text-text text-sm font-black">Admin Dashboard</span>
                    <ChevronRight size={16} className="text-text-secondary shrink-0" />
                </button>
            )}

            {/* Đội ngũ — danh sách gộp */}
            <div className="bg-surface border border-border/60 rounded-[20px] overflow-hidden">
                {staffLoading ? (
                    <div className="p-3 flex flex-col gap-2">
                        <Skeleton className="h-12 rounded-[12px]" />
                        <Skeleton className="h-12 rounded-[12px]" />
                    </div>
                ) : members.length === 0 ? (
                    <div className="px-4 py-8 text-center">
                        <Users size={20} className="text-text-secondary/60 mx-auto mb-2" />
                        <p className="text-text-secondary text-sm font-medium">Chưa có thành viên nào</p>
                        <p className="text-text-secondary/70 text-xs mt-0.5">Thêm người mới bằng nút bên dưới</p>
                    </div>
                ) : (
                    <div className="p-3 flex flex-col gap-2">
                        {members.map(member => {
                            const isManager = member.role === 'manager'
                            return (
                                <div key={member.id} className="p-2.5 flex items-center gap-2.5 bg-bg rounded-[12px] border border-border/40">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1.5">
                                            <span className={`text-[10px] font-black uppercase tracking-wide px-2 py-0.5 rounded-full border whitespace-nowrap shrink-0 ${isManager
                                                ? 'bg-blue-500/10 border-blue-500/25 text-blue-500'
                                                : 'bg-primary/10 border-primary/25 text-primary'}`}>
                                                {isManager ? 'Quản lý' : 'Nhân viên'}
                                            </span>
                                            <span className="text-text text-sm font-bold truncate">{member.name}</span>
                                        </div>
                                        <span className="block text-text-secondary text-[11px] truncate mt-1">· {formatLastLogin(lastLoginByUser.get(member.id))}</span>
                                    </div>
                                    <button
                                        onClick={() => setActionMember(member)}
                                        className="w-8 h-8 flex items-center justify-center rounded-full text-text-secondary hover:bg-surface-light hover:text-text active:scale-95 transition-all shrink-0"
                                        title="Tuỳ chọn"
                                    >
                                        <MoreVertical size={16} />
                                    </button>
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>

            {actionMember && (
                <MemberPanel
                    member={actionMember}
                    addresses={addresses}
                    initialRevoked={revokedByUser ? (revokedByUser.get(actionMember.id) ?? new Set()) : null}
                    onRevokedChange={handleRevokedChange}
                    onRename={onRenameMember}
                    onSetRole={onSetMemberRole}
                    onRemove={onRemoveMember}
                    onClose={() => setActionMember(null)}
                />
            )}
        </div>
    )
}
