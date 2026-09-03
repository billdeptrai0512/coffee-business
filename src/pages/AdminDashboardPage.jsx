import { useState, useEffect, useCallback } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { ArrowLeft, Loader2, RefreshCw } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { fetchAdminDashboard, fetchAdminFunnelCohorts } from '../services/adminDashboardService'
import { fetchGuestOnboardingFunnel } from '../services/onboardingFunnelService'
import { openedLabelVN, dateShortVN } from '../utils/dateVN'
import MonetizationToggle from '../components/AddressSelectPage/MonetizationToggle'

// v3: chỉ còn 3 loại activity actionable (payment/review/rating) — xem
// 20260815_admin_dashboard_overview_v3.sql, đã bỏ new_branch/referral/new_account/new_staff.
// v7: +deletion — "Xóa địa chỉ" giờ soft-delete, không còn biến mất im lặng
// (xem 20260824_admin_dashboard_overview_v7.sql).
const ACTIVITY_ICON = {
    payment: { bg: 'bg-success-soft', color: 'text-success', symbol: '₫' },
    review: { bg: 'bg-danger-soft', color: 'text-danger', symbol: '!' },
    rating: { bg: 'bg-warning-soft', color: 'text-warning', symbol: '★' },
    deletion: { bg: 'bg-danger-soft', color: 'text-danger', symbol: '🗑' },
}

// Bước trong guide onboarding tầm giây (bấm tạo đơn, mở nhật ký...) — làm tròn
// phút thì mọi bước hiện "0′" như nhau, mất hết tín hiệu bước nào chậm hơn.
// Dưới 1 phút giữ nguyên giây; từ 1 phút trở lên mới quy tròn ra phút (bước
// chậm, kiểu cài công thức/nguyên liệu, không cần chính xác tới giây).
function formatStepDuration(seconds) {
    if (seconds == null) return null
    return seconds < 60 ? `${seconds}s` : `${Math.round(seconds / 60)}′`
}

function countDelta(current, prev) {
    const diff = current - prev
    if (diff === 0) return { text: 'Không đổi so với tháng trước', cls: 'text-text-dim' }
    return {
        text: `${diff > 0 ? '+' : ''}${diff} so với tháng trước`,
        cls: diff > 0 ? 'text-success' : 'text-danger',
    }
}

// So tỷ lệ chuyển đổi (dùng thử → đăng ký) với đúng kỳ liền trước (hôm qua/tuần
// trước) — trả lời "sửa guide có thật sự giúp không" thay vì chỉ nhìn 1 ảnh chụp.
function pctDelta(currentPct, prevPct) {
    const diff = currentPct - prevPct
    if (diff === 0) return { text: 'không đổi so với kỳ trước', cls: 'text-text-dim' }
    return {
        text: `${diff > 0 ? '+' : ''}${diff}% so với kỳ trước`,
        cls: diff > 0 ? 'text-success' : 'text-danger',
    }
}

function activityAgo(iso) {
    const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
    if (minutes < 1) return 'Vừa xong'
    if (minutes < 60) return `${minutes} phút trước`
    if (minutes < 1440) return `${Math.floor(minutes / 60)} giờ trước`
    const days = Math.floor(minutes / 1440)
    return days === 1 ? 'Hôm qua' : `${days} ngày trước`
}

/**
 * AdminDashboardPage — route /admin/dashboard. Tổng quan billing + customer
 * health toàn hệ thống cho admin (chỉ admin, RPC admin_dashboard_overview tự
 * chặn non-admin, đây chỉ là gate UX như AdminReconciliationPage).
 *
 * 1 fetch duy nhất khi mount/refresh — không cache vì chỉ 1 nơi dùng và luôn
 * muốn số mới nhất.
 */
