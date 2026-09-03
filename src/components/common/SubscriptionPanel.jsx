import { useState, useEffect, useRef, useMemo } from 'react'
import { Loader2, CheckCircle2, Copy, Check } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useAddress } from '../../contexts/AddressContext'
import { useAddressStats } from '../../contexts/AddressStatsContext'
import { supabase } from '../../lib/supabaseClient'
import { usePaymentPoll } from '../../hooks/usePaymentPoll'
import { formatVND } from '../../utils'
import { PLAN, ALL_TIER, BANK_INFO, TRIAL_DAYS } from '../../constants/monetization'
import { computeSubscriptionStatus } from '../../utils/subscriptionStatus'
import { dateFullVN } from '../../utils/dateVN'

// Gradient vàng thương hiệu (đồng bộ badge "developed by").
const GOLD = 'linear-gradient(135deg, #f8c577, #f59e0b, #d4882f, #b8732a)'

/**
 * SubscriptionPanel — thân trang đăng ký gói (checkout).
 * 1 gói duy nhất: 888,888đ / 6 tháng / 1 địa chỉ → mở khoá cả 3 view báo cáo.
 * Multi-branch: chọn nhiều chi nhánh → tổng = giá × số chi nhánh.
 *
 * Props: preselectAddressId, onDone
 */
