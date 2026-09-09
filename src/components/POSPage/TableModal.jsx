import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { Plus, X } from 'lucide-react'
import { useCart } from '../../contexts/CartContext'
import { useAddress } from '../../contexts/AddressContext'
import { useAuth } from '../../contexts/AuthContext'
import { useConfirm } from '../../contexts/ConfirmContext'
import { formatVND } from '../../utils'
import { dateShortVN, isSameDayVN, timeStringVN } from '../../utils/dateVN'
import { renameTable as renameTableOrders } from '../../services/orderService'
import { Dialog } from '../common/ModalShell'
import TableDetailModal from './TableDetailModal'
import TakeawayListModal from './TakeawayListModal'

// Chọn bàn — chỉ mở được từ CheckoutBar, tức chỉ ở địa chỉ dine_in.
//
// Lưới bàn = danh sách bàn cố định của địa chỉ (addresses.tables, quản lý tạo sẵn một
// lần) chồng lên các bàn ĐANG có khách (nhóm đơn chưa tính tiền, xem fetchOpenTables).
// Bàn nào chưa gọi món thì hiện "Trống". Chọn bàn xong thì đợt đang dựng rơi vào bàn
// đó, nên khách ngồi tiếp gọi thêm là gọi đúng vào bàn cũ.
//
// ponytail: lưới thẳng, không phải sơ đồ theo vị trí thật. Đổi sang sơ đồ khi quán cần
// nhìn ra bàn nào ngoài sân / bàn nào trong nhà, chứ không chỉ bàn nào còn trống.

// MỌI thẻ cùng một chiều cao. Bàn gọi nhiều loại thì cắt dòng, không kéo thẻ dài ra —
// lưới cao thấp lởm chởm nhìn không ra bàn nào với bàn nào. Thấp hơn 148px cũ theo yêu
// cầu client (bao quát nhiều bàn hơn trong lưới) — NHƯNG không thấp tới mức cắt nội
// dung bắt buộc: tên/tổng + tối đa CARD_LINES dòng đợt (+ dòng "..." nếu còn dư) + dòng
// "N món chưa ra" đều phải vừa mà không cần overflow-hidden ăn bớt (từng bị: cắt 90px
// làm mất hẳn dòng "N món chưa ra" dù bàn còn món chưa ra — xem shrink-0 ở roundPreview
// bên dưới, giữ lại làm lưới an toàn chứ không phải cơ chế chính).
const CARD_H = 'h-[124px]'
// Số DÒNG tối đa phần đợt chiếm được. Nhiều hơn thì dòng cuối nhường chỗ cho "..." —
// cắt mà không nói là giấu đợt của khách.
const CARD_LINES = 2

// Danh sách "giờ + số món" rút gọn trên thẻ lưới — dùng chung cho cả thẻ bàn busy (rounds
// của 1 bàn) và thẻ Mang đi (mỗi đơn mang đi là 1 "round" độc lập, xem bucket name=null ở
// fetchOpenTables). Chỉ liệt đợt CHƯA ra món — đợt đã xong không còn gì để nhân viên phải
// hành động, liếc lưới chỉ cần thấy việc còn tồn. Đã ra hết thì danh sách rỗng, thẻ chỉ còn
// tên/tổng tiền. Luôn hiện đủ CARD_LINES dòng đợt (không nhường 1 dòng cho "+N nữa" như
// trước) — còn dư thì thêm đúng 1 dấu "..." báo còn nữa, không cần đếm chính xác bao nhiêu.
function roundPreview(rounds) {
    const pending = rounds.filter(r => !r.servedAt)
    const shown = pending.slice(0, CARD_LINES)
    return (
        <span className="min-h-0 overflow-hidden flex flex-col gap-0.5">
            {shown.map((round, i) => {
                const cups = round.lines.reduce((s, l) => s + (l.qty || 0), 0)
                return (
                    <span key={round.id || i} className="flex items-center justify-between gap-1 text-[11px] font-bold text-text-secondary leading-snug line-clamp-1">
                        <span className="tabular-nums">{timeStringVN(new Date(round.createdAt))}</span>
                        <span className="tabular-nums">{cups} món</span>
                    </span>
                )
            })}
            {pending.length > shown.length && (
                <span className="text-[12px] font-bold text-text-secondary/60 leading-snug">...</span>
            )}
        </span>
    )
}