export default function AdminDashboardPage() {
    const navigate = useNavigate()
    const { isAdmin, loading: authLoading } = useAuth()
    const [data, setData] = useState(null)
    const [error, setError] = useState(null)
    // OnboardingFunnelCard fetch riêng (xem component đó) và chỉ tự chạy lúc mount —
    // refreshToken là cách duy nhất để nút refresh ở header kéo nó fetch lại theo.
    const [refreshToken, setRefreshToken] = useState(0)

    const reload = useCallback(() => {
        fetchAdminDashboard().then(setData).catch((e) => setError(e.message))
    }, [])

    // Nút refresh ở header: reload() (fetch, không setState đồng bộ) + bump refreshToken
    // (setState đồng bộ) — tách riêng khỏi reload() vì effect mount bên dưới không được
    // phép setState đồng bộ trong thân effect (react-hooks/set-state-in-effect).
    const refresh = useCallback(() => {
        reload()
        setRefreshToken((t) => t + 1)
    }, [reload])

    useEffect(() => {
        if (isAdmin) reload()
    }, [isAdmin, reload])

    if (authLoading) return null
    if (!isAdmin) return <Navigate to="/addresses" />

    return (
        <div className="flex flex-col h-[100dvh] bg-bg">
            <header className="shrink-0 bg-surface border-b border-border/60 shadow-sm px-4 py-3 xl:px-8 flex items-center gap-3">
                <button
                    onClick={() => navigate('/addresses')}
                    className="w-10 h-10 flex items-center justify-center rounded-[14px] bg-surface-light border border-border/60 text-text hover:bg-border/40 active:bg-border/60 transition-colors shrink-0 focus:outline-none"
                >
                    <ArrowLeft size={20} strokeWidth={2.5} />
                </button>
                <div className="flex-1 min-w-0">
                    <h1 className="text-[14px] font-black text-text uppercase tracking-wide">Admin Dashboard</h1>
                    {data && (
                        <p className="text-[10.5px] text-text-dim">
                            Cập nhật {new Date(data.generated_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                    )}
                </div>
                <button
                    onClick={refresh}
                    className="w-10 h-10 flex items-center justify-center rounded-[14px] bg-surface-light border border-border/60 text-text-secondary hover:bg-border/40 active:bg-border/60 transition-colors shrink-0 focus:outline-none"
                >
                    <RefreshCw size={16} strokeWidth={2.5} />
                </button>
            </header>

            <div className="flex-1 overflow-y-auto">
                <div className="max-w-[1400px] mx-auto px-4 py-5 xl:px-8">
                    {error && (
                        <p className="text-[12px] font-bold text-danger bg-danger-soft rounded-[12px] px-3 py-2 mb-4">Lỗi: {error}</p>
                    )}
                    {!data ? (
                        <div className="flex justify-center py-16">
                            <Loader2 size={24} className="animate-spin text-text-dim" />
                        </div>
                    ) : (
                        <DashboardBody data={data} navigate={navigate} refreshToken={refreshToken} />
                    )}
                </div>
            </div>
        </div>
    )
}

function DashboardBody({ data, navigate, refreshToken }) {
    const { subscription, attention, activity, attention_total_count, payment_issue_total_count } = data
    // total_count = đếm không giới hạn (đã dedupe theo chi nhánh) từ RPC; attention
    // (mảng) chỉ là top-20 hiển thị nên KHÔNG dùng .length làm KPI — sẽ undercount
    // khi thực tế > 20 chi nhánh cần chú ý.
    const attentionCount = attention_total_count ?? attention.length
    const paymentIssueCount = payment_issue_total_count ?? attention.filter((a) => a.reason === 'payment_review' || a.reason === 'payment_stale').length

    return (
        <>
            {/* OMTM: dùng thử → trả phí — số DUY NHẤT trả lời "lớp report 888k/6th có
                đáng tiền không". Mọi số khác trên trang này chỉ là bối cảnh hoặc danh
                sách hành động, không cái nào thay được câu hỏi này. */}
            <ConversionHeroCard subscription={subscription} />
            <KpiRow subscription={subscription} attentionCount={attentionCount} paymentIssueCount={paymentIssueCount} navigate={navigate} />
            {/* Kể một chiều theo đường đi của khách. Trước đây Snapshot (đích) đứng
                trên Onboarding (đầu phễu) nên trang kể ngược. */}
            <div className="flex flex-col gap-4">
                <OnboardingFunnelCard refreshToken={refreshToken} />
                <CohortFunnelCard refreshToken={refreshToken} />
                <SubscriptionSnapshotCard subscription={subscription} />
                <ActivityCard items={activity} />
            </div>
            {/* Công tắc cấu hình, không phải số liệu — xuống cuối, đứng đầu trang chỉ
                chiếm chỗ của câu mở đầu. */}
            <div className="mt-4">
                <MonetizationToggle />
            </div>
        </>
    )
}

// Số to là n/m chứ KHÔNG phải %: ở quy mô vài khách/tuần, mẫu số một chữ số làm
// % nhảy 20-30% mỗi khi thêm đúng 1 chi nhánh — đọc như biến động lớn trong khi
// thực tế chỉ là 1 người. Đảo lại khi mẫu số đủ lớn để % tự đứng được.
function ConversionHeroCard({ subscription }) {
    const { conversion_rate_30d, trial_30d, converted_30d } = subscription
    return (
        <div className="relative bg-primary text-white rounded-[20px] px-5 py-4 mb-3 overflow-hidden">
            <p className="text-[10.5px] font-black uppercase tracking-wide text-white/70">Chuyển đổi dùng thử → trả phí (30 ngày)</p>
            {conversion_rate_30d != null ? (
                <>
                    <p className="text-[34px] font-black tabular-nums leading-tight mt-0.5">{converted_30d}/{trial_30d}</p>
                    <p className="text-[11px] font-bold text-white/80 mt-0.5">chi nhánh dùng thử đã trả phí · {conversion_rate_30d}%</p>
                </>
            ) : (
                <p className="text-[13px] font-bold text-white/80 mt-1.5">Chưa đủ dữ liệu 30 ngày qua</p>
            )}
        </div>
    )
}

function KpiCard({ stripe, label, value, delta, deltaClass, onClick }) {
    const Tag = onClick ? 'button' : 'div'
    return (
        <Tag
            onClick={onClick}
            className={`relative bg-surface border border-border/60 rounded-[16px] pl-4 pr-3.5 py-3.5 overflow-hidden text-left ${onClick ? 'hover:bg-border/10 active:scale-[0.99] transition-all' : ''}`}
        >
            <span className={`absolute left-0 top-3 bottom-3 w-[3px] rounded-full ${stripe}`} />
            <p className="text-[10px] font-black uppercase tracking-wide text-text-dim mb-1">{label}</p>
            <p className="text-[19px] xl:text-[22px] font-black text-text tabular-nums leading-tight truncate">{value}</p>
            {delta && <p className={`text-[11px] font-bold mt-1 truncate ${deltaClass}`}>{delta}</p>}
        </Tag>
    )
}

function KpiRow({ subscription, attentionCount, paymentIssueCount, navigate }) {
    const { churned_recent_count = 0, active_rate_7d, expiring_soon_count, trial_count } = subscription
    const needsAction = expiring_soon_count + trial_count

    return (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
            <KpiCard
                stripe="bg-danger"
                label="Cần chú ý"
                value={`${attentionCount} chi nhánh`}
                delta={paymentIssueCount > 0 ? `${paymentIssueCount} cần đối soát` : attentionCount > 0 ? 'Xem tại đối soát' : 'Đang ổn'}
                deltaClass={paymentIssueCount > 0 ? 'text-danger' : attentionCount > 0 ? 'text-warning' : 'text-text-dim'}
                onClick={() => navigate('/admin/reconciliation')}
            />
            <KpiCard
                stripe="bg-warning"
                label="Rời bỏ gần đây (30 ngày)"
                value={`${churned_recent_count} chi nhánh`}
                delta={churned_recent_count > 0 ? 'Đã từng trả tiền — dễ cứu nhất' : 'Không có'}
                deltaClass={churned_recent_count > 0 ? 'text-warning' : 'text-text-dim'}
                onClick={churned_recent_count > 0 ? () => navigate('/admin/reconciliation') : undefined}
            />
            <KpiCard
                stripe="bg-success"
                label="Đang hoạt động (7 ngày)"
                value={active_rate_7d != null ? `${active_rate_7d}%` : '—'}
                delta="Chi nhánh trả phí có đơn/ca gần đây"
                deltaClass="text-text-dim"
            />
            <KpiCard
                stripe="bg-primary"
                label="Sắp hết hạn (≤7 ngày)"
                value={`${needsAction} chi nhánh`}
                delta={needsAction > 0 ? 'Trả phí hết hạn hoặc dùng thử sắp hết' : 'Không có'}
                deltaClass={needsAction > 0 ? 'text-warning' : 'text-text-dim'}
            />
        </div>
    )
}

function StatRow({ dotClass, label, value, onClick }) {
    const Tag = onClick ? 'button' : 'div'
    return (
        <Tag
            onClick={onClick}
            className={`flex items-center justify-between text-[12.5px] w-full ${onClick ? 'text-left hover:opacity-80 active:scale-[0.99] transition-all' : ''}`}
        >
            <span className={`flex items-center gap-2 ${onClick ? 'text-warning font-bold' : 'text-text-secondary'}`}>
                {dotClass && <i className={`w-[7px] h-[7px] rounded-full inline-block ${dotClass}`} />}
                {label}
            </span>
            <span className={`font-black tabular-nums ${onClick ? 'text-warning' : 'text-text'}`}>{value}</span>
        </Tag>
    )
}

// v3: bỏ thanh Subscription Health cũ (paid/trial/churned chia theo TỔNG lịch sử
// — dải "churned" cộng dồn vĩnh viễn nên càng lâu càng đỏ, không phản ánh sức khoẻ
// hiện tại). Thay bằng snapshot dạng số: paid/trial vẫn hữu ích làm bối cảnh, còn
// churn giờ là RATE 30 ngày (đã có card riêng ở KpiRow) nên ở đây chỉ liệt kê gọn.
function SubscriptionSnapshotCard({ subscription }) {
    const { paid_count, paid_count_prev, trial_count, new_paid_this_month, churn_rate_30d, total_addresses } = subscription
    const paidDelta = countDelta(paid_count, paid_count_prev)

    return (
        <div className="bg-surface border border-border/60 rounded-[20px] p-4">
            <h3 className="text-[12px] font-black uppercase tracking-wide text-text-secondary">Subscription</h3>
            <p className={`text-[11px] font-bold mb-3 ${paidDelta.cls}`}>{paidDelta.text}</p>
            <div className="flex flex-col gap-2">
                <StatRow dotClass="bg-success" label="Đã đăng ký" value={paid_count} />
                <StatRow dotClass="bg-warning" label="Dùng thử" value={trial_count} />
                <StatRow label="Mới trả phí trong tháng" value={`+${new_paid_this_month}`} />
                <StatRow label="Tỷ lệ rời bỏ (30 ngày)" value={churn_rate_30d != null ? `${churn_rate_30d}%` : '—'} />
                <div className="border-t border-border/60 mt-1 pt-2">
                    <StatRow label="Tổng số địa chỉ (kể cả free)" value={total_addresses} />
                </div>
            </div>
        </div>
    )
}

const RANGE_TABS = [
    { key: 'today', label: 'Hôm nay' },
    { key: 'week', label: 'Tuần này' },
    { key: 'all', label: 'Tất cả' },
]

// Phễu onboarding khách dùng thử — bao nhiêu người vào dùng thử và rơi rụng ở mốc nào
// (xem 20260816_guest_onboarding_funnel_v2.sql + OnboardingGuide.jsx). Đếm theo visitor_id
// ẩn danh do client sinh, KHÔNG phải theo địa chỉ (mọi khách dùng chung 1 demo address id).
// Tự fetch riêng (không qua fetchAdminDashboard) — 1 lần gọi trả cả 3 khoảng thời gian
// (today/week/all), đổi tab KHÔNG cần round-trip mới. byRange = null khi RPC chưa apply
// hoặc lỗi → ẩn hẳn phần guest funnel, không hỏng phần còn lại của dashboard.
function OnboardingFunnelCard({ refreshToken }) {
    const [byRange, setByRange] = useState(null)
    const [range, setRange] = useState('week')

    useEffect(() => {
        fetchGuestOnboardingFunnel().then(setByRange).catch(() => setByRange(null))
    }, [refreshToken])

    const funnel = byRange?.[range]

    return (
        <div className="bg-surface border border-border/60 rounded-[20px] p-4">
            <div className="flex items-center justify-between gap-2 mb-1">
                <h3 className="text-[12px] font-black uppercase tracking-wide text-text-secondary">Onboarding</h3>
                {byRange && (
                    <div className="flex gap-1 shrink-0">
                        {RANGE_TABS.map((t) => (
                            <button
                                key={t.key}
                                onClick={() => setRange(t.key)}
                                className={`text-[10px] font-bold px-2 py-1 rounded-[8px] transition-colors ${range === t.key ? 'bg-primary text-white' : 'bg-surface-light text-text-dim hover:text-text-secondary'}`}
                            >
                                {t.label}
                            </button>
                        ))}
                    </div>
                )}
            </div>
            <div className="mt-1">
                {funnel?.stages?.length ? (
                    <GuestFunnelBody funnel={funnel} />
                ) : (
                    <p className="text-[11px] text-text-dim">Chưa có khách nào vào dùng thử trong khoảng này</p>
                )}
            </div>
        </div>
    )
}

// Thanh % thay cho chỉ đọc số — nhìn 1 phát ra chỗ thắt cổ chai (thanh nào
// ngắn hẳn so với thanh ngay trên nó) thay vì phải so từng dòng "N (X%)"
// trong đầu. Cùng pattern thanh progress ở ChangeCategorySheet.jsx.
function FunnelStageRow({ dotClass, label, count, pct, seconds, dropped }) {
    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-[12.5px]">
                <span className="flex items-center gap-2 text-text-secondary">
                    <i className={`w-[7px] h-[7px] rounded-full inline-block ${dotClass}`} />
                    {label}
                </span>
                <span className="font-black tabular-nums text-text">
                    {seconds != null && <span className="text-text-dim font-medium">+{formatStepDuration(seconds)} · </span>}
                    {count} ({pct}%)
                </span>
            </div>
            <div className="h-1.5 rounded-full bg-surface-light overflow-hidden">
                <div className={`h-full ${dotClass} transition-all`} style={{ width: `${pct}%` }} />
            </div>
            {/* Số dừng ĐÚNG tại bước này (không đi tiếp được bước sau) — trừ ra từ 2 count
                cạnh nhau, không cần query riêng. Chỉ nói lên chỗ nào rớt, không suy đoán
                bỏ cuộc hẳn hay đang làm dở (xem "Từng khách" bên dưới để soi từng người). */}
            {dropped > 0 && <span className="self-end text-[10px] font-bold text-danger/70">−{dropped} dừng lại ở đây</span>}
        </div>
    )
}

// Danh sách thô từng khách — thay cho ngưỡng "stuck > N ngày" tự động: ở quy mô
// vài khách/tuần, mẫu quá nhỏ để thống kê có ý nghĩa, tự đọc từng dòng vừa nhanh
// vừa chính xác hơn. Trả tối đa 20 dòng/khoảng (server đã giới hạn + sắp xếp).
function RecentVisitorsList({ visitors, stages }) {
    if (!visitors?.length) return null
    const labelOf = (stage) => stages.find(s => s.stage === stage)?.label.replace(/^Xong: /, '') || `Bước ${stage}`

    return (
        <div className="border-t border-border/60 mt-3 pt-3">
            <p className="text-[10.5px] font-black uppercase tracking-wide text-text-dim mb-2">Từng khách (mới hoạt động trước)</p>
            <div className="flex flex-col">
                {visitors.map(v => (
                    <div key={v.visitor_id} className="flex items-center justify-between gap-2 text-[11px] py-1.5 border-b border-border/30 last:border-0">
                        <div className="flex items-center gap-2 min-w-0">
                            <span className="shrink-0 bg-surface-light border border-border/60 rounded-full px-1.5 py-0.5 text-[10px] font-bold text-text-secondary tabular-nums">#{v.visitor_id.slice(0, 8)}</span>
                            <span className="text-text-secondary truncate">{labelOf(v.max_stage)}</span>
                            {v.signed_up_at && <span className="shrink-0 text-success font-bold">✓ đăng ký</span>}
                        </div>
                        <span className="shrink-0 text-text-dim tabular-nums">{openedLabelVN(v.last_seen_at)}</span>
                    </div>
                ))}
            </div>
        </div>
    )
}

function GuestFunnelBody({ funnel }) {
    const { stages, signup, total_median_seconds, recent_visitors, prev } = funnel
    const entered = stages[0].count
    const completed = stages[stages.length - 1].count
    const totalSignup = signup.after_complete + signup.early
    const currentPct = entered > 0 ? Math.round((totalSignup / entered) * 100) : null
    // prev = null cho khoảng "Tất cả" (không có "kỳ trước" tự nhiên) và cho
    // khoảng có prev.entered = 0 (không tính % được, tránh chia 0).
    const prevPct = prev?.entered > 0 ? Math.round((prev.signed_up / prev.entered) * 100) : null
    const delta = currentPct != null && prevPct != null ? pctDelta(currentPct, prevPct) : null

    return (
        <>
            <p className="text-[11px] text-text-dim mb-3">
                {entered > 0
                    ? `${entered} khách vào dùng thử → ${totalSignup} đăng ký (${currentPct}%)`
                    : 'Chưa có khách nào vào dùng thử'}
                {total_median_seconds != null && ` · hết guide trung vị ${formatStepDuration(total_median_seconds)}`}
                {delta && <span className={`font-bold ${delta.cls}`}> · {delta.text}</span>}
            </p>
            <div className="flex flex-col gap-3">
                {stages.map((f, i) => (
                    // step_median_seconds = thời gian trung vị TỪ BƯỚC TRƯỚC tới bước này —
                    // chỗ nào số này to là chỗ khách khựng lại lâu nhất, đáng sửa guide trước.
                    <FunnelStageRow
                        key={f.stage}
                        dotClass={f.stage === 0 ? 'bg-primary' : 'bg-warning'}
                        label={f.label.replace(/^Xong: /, '')}
                        count={f.count}
                        pct={entered > 0 ? Math.round((f.count / entered) * 100) : 0}
                        seconds={f.step_median_seconds}
                        dropped={i < stages.length - 1 ? f.count - stages[i + 1].count : 0}
                    />
                ))}
                {/* Đăng ký tách khỏi chuỗi stage: after_complete nối tiếp được vào phễu (mẫu số là
                    nhóm xong hết → hiển thị n/m cho khỏi nhầm với % trên tổng khách), còn early nằm
                    NGOÀI phễu nên không gắn % vào đâu cả. */}
                <div className="border-t border-border/60 mt-1 pt-2 flex flex-col gap-2">
                    <StatRow dotClass="bg-success" label="Xong hết rồi đăng ký" value={`${signup.after_complete}/${completed}`} />
                    <StatRow dotClass="bg-success" label="Đăng ký sớm (bỏ guide giữa chừng)" value={signup.early} />
                </div>
            </div>
            <RecentVisitorsList visitors={recent_visitors} stages={stages} />
        </>
    )
}

const COHORT_COLS = [
    { key: 'created', label: 'Tạo' },
    { key: 'first_order', label: 'Đơn' },
    { key: 'trial_started', label: 'Trial' },
    { key: 'paid', label: 'Trả phí' },
]

// Cohort theo TUẦN TẠO ĐỊA CHỈ — khác mọi số còn lại trên trang này (ảnh chụp
// hôm nay): trả lời "tuần này có khá hơn tuần trước không". Tự fetch riêng như
// OnboardingFunnelCard; RPC lỗi/chưa apply → ẩn hẳn thẻ, không hỏng phần còn lại.
//
// ponytail: ở quy mô hiện tại (vài chi nhánh/tuần) mỗi ô trong bảng là 1-3 người,
// xu hướng theo cột chưa đọc được — phần đọc được ngay là khối "Kẹt" bên dưới.
// Bảng bắt đầu nói được điều gì từ khoảng 30 địa chỉ mới/tuần trở lên.
function CohortFunnelCard({ refreshToken }) {
    const [data, setData] = useState(null)

    useEffect(() => {
        fetchAdminFunnelCohorts().then(setData).catch(() => setData(null))
    }, [refreshToken])

    if (!data) return null
    const { weeks, stuck } = data

    return (
        <div className="bg-surface border border-border/60 rounded-[20px] p-4">
            {/* Khối "Kẹt" lên TRƯỚC bảng: đây là phần hành động được ngay (gọi ai),
                bảng cohort là bối cảnh xu hướng — ở quy mô hiện tại thì bối cảnh
                đứng sau. Đảo lại khi bảng đủ dày để dẫn chuyện. */}
            <h3 className="text-[12px] font-black uppercase tracking-wide text-text-secondary mb-2">Kẹt &gt;3 ngày, chưa được cấp trial</h3>
            <div className="flex flex-col gap-2">
                <StatRow dotClass="bg-text-dim" label="Chưa bán đơn nào" value={stuck.never_ordered} />
                <StatRow dotClass="bg-warning" label="Có bán, chưa nhập thực thu" value={stuck.ordered_no_cash_close} />
                <StatRow dotClass="bg-danger" label="Đã nhập thực thu, chưa được cấp trial" value={stuck.cash_closed_no_trial} />
            </div>

            {weeks.length > 0 && <div className="border-t border-border/60 mt-3 pt-3">
                <p className="text-[10.5px] font-black uppercase tracking-wide text-text-dim">Cohort theo tuần tạo chi nhánh</p>
                {/* Đếm luỹ kế tới hôm nay: cohort tuần cuối chưa đủ thời gian đi hết phễu
                    nên LUÔN thấp giả — nói thẳng ra đây thay vì để admin đọc nhầm là tụt. */}
                <p className="text-[10.5px] text-text-dim mb-2">Tuần mới nhất chưa chín, đọc theo các tuần trước</p>
                <div className="overflow-x-auto -mx-1 px-1">
                    <table className="w-full text-[12px] tabular-nums">
                        <thead>
                            <tr className="text-text-dim text-[10px] font-black uppercase tracking-wide">
                                <th className="text-left font-black pb-1.5">Tuần</th>
                                {COHORT_COLS.map((c) => (
                                    <th key={c.key} className="text-right font-black pb-1.5 pl-3">{c.label}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {weeks.map((w, i) => (
                                <tr key={w.week} className={`border-t border-border/30 ${i === weeks.length - 1 ? 'text-text-dim' : 'text-text-secondary'}`}>
                                    <td className="py-1.5 whitespace-nowrap">{dateShortVN(new Date(w.week))}</td>
                                    {COHORT_COLS.map((c) => (
                                        <td key={c.key} className="py-1.5 pl-3 text-right font-black">{w[c.key]}</td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>}
        </div>
    )
}

function ActivityCard({ items }) {
    return (
        <div className="bg-surface border border-border/60 rounded-[20px] p-4">
            <h3 className="text-[12px] font-black uppercase tracking-wide text-text-secondary mb-3">Hoạt động gần đây</h3>
            {items.length === 0 ? (
                <p className="text-[12px] text-text-secondary py-2">Chưa có hoạt động nào.</p>
            ) : (
                <div className="flex flex-col gap-3">
                    {items.map((item, i) => {
                        const icon = ACTIVITY_ICON[item.type] || ACTIVITY_ICON.payment
                        return (
                            <div key={i} className="flex items-start gap-2.5">
                                <span className={`w-6 h-6 rounded-[7px] flex items-center justify-center text-[11px] shrink-0 ${icon.bg} ${icon.color}`}>
                                    {icon.symbol}
                                </span>
                                <div className="min-w-0">
                                    <p className="text-[12px] text-text-secondary leading-snug">
                                        <b className="text-text font-black">{item.address_name}</b> · {item.detail}
                                    </p>
                                    <p className="text-[10.5px] text-text-dim mt-0.5">{activityAgo(item.at)}</p>
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
