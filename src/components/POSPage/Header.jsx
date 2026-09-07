import { useState, useEffect } from 'react'
import { ArrowRight } from 'lucide-react'
import { onboardingHintClass } from '../../utils/onboardingHint'

// Types the draft text out left→right. Keyed by the held item's id (in render)
// so a NEW tap retypes from scratch; toggling extras only grows the text, so the
// suffix (e.g. " · Lớn") types on without restarting.
function Typewriter({ text }) {
    const [n, setN] = useState(0)
    useEffect(() => {
        if (n >= text.length) return
        const id = setTimeout(() => setN(n + 1), 25)
        return () => clearTimeout(id)
    }, [n, text.length])
    return <>{text.slice(0, n)}{n < text.length && <span className="opacity-50">▌</span>}</>
}

export default function Header({ dayName, dateOnly, onOpenHistory, addressName, onAddressClick, recentOrders = [], draftOrder, enterKey, showOnboardingHint = false, dineIn = false }) {
    const hintClass = onboardingHintClass(showOnboardingHint, 'light')
    // Draft (held, unsaved) line on top, then saved orders. Cap at 3 rows.
    // key 'draft' is stable so extras overwrite it in place; typeKey = the held
    // item's id so the typewriter restarts only on a new tap. isNew matches only the
    // exact row just committed locally (enterKey) → the realtime DB echo, which
    // remounts the row under a new server-timestamp key, can't replay the slide-in.
    const rows = [
        ...(draftOrder ? [{ key: 'draft', draft: true, isNew: false, typeKey: draftOrder.cartItemId, text: draftOrder.items.join(' · ') }] : []),
        ...recentOrders.map(o => ({
            key: o.id ?? o.createdAt, // id is collision-proof; createdAt (ms) can repeat on same-tick commits
            draft: false,
            isNew: o.createdAt === enterKey,
            text: o.items.join(' · '),
        })),
    ].slice(0, 3)
    return (
        <header className="shrink-0 pt-6 pb-6 bg-surface border-b border-border/60 shadow-[0_8px_30px_rgba(0,0,0,0.03)] relative z-20">
            <div className="px-6 grid grid-cols-2 gap-3 mb-1">
                {/* Card 1: Address & Status */}
                <div
                    onClick={onAddressClick}
                    role="button"
                    tabIndex={0}
                    className="cursor-pointer bg-bg hover:bg-surface active:bg-border/20 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40 rounded-[20px] p-3 sm:p-3.5 border border-border/60 shadow-sm flex flex-col justify-center gap-[2px] relative overflow-hidden h-full"
                >
                    <div className="flex flex-col justify-between items-start relative z-10 w-full">
                        <span className="text-[12px] sm:text-[13px] text-text-secondary font-black uppercase tracking-wider">Địa chỉ</span>
                        <div className="flex items-center justify-between w-full mt-0.5">
                            {addressName && <span className="text-[13px] text-success font-black uppercase tracking-wider line-clamp-1">{addressName}</span>}
                        </div>
                    </div>
                    <div className="w-full h-[1px] bg-border/60 rounded-full relative z-10 my-[3px] mt-[4px]"></div>
                    <div className="flex flex-col justify-between items-start relative z-10 mt-[6px]">
                        <span className="text-[13px] sm:text-[13px] text-text-secondary font-bold uppercase tracking-wider">{dayName}</span>
                        <div className="flex items-center gap-1.5">
                            <span className="text-[14px] sm:text-[14px] text-text font-black uppercase tracking-tight">{dateOnly}</span>
                        </div>
                    </div>
                    <div className="absolute top-0 right-0 w-24 h-24 bg-success/5 rounded-full blur-2xl -mr-10 -mt-10 pointer-events-none" />
                </div>

                {/* Card 2: Revenue / Cost / Profit */}
                <div
                    onClick={onOpenHistory}
                    role="button"
                    tabIndex={0}
                    className={`cursor-pointer bg-linear-to-b from-primary to-primary-dark rounded-[20px] p-3 sm:p-3.5 border border-primary shadow-sm flex flex-col gap-[2px] relative overflow-hidden h-full hover:brightness-105 active:brightness-95 transition-all focus:outline-none focus:ring-2 focus:ring-primary/40 ${hintClass}`}
                >
                    {/* <div className="flex flex-col justify-between relative z-10">
                        <span className="text-[12px] sm:text-[13px] text-text-secondary font-bold uppercase tracking-wider">{dayName}</span>
                        <span className="text-[15px] sm:text-[16px] text-text font-black tracking-tight">{dateOnly}</span>
                    </div>

                    <div className="w-full h-[1px] bg-primary/15 rounded-full relative z-10 my-[3px]"></div> */}

                    <div className="flex flex-col justify-between items-start relative z-10 w-full">
                        <div className="flex items-center justify-between w-full">
                            <span className="text-[12px] sm:text-[13px] text-white font-black uppercase tracking-wider">Nhật ký</span>
                            {/* Draft pending → check: "tap to commit". Otherwise arrow: "go to history".
                                dineIn: giỏ chỉ chốt qua nút Thanh toán ở CheckoutBar, nên ✓ ở đây sẽ
                                hứa một hành động không xảy ra — giữ mũi tên. */}
                            <span className="shrink-0 w-6 h-6 rounded-full bg-white shadow-sm flex items-center justify-center">
                                {draftOrder && !dineIn
                                    ? (
                                        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.125} strokeLinecap="round" strokeLinejoin="round" className="text-bg check-draw">
                                            <path d="M4 12 9 17 20 6" pathLength="1" />
                                        </svg>
                                    )
                                    : <ArrowRight size={16} strokeWidth={3.125} className="text-bg" />}
                            </span>
                        </div>
                        <div className="w-full">
                            {rows.length > 0 ? (
                                <div className="flex flex-col mt-1.5 gap-2">
                                    {rows.map((r) => (
                                        <div
                                            key={r.key}
                                            className={`${r.isNew ? 'order-enter' : ''} flex items-baseline gap-2 px-1 -mx-1 rounded text-[12px] font-bold uppercase tracking-tight leading-snug text-white`}
                                        >
                                            <span className={`shrink-0 text-[15px] leading-none ${r.draft ? 'text-white' : 'text-white/70'}`}>•</span>
                                            <span className="line-clamp-1">
                                                {r.draft ? <Typewriter key={r.typeKey} text={r.text} /> : r.text}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <span className="text-[13px] font-bold text-white/70">Chưa có đơn</span>
                            )}
                        </div>
                    </div>
                    <div className="absolute bottom-0 right-0 w-24 h-24 bg-white/15 rounded-full blur-2xl -mr-10 -mb-10 pointer-events-none" />
                </div>
            </div>
        </header >
    )
}