// Tổng số ly còn chưa ra của các round chưa served — thay cho đếm số đợt, vì cái nhân
// viên cần biết khi liếc lưới là "còn thiếu bao nhiêu ly" chứ không phải "mấy đợt".
function pendingCups(rounds) {
    return rounds.filter(r => !r.servedAt).reduce((s, r) => s + r.lines.reduce((ss, l) => ss + (l.qty || 0), 0), 0)
}

// inline = true: render as the permanent right-pane "screen" on tablet split-view
// (POSPage) instead of a bottom-sheet Dialog — no backdrop, no close button, picking
// a table just updates this pane (no onClose to call back to).
export default function TableModal({ onClose, inline = false }) {
    const { tableName, setTableName, openTables, refreshTables, orderCount, showError } = useCart()
    const { selectedAddress, setTables } = useAddress()
    const { isManager, isAdmin } = useAuth()
    const { state } = useLocation()
    const confirm = useConfirm()
    const [newName, setNewName] = useState('')
    const [adding, setAdding] = useState(false)
    // Tên bàn đang gõ lại (đổi tên) — song song với `adding`, chỉ khác là thay thế một
    // thẻ có sẵn thay vì thêm thẻ mới.
    const [renaming, setRenaming] = useState(null)
    const [renameValue, setRenameValue] = useState('')
    // Tên bàn đang mở chi tiết. Giữ TÊN chứ không giữ object bàn: openTables đổi sau
    // mỗi lần xoá đợt, ôm object cũ là modal hiện số tiền đã chết. Seed từ
    // location.state.openTableDetail (tới từ Nhật ký) — bàn không còn mở (đã tính tiền)
    // thì detailTable dưới đây không tìm thấy, modal chỉ hiện lưới, không lỗi.
    const [detail, setDetail] = useState(state?.openTableDetail || null)
    // Modal danh sách đơn mang đi chưa ra món (TakeawayListModal) đang mở hay không.
    const [showTakeaway, setShowTakeaway] = useState(false)

    // Bàn có thể vừa được mở/đóng ở máy khác — đồng bộ lại mỗi lần mở modal thay vì
    // nuôi thêm một kênh realtime. Component chỉ mount khi mở (xem CheckoutBar) nên
    // effect này = "mở modal", và lúc đóng không còn render rỗng ăn theo mỗi cú chạm món.
    // inline (tablet, POSPage) thì KHÔNG mount-khi-mở — nó sống suốt vòng đời /pos và
    // POSContext đã tự refreshTables lúc đó rồi (xem effect dineIn/isPosPage ở đó); bắn
    // thêm 1 request y hệt ngay lúc mount chỉ là 2 response đua nhau, cái về sau có thể
    // đè cái mới hơn.
    useEffect(() => { if (!inline) refreshTables() }, [inline, refreshTables])

    const canEdit = isManager || isAdmin
    // Set: tên bàn là React key, danh sách trùng tên (ghi tay vào DB) sẽ làm hỏng lưới.
    const configured = [...new Set(selectedAddress?.tables || [])]
    // Bàn có khách nhưng không nằm trong danh sách cố định (mở tạm trong ca, hoặc vừa
    // bị xoá khỏi danh sách) vẫn phải hiện — nếu không thì tiền của bàn đó biến mất
    // khỏi màn hình dù đơn vẫn còn trong DB.
    const adHoc = [...new Set([...openTables.map(t => t.name), tableName].filter(n => n && !configured.includes(n)))]
    const names = [...configured, ...adHoc]
    const statsOf = (name) => openTables.find(t => t.name === name) || { name, total: 0, rounds: [], openedAt: null, lines: [] }
    const detailTable = detail ? openTables.find(t => t.name === detail) : null
    // Đơn mang đi chưa ra món — bucket name=null trong openTables (xem fetchOpenTables).
    // undefined khi không có đơn nào đang chờ, khi đó thẻ "Mang đi" ở dưới quay lại tile
    // tĩnh bấm-là-chọn như cũ.
    const takeaway = openTables.find(t => t.name === null)
    // Đơn nào cần chú ý nhất lên trước: chưa ra món trước đã ra, cùng nhóm thì mới nhất
    // trước — khác thứ tự "cũ nhất trước" của bàn (rounds trong 1 bàn đọc như biên bản,
    // đơn mang đi thì mỗi đơn độc lập nên ưu tiên đơn cần xử lý). Dùng chung cho cả preview
    // trên thẻ lưới và danh sách đầy đủ (TakeawayListModal) để hai chỗ khớp thứ tự nhau.
    const takeawayRounds = takeaway
        ? [...takeaway.rounds].sort((a, b) => {
            if (!!a.servedAt !== !!b.servedAt) return a.servedAt ? 1 : -1
            return new Date(b.createdAt) - new Date(a.createdAt)
        })
        : []
    const takeawayPending = pendingCups(takeawayRounds)

    // Bàn không bị cắt theo ngày (xem fetchOpenTables), nên bàn quên chưa tính tiền có
    // thể là của hôm qua. Giờ mở KHÔNG hiện trên thẻ — cái nhân viên cần đọc là danh
    // sách món; chỉ ngày khác hôm nay mới đáng cảnh báo (thẻ hiện "Từ 08/08"), còn
    // giờ đầy đủ để lại trong hộp xác nhận tính tiền.
    const staleLabel = (iso) => (iso && !isSameDayVN(new Date(iso), new Date())) ? `Từ ${dateShortVN(new Date(iso))}` : null

    function pick(name) {
        setTableName(name)
        onClose?.()
    }

    async function handleOpenNew(e) {
        e.preventDefault()
        const name = newName.trim()
        if (!name) return
        setNewName('')
        setAdding(false)
        // Gõ "bàn 1" khi đã có "Bàn 1" thì dùng lại bàn cũ — khác hoa thường mà tách
        // thành hai bàn là mất một nửa tiền của khách.
        const target = names.find(n => n.toLowerCase() === name.toLowerCase()) || name
        // Quản lý gõ tên = tạo sẵn luôn vào danh sách cố định (lần sau khỏi gõ lại).
        // Kể cả tên đang tồn tại dưới dạng bàn tạm — "Thêm" phải đưa được nó vào danh
        // sách, không thì bàn tạm không bao giờ lên cố định được.
        // Nhân viên không có quyền ghi addresses → bàn chỉ sống trong ca, vẫn gắn được
        // vào đơn bình thường.
        if (canEdit && !configured.includes(target)) {
            try { await setTables(selectedAddress.id, [...configured, target]) }
            catch (err) { showError(err, 'Lưu danh sách bàn') }
        }
        pick(target)
    }

    async function handleRemove(name) {
        const ok = await confirm({
            title: `Xoá ${name}?`,
            detail: 'Bàn sẽ gỡ khỏi danh sách. Hành động này không thể hoàn tác!',
            danger: true,
            confirmLabel: 'Xoá',
        })
        if (!ok) return
        try { await setTables(selectedAddress.id, configured.filter(n => n !== name)) }
        catch (err) { showError(err, 'Xoá bàn') }
    }

    function startRename(name) {
        setRenaming(name)
        setRenameValue(name)
    }

    async function handleRename(e, oldName) {
        e.preventDefault()
        const name = renameValue.trim()
        if (!name || name === oldName) { setRenaming(null); return }
        // Cùng kiểm tra trùng tên (không phân biệt hoa thường) như thêm bàn mới —
        // đổi trùng vào tên bàn khác sẽ gộp lộn hai bàn làm một. KHÔNG đóng form ở đây
        // (khác nhánh dưới) — đóng rồi thì tên gõ mất, người dùng chỉ thấy card trả về
        // tên cũ như "bấm Lưu không ăn", trong khi thật ra bị chặn trùng tên.
        if (names.some(n => n !== oldName && n.toLowerCase() === name.toLowerCase())) {
            showError(Object.assign(new Error(`Bàn "${name}" đã tồn tại`), { expected: true }), 'Đổi tên bàn')
            return
        }
        setRenaming(null)
        try {
            await setTables(selectedAddress.id, configured.map(n => n === oldName ? name : n))
            // Bàn đang có khách → đổi luôn table_name của các đợt đang mở, không thì bàn
            // rơi khỏi danh sách cố định (thành ad-hoc) trong khi bill vẫn ghi tên cũ.
            if (statsOf(oldName).rounds.length > 0) {
                await renameTableOrders(selectedAddress.id, oldName, name)
                await refreshTables()
            }
            if (tableName === oldName) setTableName(name)
            if (detail === oldName) setDetail(name)
        } catch (err) { showError(err, 'Đổi tên bàn') }
    }

    // Header + body + child modals shared by both the mobile Dialog and the tablet
    // inline panel (see `inline` prop) — only the outer chrome (backdrop, and the
    // close button which inline has no use for) differs.
    const inner = (
        <>
            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                {orderCount > 0 && (
                    <p className="text-[12px] font-bold text-warning bg-warning/10 border border-warning/40 rounded-[14px] px-4 py-3">
                        Đang có {orderCount} ly chưa gửi — sẽ tính cho bàn bạn chọn ở đây.
                    </p>
                )}

                <div className="grid grid-cols-2 gap-3">
                    {/* Đơn mang đi ở quán có bàn: bỏ chọn bàn, đơn về lại dạng không nhãn.
                        Có đơn đang chờ ra món thì hiện overview như thẻ bàn busy — chạm 1 cái
                        để CHỌN (như mọi thẻ khác), chạm cái nữa vào đúng thẻ đang chọn mới mở
                        danh sách chi tiết. Không thì tile tĩnh bấm-là-chọn như trước. */}
                    {takeaway ? (
                        <div className={`${CARD_H} relative rounded-[20px] border p-3.5 flex flex-col gap-1.5 transition-colors ${!tableName ? 'bg-primary/5 border-primary' : 'bg-surface border-border/60'}`}>
                            {/* Chỉ đổi tiêu điểm, không pick('') (không gọi onClose) — mobile
                                là bottom-sheet, đóng ngay thì tap thứ 2 (mở chi tiết) không còn
                                gì để nhấn vào, phải mở lại sheet từ đầu. */}
                            <button onClick={() => (!tableName ? setShowTakeaway(true) : setTableName(''))} className="flex-1 min-h-0 w-full overflow-hidden text-left flex flex-col gap-1 focus:outline-none">
                                <span className="shrink-0 w-full flex items-baseline justify-between gap-2">
                                    <span className="text-[13px] font-black uppercase tracking-wide text-text">Mang đi</span>
                                    <span className="shrink-0 text-[12px] font-black tabular-nums text-text-secondary">{takeawayRounds.length} đơn</span>
                                </span>
                                {roundPreview(takeawayRounds)}
                                {/* shrink-0: dòng cảnh báo này quan trọng hơn danh sách đợt phía
                                    trên (min-h-0 overflow-hidden ở roundPreview) — bàn/đơn có nhiều
                                    đợt chưa ra thì roundPreview bị cắt bớt trước, KHÔNG được để cắt
                                    mất dòng tổng này (từng xảy ra: 6 món chưa ra mà thẻ không hiện).
                                    Cùng lý do cho dòng "N món chưa ra" ở thẻ bàn bên dưới. */}
                                {takeawayPending > 0 && (
                                    <span className="shrink-0 mt-auto text-[11px] font-black uppercase tracking-wide text-warning">
                                        {takeawayPending} món chưa ra
                                    </span>
                                )}
                            </button>
                        </div>
                    ) : (
                        <button
                            onClick={() => pick('')}
                            className={`${CARD_H} rounded-[20px] border p-3.5 flex flex-col items-center justify-center transition-colors ${!tableName ? 'bg-primary/5 border-primary' : 'bg-surface border-border/60 hover:border-primary/40'}`}
                        >
                            <span className="text-[13px] font-black uppercase tracking-wide text-text">Mang đi</span>
                        </button>
                    )}

                    {names.map(name => {
                        const t = statsOf(name)
                        const active = name === tableName
                        const busy = t.rounds.length > 0
                        const stale = staleLabel(t.openedAt)
                        const pending = pendingCups(t.rounds)
                        return (
                            <div
                                key={name}
                                className={`${CARD_H} relative rounded-[20px] border p-3.5 flex flex-col gap-1.5 transition-colors ${active ? 'bg-primary/5 border-primary' : busy ? 'bg-surface border-border/60' : 'bg-surface/50 border-border/40'}`}
                            >
                                {/* Đổi tên: chạm thẳng vào tên bàn (xem span bên dưới), không cần
                                    nút riêng. Xoá: chỉ bàn trống — bàn còn khách mà biến mất khỏi
                                    lưới thì không ai bấm tính tiền cho nó được nữa. */}
                                {canEdit && !busy && configured.includes(name) && renaming !== name && (
                                    <button
                                        onClick={() => handleRemove(name)}
                                        aria-label={`Xoá ${name}`}
                                        className="absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center text-text-secondary/60 hover:text-danger transition-colors"
                                    >
                                        <X size={14} strokeWidth={3} />
                                    </button>
                                )}
                                {renaming === name && (
                                    <form onSubmit={e => handleRename(e, name)} className="flex-1 min-h-0 flex flex-col justify-center gap-2">
                                        <input
                                            type="text"
                                            autoFocus
                                            value={renameValue}
                                            onChange={e => setRenameValue(e.target.value)}
                                            onFocus={e => e.target.select()}
                                            className="w-full min-w-0 bg-surface-light border border-border/60 rounded-[12px] px-3 py-2 text-[13px] font-black uppercase tracking-wide text-text focus:outline-none focus:border-primary/40 transition-colors"
                                        />
                                        <div className="flex gap-1.5">
                                            <button type="button" onClick={() => setRenaming(null)} className="flex-1 py-1.5 rounded-[10px] bg-surface-light border border-border/60 text-[11px] font-black uppercase tracking-wide text-text-secondary hover:text-text transition-colors">
                                                Huỷ
                                            </button>
                                            <button type="submit" disabled={!renameValue.trim()} className="flex-1 py-1.5 rounded-[10px] bg-primary text-bg text-[11px] font-black uppercase tracking-wide disabled:opacity-50 hover:bg-primary/90 transition-colors">
                                                Lưu
                                            </button>
                                        </div>
                                    </form>
                                )}
                                {/* Thẻ = tờ hoá đơn đang chạy. Tên và tổng cùng một hàng vì đó là
                                    hai thứ hay đọc chung; danh sách đợt ở dưới (giờ gọi + đã/chưa ra
                                    món) để nhân viên overview được cả bàn mà không cần bấm vào từng
                                    bàn — cắt bớt cho vừa khung, bản đầy đủ (kèm món) nằm trong modal
                                    chi tiết.
                                    Bàn có khách mà CHƯA phải bàn đang chọn: chạm = chỉ chọn (focus),
                                    giống mọi thẻ khác — không nhảy thẳng vào chi tiết khi nhân viên
                                    còn đang lướt qua các bàn. Chạm lần nữa vào đúng bàn đang chọn
                                    (active) mới mở chi tiết (đọc/sửa/thu tiền đều ở đó). Bàn trống:
                                    không có gì để đọc, chạm = chọn bàn luôn, không có bước 2. */}
                                {renaming !== name && (
                                    <button onClick={() => (busy && active) ? setDetail(name) : (busy ? setTableName(name) : pick(name))} className="flex-1 min-h-0 w-full overflow-hidden text-left flex flex-col gap-1 focus:outline-none">
                                        <span className="shrink-0 w-full flex items-baseline justify-between gap-2">
                                            {/* Chạm thẳng vào tên = đổi tên (quản lý, bàn cố định) — tách khỏi
                                                hành vi chọn/mở chi tiết của nút cha bằng stopPropagation, không
                                                cần thêm nút bút chì riêng chiếm chỗ trên thẻ. */}
                                            {canEdit && configured.includes(name) ? (
                                                <span
                                                    onClick={e => { e.stopPropagation(); startRename(name) }}
                                                    className={`text-[13px] font-black uppercase tracking-wide line-clamp-1 hover:underline ${busy || active ? 'text-text' : 'text-text-secondary'}`}
                                                >
                                                    {name}
                                                </span>
                                            ) : (
                                                <span className={`text-[13px] font-black uppercase tracking-wide line-clamp-1 ${busy || active ? 'text-text' : 'text-text-secondary'}`}>{name}</span>
                                            )}
                                            {busy && <span className="shrink-0 text-[14px] font-black tabular-nums text-primary">{formatVND(t.total)}</span>}
                                        </span>
                                        {stale && <span className="shrink-0 text-[11px] font-bold text-text-secondary">{stale}</span>}
                                        {busy ? (
                                            roundPreview(t.rounds)
                                        ) : (
                                            <span className="text-[12px] font-bold text-text-secondary/50">Trống</span>
                                        )}
                                        {/* Còn ly chưa bưng ra — thứ duy nhất trên lưới mà nhân viên cần
                                            thấy trước khi bấm vào bàn. Chi tiết đợt nào thì mở thẻ ra xem.
                                            shrink-0: xem comment ở thẻ Mang đi phía trên. */}
                                        {pending > 0 && (
                                            <span className="shrink-0 mt-auto text-[11px] font-black uppercase tracking-wide text-warning">
                                                {pending} món chưa ra
                                            </span>
                                        )}
                                    </button>
                                )}
                            </div>
                        )
                    })}

                    {/* Ô "+" là một thẻ trong lưới, không phải form riêng ở trên: bấm mới
                        mở ô gõ tên, để lưới không bị một hàng input chiếm chỗ mãi. */}
                    {adding ? (
                        <form onSubmit={handleOpenNew} className={`${CARD_H} rounded-[20px] border border-primary bg-primary/5 p-3 flex flex-col justify-center gap-2`}>
                            <input
                                type="text"
                                autoFocus
                                value={newName}
                                onChange={e => setNewName(e.target.value)}
                                onBlur={() => { if (!newName.trim()) setAdding(false) }}
                                placeholder={canEdit ? 'Tên bàn' : 'Bàn tạm'}
                                className="w-full min-w-0 bg-surface-light border border-border/60 rounded-[12px] px-3 py-2 text-[13px] font-black uppercase tracking-wide text-text placeholder:text-text-secondary/50 placeholder:normal-case placeholder:tracking-normal placeholder:font-medium focus:outline-none focus:border-primary/40 transition-colors"
                            />
                            <button
                                type="submit"
                                disabled={!newName.trim()}
                                className="w-full py-2 rounded-[12px] bg-primary text-bg text-[12px] font-black uppercase tracking-wider disabled:opacity-50 hover:bg-primary/90 active:bg-primary/80 transition-colors"
                            >
                                Thêm
                            </button>
                        </form>
                    ) : (
                        <button
                            onClick={() => setAdding(true)}
                            className={`${CARD_H} w-full rounded-[20px] border border-dashed border-border/60 p-4 flex flex-col items-center justify-center gap-1.5 text-text-secondary hover:text-text hover:border-primary/40 transition-colors`}
                        >
                            <Plus size={20} strokeWidth={3} />
                            <span className="text-[12px] font-black uppercase tracking-wide">{canEdit ? 'Thêm bàn' : 'Bàn tạm'}</span>
                        </button>
                    )}
                </div>

                {names.length === 0 && !canEdit && (
                    <p className="text-center text-[13px] font-medium text-text-secondary py-2">
                        Chưa có bàn nào. Nhờ quản lý tạo danh sách bàn.
                    </p>
                )}
            </div>

            {/* Tra lại openTables mỗi lần render: xoá một đợt trong modal chi tiết phải
                thấy tiền bàn tụt xuống ngay tại đó. Bàn không còn (máy khác vừa tính tiền
                / đợt cuối vừa bị xoá) → không tìm thấy → modal tự đóng. */}
            {detailTable && (
                <TableDetailModal
                    table={detailTable}
                    tableNames={names}
                    onClose={() => setDetail(null)}
                    onPick={() => pick(detail)}
                />
            )}
            {/* takeaway && cùng lý do detailTable && ở trên: đơn cuối vừa ra món/chuyển đi
                thì bucket biến mất, modal tự đóng theo thay vì hiện danh sách rỗng. */}
            {showTakeaway && takeaway && (
                <TakeawayListModal
                    orders={takeawayRounds}
                    tableNames={names}
                    onClose={() => setShowTakeaway(false)}
                    onPick={() => pick('')}
                />
            )}
        </>
    )

    // inline: no backdrop/panel chrome — POSPage's <aside> already owns the
    // flex/h-full/bg box, so this just hands back the shared content.
    if (inline) return inner

    return (
        <Dialog onClose={onClose} panelClassName="w-full max-w-md mx-4 max-h-[92dvh] flex flex-col bg-surface border border-border/60 rounded-[24px] shadow-2xl overflow-hidden">
            {inner}
        </Dialog>
    )
}
