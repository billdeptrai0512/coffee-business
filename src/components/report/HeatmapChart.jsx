import { Activity } from 'lucide-react'

export default function HeatmapChart({ hourRange, soldProducts, products, heatmapData, maxHeatmapQty }) {
    return (
        <div className="bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 overflow-hidden">
            <div className="flex flex-col mb-4">
                <div className="flex items-center gap-2">
                    <Activity className="text-primary" size={20} />
                    <h3 className="text-[14px] font-black uppercase text-text-primary">Bán món gì / Thời điểm</h3>
                </div>
                <p className="text-[12px] text-text-secondary mt-1 ml-7">Giúp quyết định thời điểm chuẩn bị nguyên liệu (Prep).</p>
            </div>

            {hourRange.length > 0 ? (
                <div className="overflow-x-auto hide-scrollbar pb-2">
                    <div className="min-w-max">
                        <div className="flex border-b border-border/40 pb-2 mb-2">
                            <div className="w-[100px] shrink-0 text-[10px] uppercase text-text-secondary font-bold">Món \ Giờ</div>
                            {hourRange.map(h => (
                                <div key={h} className="w-8 shrink-0 text-center text-[10px] text-text-secondary font-bold">{h}h</div>
                            ))}
                        </div>
                        {Array.from(soldProducts).map(productId => {
                            const prodDef = products.find(p => p.id === productId)
                            const pName = prodDef ? prodDef.name : 'Unknown'
                            return (
                                <div key={productId} className="flex items-center py-[6px]">
                                    <div className="w-[100px] shrink-0 text-[11px] font-medium text-text-primary truncate pr-2" title={pName}>{pName}</div>
                                    {hourRange.map(h => {
                                        const qty = heatmapData[productId]?.[h] || 0
                                        const intensity = maxHeatmapQty > 0 ? qty / maxHeatmapQty : 0
                                        return (
                                            <div key={h} className="w-8 shrink-0 flex justify-center">
                                                <div
                                                    className="w-[26px] h-[26px] rounded-md flex items-center justify-center text-[11px] font-bold transition-all"
                                                    style={{
                                                        backgroundColor: qty > 0 ? `rgba(245, 158, 11, ${Math.max(0.15, intensity)})` : 'transparent',
                                                        color: qty > 0 ? (intensity > 0.5 ? '#fff' : '#f59e0b') : 'transparent'
                                                    }}
                                                >
                                                    {qty > 0 ? qty : ''}
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            )
                        })}
                    </div>
                </div>
            ) : (
                <div className="text-center text-text-secondary text-[12px] py-4 bg-surface-light rounded-xl border border-border/40">
                    Chưa có dữ liệu hôm nay
                </div>
            )}
        </div>
    )
}