export default function SubscriptionPanel({ preselectAddressId, onDone }) {
    const { isAdmin } = useAuth()
    const { addresses, selectedAddress } = useAddress()
    const { subscriptionRowsMap, subscriptionLoading, refreshSubscriptionStatuses } = useAddressStats()

    const [selectedAddressIds, setSelectedAddressIds] = useState([])

    // Chọn sẵn chi nhánh đang xem (hoặc chi nhánh đầu) — chạy 1 lần khi addresses sẵn sàng.
    // Dùng effect (không phải useState init) vì addresses load bất đồng bộ sau mount.
    const didInit = useRef(false)
    useEffect(() => {
        if (didInit.current || !addresses.length) return
        const want = preselectAddressId || selectedAddress?.id
        const valid = want && addresses.some(a => a.id === want) ? want : addresses[0].id
        setSelectedAddressIds([valid])
        didInit.current = true
    }, [addresses, preselectAddressId, selectedAddress?.id])
    const [isMocking, setIsMocking] = useState(false)
    const [isTrialMock, setIsTrialMock] = useState(false) // Mock cấp trial 7 ngày (khác admin_override 6 tháng)
    const [isResetting, setIsResetting] = useState(false)
    const [confirmReset, setConfirmReset] = useState(false) // 2-step confirm (không dùng window.confirm — bị chặn trong webview)
    const [adminError, setAdminError] = useState(null)
    const [confirmed, setConfirmed] = useState(false)
    const [branchQuery, setBranchQuery] = useState('')
    const [copied, setCopied] = useState(null) // 'stk' | 'noidung' | null
    const [reference, setReference] = useState(null) // mã CK (SP<reference>) từ payment_intent
    const [refError, setRefError] = useState(false)
    const [refRetry, setRefRetry] = useState(0) // tăng → chạy lại effect tạo intent
    const [reviewHold, setReviewHold] = useState(false) // CK sai số tiền → chờ admin duyệt tay

    // valid_to (hạn) hiện tại của TỪNG chi nhánh → vừa hiện chip Đã mở/Chưa mở,
    // vừa tính "hiệu lực đến" sau khi trả (gia hạn nối tiếp). null = chưa có sub active.
    // Derived từ subscriptionRowsMap (AddressStatsContext) — 1 query dùng chung cho
    // cả badge danh sách lẫn panel này, thay vì mỗi nơi tự RPC riêng cho từng chi nhánh.
    const validToByAddr = useMemo(() => Object.fromEntries(
        addresses.map(a => [a.id, computeSubscriptionStatus(subscriptionRowsMap[a.id]).validTo])
    ), [addresses, subscriptionRowsMap])
    const accessLoaded = !subscriptionLoading

    // Xác nhận thanh toán: hiện panel thành công, user tự bấm "Xong" (không auto-redirect).
    // Làm tươi rows/status dùng chung (badge từng card + thứ tự sort + panel này) —
    // dùng cho cả mock trial và poll-while-pending (usePaymentPoll).
    const handleConfirmed = () => {
        refreshSubscriptionStatuses()
        setConfirmed(true)
    }

    // Poll-while-pending (§7.1) — xác nhận thanh toán: poll status của intent đang
    // chờ mỗi 4s, thấy 'paid' → confirm (guard chung `confirmed`). Thay cho realtime
    // (subpay-* channel) — stateless, không tốn quota kết nối realtime ở quy mô lớn,
    // độ trễ vài giây không đáng kể so với chuyển khoản ngân hàng (5-30s).
    // manual_review = đã nhận tiền nhưng sai số tiền → báo user chờ admin (KHÔNG lặng lẽ
    // đổi mã QR mới). Hết hạn/huỷ → tạo intent mới để QR luôn dùng mã còn hiệu lực.
    usePaymentPoll({
        reference,
        enabled: !confirmed && !reviewHold,
        onPaid: handleConfirmed,
        onExpired: (status) => {
            if (status === 'manual_review') setReviewHold(true)
            else setRefRetry(n => n + 1)
        },
    })

    const toggleAddress = (id) => setSelectedAddressIds(prev =>
        prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
    const allAddressesSelected = addresses.length > 0 && selectedAddressIds.length === addresses.length
    const toggleAllAddresses = () =>
        setSelectedAddressIds(allAddressesSelected ? [] : addresses.map(a => a.id))

    // Nhiều chi nhánh → bật search + cuộn nội bộ.
    const manyBranches = addresses.length > 6
    const filteredAddresses = branchQuery.trim()
        ? addresses.filter(a => normalizeText(a.name).includes(normalizeText(branchQuery)))
        : addresses

    // ── Tính tiền: giá cố định × số chi nhánh ────────────────────────────────────
    const addrCount = selectedAddressIds.length
    const total = PLAN.price * addrCount
    const canSubmit = addrCount > 0

    // ── Hiệu lực đến: tính theo quy tắc gia hạn nối tiếp (§4) ─────────────────────
    // Đang có sub active → cộng tiếp sau hạn cũ; chưa có → tính từ hôm nay.
    const newExpiryFor = (addrId) => {
        const today = new Date(); today.setHours(0, 0, 0, 0)
        let from = today
        const vt = validToByAddr[addrId]
        if (vt) {
            const next = new Date(vt + 'T00:00:00'); next.setDate(next.getDate() + 1)
            if (next > today) from = next
        }
        if (isTrialMock) {
            const d = new Date(from); d.setDate(d.getDate() + TRIAL_DAYS)
            return d
        }
        return addMonths(from, PLAN.months)
    }
    // ── Nội dung CK: 'SP' + reference của payment_intent (webhook SePay đối chiếu) ─
    // Tạo intent khi đổi tập chi nhánh / số tiền → reference cố định cho lần CK này.
    const selectedKey = [...selectedAddressIds].sort().join(',')
    useEffect(() => {
        if (addrCount === 0 || total <= 0 || !supabase) { setReference(null); return }
        let cancelled = false
        setRefError(false)
        supabase
            .rpc('create_payment_intent', { p_address_ids: selectedAddressIds, p_months: PLAN.months, p_amount: total })
            .then(({ data, error }) => {
                if (cancelled) return
                setReference(error ? null : data)
                setRefError(!!error)
            })
        return () => { cancelled = true }
    }, [selectedKey, total, refRetry]) // eslint-disable-line react-hooks/exhaustive-deps

    const transferContent = reference ? `SP${reference}` : ''

    // ── QR chuyển khoản (SePay): tự điền số tiền + nội dung ───────────────────────
    const qrUrl = `https://qr.sepay.vn/img?bank=MBBank&acc=${BANK_INFO.accountNumber}&template=&amount=${total}&des=${encodeURIComponent(transferContent)}`

    const copy = async (text, key) => {
        let ok = false
        // Clipboard API: cần secure context (https/localhost) + document focus.
        if (navigator.clipboard && window.isSecureContext) {
            ok = await navigator.clipboard.writeText(text).then(() => true, () => false)
        }
        // Fallback (http/LAN, webview, mất focus): textarea + execCommand.
        if (!ok) {
            const ta = document.createElement('textarea')
            ta.value = text
            ta.style.position = 'fixed'
            ta.style.opacity = '0'
            document.body.appendChild(ta)
            ta.focus(); ta.select()
            try { ok = document.execCommand('copy') } catch { ok = false }
            document.body.removeChild(ta)
        }
        if (ok) {
            setCopied(key)
            setTimeout(() => setCopied(null), 1500)
        }
    }

    const handleMockPayment = async () => {
        if (!canSubmit) return
        setIsMocking(true)
        setAdminError(null)
        try {
            // Cấp trial 7 ngày qua RPC admin_set_subscription (note='trial' → RPC tự dùng
            // 7 ngày cố định, bỏ qua p_months — xem 20260709_admin_mock_trial_grant.sql).
            // Dùng để test flow + cấp lại trial thủ công khi trial tự động bị chặn.
            const { error } = await supabase.rpc('admin_set_subscription', {
                p_address_ids: selectedAddressIds,
                p_modules: [ALL_TIER],
                p_months: 1,
                p_amount_paid: 0,
                p_note: 'trial',
            })
            if (error) throw error
            // Đi cùng đường với webhook thật → hiện panel xác nhận (test được UI success).
            // handleConfirmed() tự invalidate cache + refresh sort bên dưới.
            setIsTrialMock(true)
            setIsMocking(false)
            handleConfirmed()
        } catch (err) {
            setAdminError('Lỗi: ' + err.message)
            setIsMocking(false)
        }
    }

    // Reset (dev/test): xoá sub của các chi nhánh đã chọn → về lại trạng thái khoá.
    // 2-step confirm inline: window.confirm bị chặn/treo trong webview & preview panel.
    const handleReset = async () => {
        if (!selectedAddressIds.length || isResetting) return
        if (!confirmReset) {
            setConfirmReset(true)
            setTimeout(() => setConfirmReset(false), 4000) // tự huỷ sau 4s nếu không bấm tiếp
            return
        }
        setConfirmReset(false)
        setIsResetting(true)
        setAdminError(null)
        try {
            const { error } = await supabase.rpc('admin_reset_subscription', {
                p_address_ids: selectedAddressIds,
                p_modules: null,   // null = xoá hết
            })
            if (error) throw error
            refreshSubscriptionStatuses()
            if (onDone) onDone()
            else window.location.reload()
        } catch (err) {
            setAdminError('Lỗi: ' + err.message)
            setIsResetting(false)
        }
    }

    // ── Panel xác nhận thanh toán thành công ─────────────────────────────────────
    // newExpiryFor tính từ validToByAddr TRƯỚC khi trả (gia hạn nối tiếp §4) = đúng
    // hạn mới sau khi webhook insert sub. User tự bấm "Xong", không auto-redirect.
    if (confirmed) {
        return (
            <div className="flex flex-col gap-4 animate-fade-in pt-4">
                <div className="rounded-[18px] border border-success/30 bg-success-soft/40 px-4 py-7 flex flex-col items-center gap-3 text-center">
                    <CheckCircle2 size={52} strokeWidth={1.6} className="text-success animate-scale-up" />
                    <div>
                        <p className="text-[16px] font-black text-text">{isTrialMock ? 'Đã cấp trial' : 'Thanh toán thành công'}</p>
                        <p className="text-[12px] text-text-secondary mt-1">
                            {isTrialMock
                                ? `Trial ${TRIAL_DAYS} ngày · ${addrCount} chi nhánh`
                                : `Đã mở khoá ${addrCount} chi nhánh · ${formatVND(total)}`}
                        </p>
                    </div>
                </div>

                {/* Mỗi chi nhánh 1 card xác nhận — khớp format panel Thông tin */}
                {selectedAddressIds.map(id => (
                    <div key={id} className="rounded-[18px] border border-border/60 bg-surface px-3.5 py-3 flex flex-col gap-2">
                        <CopyRow label="Địa chỉ" value={addresses.find(a => a.id === id)?.name || '—'} />
                        <CopyRow label="Thời hạn" value={isTrialMock ? `${TRIAL_DAYS} ngày` : PLAN.periodLabel} />
                        <CopyRow label="Sử dụng đến" value={dateFullVN(newExpiryFor(id))} />
                    </div>
                ))}

                <button
                    onClick={() => { onDone ? onDone() : window.location.reload() }}
                    className="w-full py-3 rounded-[12px] bg-primary text-bg text-[14px] font-black uppercase hover:bg-primary/90 active:scale-[0.98] transition-all"
                >
                    Xong
                </button>
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-5 animate-fade-in">
            {/* ── Chi nhánh (áp dụng ở đâu) ───────────────────────────────────────── */}
            <section className="flex flex-col gap-2.5">
                <SectionHeader
                    title="Địa chỉ"
                    hint={addresses.length > 0 ? `${addrCount}/${addresses.length}` : undefined}
                    action={addresses.length > 1 && (
                        <button onClick={toggleAllAddresses} className="text-[11px] font-black text-primary uppercase tracking-wide whitespace-nowrap">
                            {allAddressesSelected ? 'Bỏ tất cả' : 'Tất cả'}
                        </button>
                    )}
                />

                {/* Search — chỉ khi nhiều chi nhánh */}
                {manyBranches && (
                    <input
                        type="text"
                        value={branchQuery}
                        onChange={e => setBranchQuery(e.target.value)}
                        placeholder="Tìm chi nhánh…"
                        className="w-full px-3 py-2 rounded-[10px] bg-surface-light border border-border/60 text-text text-[13px] placeholder:text-text-dim focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
                    />
                )}

                <div className={`flex flex-col gap-1.5 ${manyBranches ? 'max-h-[240px] overflow-y-auto pr-0.5' : ''}`}>
                    {filteredAddresses.map(addr => {
                        const active = selectedAddressIds.includes(addr.id)
                        const hasAccess = !!validToByAddr[addr.id]
                        const statusChip = !accessLoaded
                            ? null
                            : hasAccess
                                ? <span className="shrink-0 text-[9px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-success-soft/60 text-success">Đã mở</span>
                                : <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-surface text-text-dim">Chưa mở</span>
                        return (
                            <button
                                key={addr.id}
                                onClick={() => toggleAddress(addr.id)}
                                className={`w-full text-left rounded-[12px] border px-3 py-2 transition-all duration-150
                                    ${active
                                        ? 'border-primary bg-primary/[0.07] shadow-[0_0_14px_rgba(244,119,75,0.12)]'
                                        : 'border-border/60 bg-surface-light hover:border-border-light'}`}
                            >
                                <span className="flex items-center justify-between gap-2">
                                    <span className={`min-w-0 text-[13px] font-bold truncate transition-colors ${active ? 'text-text' : 'text-text-secondary'}`}>
                                        {addr.name}
                                    </span>
                                    {statusChip}
                                </span>
                            </button>
                        )
                    })}
                    {filteredAddresses.length === 0 && (
                        <p className="text-[12px] text-text-secondary py-2">
                            {addresses.length === 0 ? 'Chưa có chi nhánh nào.' : 'Không tìm thấy chi nhánh.'}
                        </p>
                    )}
                </div>
            </section>

            {/* Mỗi chi nhánh 1 card — gia hạn nối tiếp nên hạn từng chi nhánh có thể khác nhau */}
            <section className="flex flex-col gap-2.5">
                <SectionHeader title="Thông tin" hint={addrCount > 0 ? `${addrCount} địa chỉ` : undefined} />
                {addrCount > 0 ? (
                    selectedAddressIds.map(id => (
                        <div key={id} className="rounded-[18px] border border-border/60 bg-surface px-3.5 py-3 flex flex-col gap-2">
                            <CopyRow label="Địa chỉ" value={addresses.find(a => a.id === id)?.name || '—'} />
                            <CopyRow label="Thời hạn" value={PLAN.periodLabel} />
                            <CopyRow label="Sử dụng đến" value={accessLoaded ? dateFullVN(newExpiryFor(id)) : '…'} />
                        </div>
                    ))
                ) : (
                    <div className="rounded-[18px] border border-border/60 bg-surface px-3.5 py-3">
                        <p className="text-[12px] text-text-secondary font-medium">Chọn chi nhánh để xem thông tin</p>
                    </div>
                )}
            </section>

            {/* ── Thanh toán — 1 card gắn kết: QR + tổng cộng + status ───────────── */}
            <section className="flex flex-col gap-2.5">
                <SectionHeader title="Thanh toán" />
                <div className="rounded-[18px] border border-border/60 bg-surface px-3.5 py-3.5">
                    {/* QR — đứng giữa, một mình */}
                    <div className="flex justify-center py-1">
                        <div className="relative w-[140px] aspect-square shrink-0 rounded-[16px] border flex items-center justify-center overflow-hidden bg-surface-light border-border/60 text-text-dim">
                            <Corner className="top-2 left-2 border-t-2 border-l-2 rounded-tl-[6px]" />
                            <Corner className="top-2 right-2 border-t-2 border-r-2 rounded-tr-[6px]" />
                            <Corner className="bottom-2 left-2 border-b-2 border-l-2 rounded-bl-[6px]" />
                            <Corner className="bottom-2 right-2 border-b-2 border-r-2 rounded-br-[6px]" />
                            {reference
                                ? <img src={qrUrl} alt="QR chuyển khoản" className="w-full h-full object-contain p-2.5 bg-white" />
                                : refError
                                    ? (
                                        <button onClick={() => setRefRetry(n => n + 1)} className="flex flex-col items-center gap-1 text-text-secondary">
                                            <span className="text-[10px] font-bold">Không tạo được mã</span>
                                            <span className="text-[10.5px] font-black text-primary">Thử lại</span>
                                        </button>
                                    )
                                    : <Loader2 size={28} strokeWidth={1.8} className="animate-spin text-text-dim" />}
                        </div>
                    </div>

                    {/* Thông tin thanh toán — tổng cộng + STK + tên + nội dung CK */}
                    {addrCount > 0 ? (
                        <div className="mt-3.5 pt-3.5 border-t border-border/40 flex flex-col gap-2.5">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-[11px] font-bold text-text-secondary shrink-0">Tổng cộng</span>
                                <span className="text-[15px] font-black bg-clip-text text-transparent" style={{ backgroundImage: GOLD }}>{formatVND(total)}</span>
                            </div>
                            <div className="border-t border-border/30" />
                            <CopyRow label="Ngân hàng" value={BANK_INFO.bank} />
                            <CopyRow label="Tên tài khoản" value={BANK_INFO.accountName} />
                            <CopyRow label="Số tài khoản" value={BANK_INFO.accountNumber} onCopy={() => copy(BANK_INFO.accountNumber, 'stk')} copied={copied === 'stk'} />
                            <CopyRow label="Nội dung" value={transferContent} onCopy={() => copy(transferContent, 'noidung')} copied={copied === 'noidung'} />
                        </div>
                    ) : (
                        <p className="mt-3.5 pt-3.5 border-t border-border/40 text-[12px] text-text-secondary font-medium">Chọn chi nhánh để tính tiền</p>
                    )}

                    {/* status — cùng card, ngăn bằng hairline */}
                    <div className="mt-3 pt-3 border-t border-border/40 flex flex-col gap-1.5">
                        {reviewHold ? (
                            <div className="flex gap-2 text-[10.5px] leading-[1.6] font-bold text-warning">
                                <span className="w-1.5 h-1.5 rounded-full bg-warning shrink-0 mt-[5px]" />
                                <span>Đã nhận chuyển khoản nhưng số tiền chưa khớp — admin sẽ kiểm tra và mở khoá thủ công.</span>
                            </div>
                        ) : (
                            transferContent && (
                                <ul className="text-[10.5px] leading-[1.6] flex flex-col gap-0.5">
                                    <li className="flex gap-2 text-warning"><span className="w-1.5 h-1.5 rounded-full bg-warning shrink-0 mt-[5px]" /><span>Chuyển đúng số tiền <b>{formatVND(total)}</b></span></li>
                                    <li className="flex gap-2 text-warning"><span className="w-1.5 h-1.5 rounded-full bg-warning shrink-0 mt-[5px]" /><span>Ghi đúng nội dung <b>{transferContent}</b></span></li>
                                    <li className="flex gap-2 text-text-secondary"><span className="w-1.5 h-1.5 rounded-full bg-text-dim shrink-0 mt-[5px]" /><span>Quét QR là đã điền sẵn cả hai</span></li>
                                    <li className="flex gap-2 text-text-secondary"><span className="w-1.5 h-1.5 rounded-full bg-success shrink-0 mt-[5px] animate-pulse" /><span>Hệ thống tự động xác nhận thanh toán</span></li>
                                </ul>
                            )
                        )}
                    </div>
                </div>
            </section>



            {/* ── Footer dính đáy: nút Mock + Reset (Admin). User thường xác nhận qua webhook. ── */}
            {isAdmin && (
                <div className="sticky bottom-0 -mx-4 px-4 pt-3 bg-bg/85 backdrop-blur-md border-t border-border/50 pb-[max(env(safe-area-inset-bottom),12px)] flex flex-col gap-2">
                    <button
                        onClick={handleMockPayment}
                        disabled={isMocking || isResetting || !canSubmit}
                        className="w-full py-2.5 rounded-[12px] bg-danger/10 text-danger text-[12px] font-bold hover:bg-danger/20 active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                        {isMocking ? <Loader2 size={14} className="animate-spin" /> : `Mock trial ${TRIAL_DAYS} ngày (Admin)`}
                    </button>
                    <button
                        onClick={handleReset}
                        disabled={isMocking || isResetting || !selectedAddressIds.length}
                        className={`w-full py-2 rounded-[12px] text-[11px] font-bold active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50
                            ${confirmReset ? 'bg-danger/15 text-danger hover:bg-danger/25' : 'bg-surface-light text-text-secondary hover:bg-border/40'}`}
                    >
                        {isResetting
                            ? <Loader2 size={14} className="animate-spin" />
                            : confirmReset ? 'Bấm lần nữa để xoá gói đã chọn' : 'Reset gói (Admin · dev)'}
                    </button>
                    {adminError && <p className="text-[10.5px] text-danger text-center">{adminError}</p>}
                </div>
            )}
        </div>
    )
}

function SectionHeader({ title, hint, action }) {
    return (
        <div className="flex items-center justify-between gap-2 px-0.5">
            <div className="flex items-center gap-2.5 min-w-0">
                <span className="w-1 h-3.5 rounded-full bg-primary/70 shrink-0" />
                <p className="text-[12px] font-black text-text uppercase tracking-wider whitespace-nowrap">{title}</p>
                {hint && <span className="text-[10px] text-text-dim normal-case font-medium tracking-normal truncate">{hint}</span>}
            </div>
            {action && <div className="shrink-0">{action}</div>}
        </div>
    )
}

function Corner({ className }) {
    return <span className={`absolute w-4 h-4 border-primary/40 ${className}`} />
}

function CopyRow({ label, value, onCopy, copied }) {
    return (
        <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-text-secondary shrink-0">{label}</span>
            <span className="flex items-center gap-1.5 min-w-0">
                <span className="text-[12px] font-bold text-text truncate">{value}</span>
                {onCopy && (
                    <button
                        onClick={onCopy}
                        title="Sao chép"
                        className="shrink-0 w-6 h-6 flex items-center justify-center rounded-[8px] bg-surface-light border border-border/60 text-text-secondary hover:text-text active:scale-95 transition-all"
                    >
                        {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
                    </button>
                )}
            </span>
        </div>
    )
}

// Chuẩn hoá để search không phân biệt hoa/thường & dấu tiếng Việt.
function normalizeText(s = '') {
    return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd')
}

// Cộng tháng, clamp về ngày cuối tháng nếu tràn — KHỚP Postgres `date + interval 'N months'`
// (vd 31/08 + 6 tháng → 28/02, không cuộn sang 03/03 như Date.setMonth mặc định).
function addMonths(date, months) {
    const d = new Date(date)
    const day = d.getDate()
    d.setDate(1)
    d.setMonth(d.getMonth() + months)
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
    d.setDate(Math.min(day, lastDay))
    return d
}
