import { memo, useState, useEffect, useRef } from 'react'
import { ChevronDown } from 'lucide-react'
import { BarChart, Bar, CartesianGrid, XAxis } from 'recharts'
import { formatVND } from '../../utils'
import { useClickOutside } from '../../hooks/useClickOutside'

const CHART_HEIGHT = 200

// memo: parent (DailyReportPage) re-renders on every cash/inventory keystroke;
// all props here come from page-level useMemo / stable setters, so memo lets the
// recharts subtree bail out instead of re-rendering per keystroke.
function SalesCard({
    totalCups,
    products,
    soldProducts,
    totalRevenue,
    productStats,
    lineChartData,
    showChart = true,
}) {
    const [expandedId, setExpandedId] = useState(null)
    const [showAllProducts, setShowAllProducts] = useState(false)
    const [activePoint, setActivePoint] = useState(null)
    const [chartWidth, setChartWidth] = useState(0)
    const wrapperRef = useRef(null)

    useEffect(() => {
        if (!wrapperRef.current) return
        const ro = new ResizeObserver(([entry]) => setChartWidth(entry.contentRect.width))
        ro.observe(wrapperRef.current)
        return () => ro.disconnect()
    }, [])

    useClickOutside(wrapperRef, () => setActivePoint(null))

    const handleChartClick = (e) => {
        if (e?.target?.dataset?.bar !== 'true') setActivePoint(null)
    }

    const peakRevenue = lineChartData.length > 0 ? Math.max(...lineChartData.map(d => d.hourRevenue)) : 0

    // Custom shape (not recharts <Bar>'s default) so the peak hour can be highlighted
    // and tap-to-pin the same tooltip the old line chart used. Passed to <Bar> as a plain
    // function (not a JSX element) — recharts calls function-shapes directly instead of
    // reconciling them as a component, so redefining it each render (needed to close over
    // activePoint) doesn't force-remount the bars. Remounting mid-click was dropping fast
    // successive clicks on different bars.
    const renderBar = (props) => {
        const { x, y, width, height, payload, index } = props
        const isActive = activePoint?.hour === payload.hour
        const isPeak = peakRevenue > 0 && payload.hourRevenue === peakRevenue
        const prevEntry = index > 0 ? lineChartData[index - 1] : null
        return (
            <g>
                {isPeak && (
                    <text x={x + width / 2} y={y - 6} textAnchor="middle" fontSize={9} fontWeight="900" fill="#f59e0b">
                        Cao điểm
                    </text>
                )}
                <rect
                    data-bar="true"
                    x={x} y={y} width={width} height={Math.max(height, 1)}
                    rx={4}
                    fill={isActive || isPeak ? '#f59e0b' : '#57534e'}
                    style={{ cursor: 'pointer' }}
                    onClick={(e) => {
                        e.stopPropagation()
                        if (isActive) {
                            setActivePoint(null)
                        } else {
                            setActivePoint({
                                cx: x + width / 2, cy: y,
                                hour: payload.hour,
                                items: payload.items || [],
                                hourRevenue: payload.hourRevenue || 0,
                                revenue: payload.revenue || 0,
                                prevRevenue: prevEntry ? prevEntry.hourRevenue : null,
                            })
                        }
                    }}
                />
            </g>
        )
    }

    const rankedProducts = Object.entries(productStats || {})
        .filter(([id]) => soldProducts.has(id))
        .sort((a, b) => b[1].revenue - a[1].revenue)
        .map(([id, stats]) => ({ id, name: products.find(p => p.id === id)?.name || '', ...stats }))

    const getTooltipStyle = () => {
        // Use measured width (ResizeObserver state) + the fixed chart height instead of
        // reading the ref's layout during render — avoids the stale-render hazard and the
        // value is identical (the wrapper's height is locked to CHART_HEIGHT).
        if (!activePoint || !chartWidth) return {}
        const tooltipWidth = 220
        const left = Math.max(tooltipWidth / 2 + 8, Math.min(activePoint.cx, chartWidth - tooltipWidth / 2 - 8))
        return {
            position: 'absolute',
            left,
            top: activePoint.cy,
            // Always above the bar's top edge — a below-placement can land on top of
            // neighboring hour columns and block taps on them.
            transform: 'translate(-50%, calc(-100% - 14px))',
            zIndex: 50,
            pointerEvents: 'none',
            width: 'fit-content',
            minWidth: 140,
            maxWidth: tooltipWidth,
        }
    }

    return (
        <div className="bg-surface rounded-[24px] p-5 shadow-sm border border-border/60 flex flex-col gap-4">
            {/* Row: Tổng cộng + Doanh thu */}
            <div className="flex items-start justify-between">
                {/* Left: cup count */}
                <div className="flex flex-col min-w-0 flex-1 mt-1">
                    <span className="text-[12px] font-black text-text uppercase mb-1">Tổng cộng</span>
                    <span className="text-[17px] font-bold text-primary tabular-nums leading-none truncate">
                        {totalCups} ly
                    </span>
                </div>

                {/* Right: revenue */}
                <div className="flex flex-col items-end shrink-0 ml-3">
                    <span className="text-[12px] font-black text-text uppercase mb-0.5">Doanh thu</span>
                    <span className={`text-[17px] font-bold tabular-nums leading-none ${totalRevenue > 0 ? 'text-success' : 'text-text-secondary'}`}>
                        {formatVND(totalRevenue || 0)}
                    </span>
                </div>
            </div>

            {rankedProducts.length > 0 && (<>
                <div className="h-[1px] bg-border/30 -mx-1" />
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="text-[11px] font-black uppercase text-text-secondary tracking-widest">Trong đó</h3>
                        {rankedProducts.length > 3 && (
                            <button
                                type="button"
                                onClick={() => setShowAllProducts(v => !v)}
                                aria-label={showAllProducts ? 'Thu gọn' : 'Xem thêm'}
                                className="text-text-secondary hover:text-primary transition-colors"
                            >
                                <ChevronDown size={16} className={`transition-transform ${showAllProducts ? 'rotate-180' : ''}`} />
                            </button>
                        )}
                    </div>
                    <div className="flex flex-col gap-1">
                        {(showAllProducts ? rankedProducts : rankedProducts.slice(0, 3)).map((p) => {
                            const isExpanded = expandedId === p.id
                            // >1 check, not >0: a single-variant product (everything bucketed
                            // under 'Thường') would just repeat the qty already shown above.
                            const variants = p.variants && Object.keys(p.variants).length > 1
                                ? Object.entries(p.variants).sort((a, b) => {
                                    if (a[0] === 'Thường') return -1
                                    if (b[0] === 'Thường') return 1
                                    return b[1] - a[1]
                                })
                                : []
                            return (
                                <button
                                    key={p.id}
                                    type="button"
                                    onClick={() => setExpandedId(isExpanded ? null : p.id)}
                                    className="flex flex-col text-left rounded-lg -mx-1 px-1 py-1"
                                >
                                    <div className="flex items-center justify-between">
                                        <span className="text-[12px] font-bold truncate text-text">
                                            {p.name} <span className="text-text-secondary font-medium">x {p.qty} ly</span>
                                        </span>
                                        <span className="text-[13px] font-black text-primary tabular-nums shrink-0 ml-2">{formatVND(p.revenue)}</span>
                                    </div>
                                    {isExpanded && variants.length > 0 && (
                                        <div className="flex flex-col gap-0.5">
                                            {variants.map(([label, qty]) => (
                                                <span key={label} className="text-[11px] text-text-secondary tabular-nums">
                                                    <span className="text-[8px] leading-none text-text-dim">●</span> <span className="font-black text-text">{label}</span>: {qty} ly
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </button>
                            )
                        })}
                    </div>
                </div>
            </>)}

            {/* Revenue chart — hidden on range scopes (bar chart shown separately) */}
            {showChart && (<>
            <div>
                {lineChartData.length > 0 ? (
                    <div
                        className="w-full relative [&_*]:outline-none [&_*]:focus:outline-none"
                        style={{ height: CHART_HEIGHT }}
                        ref={wrapperRef}
                        onClick={handleChartClick}
                    >
                        {activePoint && (
                            <div style={getTooltipStyle()}>
                                <div className="bg-[#1c1917] border border-[#44403c] rounded-[14px] px-3 py-2.5 shadow-xl">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-[11px] font-black text-warning uppercase tracking-wider">{activePoint.hour}</span>
                                        <span className="text-[11px] font-black text-warning">+{formatVND(activePoint.hourRevenue)}</span>
                                    </div>
                                    {activePoint.items.length === 0 ? (
                                        <span className="text-[12px] text-[#a8a29e]">Không có đơn</span>
                                    ) : (
                                        <div className="flex flex-col gap-1 mb-2">
                                            {activePoint.items.map((item, i) => (
                                                <span key={i} className="text-[12px] text-[#fafaf9] font-medium leading-snug">
                                                    {item.qty} {item.name}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                    {activePoint.prevRevenue !== null && (
                                        <div className="flex flex-col items-start border-t border-[#44403c] pt-1.5 mt-1">
                                            <span className="text-[11px] text-warning">Tổng: {formatVND(activePoint.revenue)}</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                        {chartWidth > 0 && (
                            <BarChart width={chartWidth} height={CHART_HEIGHT} data={lineChartData} margin={{ top: 20, right: 0, left: 0, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#44403c" vertical={false} />
                                <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#a8a29e' }} axisLine={false} tickLine={false} tickMargin={10} />
                                <Bar dataKey="hourRevenue" shape={renderBar} />
                            </BarChart>
                        )}
                    </div>
                ) : (
                    <div className="text-center text-text-secondary text-[12px] py-4 bg-surface-light rounded-xl border border-border/40">
                        Chưa có dòng tiền trong ngày
                    </div>
                )}
            </div>
            </>)}
        </div>
    )
}

export default memo(SalesCard)
