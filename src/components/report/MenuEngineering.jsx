import { ShoppingBag } from 'lucide-react'
import { formatVND } from '../../utils'

export default function MenuEngineering({ classifiedItems }) {
    const tagColors = {
        Star: 'bg-success/15 text-success border-success/30',
        Plow: 'bg-warning/15 text-warning border-warning/30',
        Puzzle: 'bg-primary/15 text-primary border-primary/30',
        Dog: 'bg-danger/15 text-danger border-danger/30'
    }

    return (
        <div className="bg-surface rounded-[24px] p-4 shadow-sm border border-border/60">
            <div className="flex flex-col mb-4">
                <div className="flex items-center gap-2">
                    <ShoppingBag className="text-success" size={20} />
                    <h3 className="text-[14px] font-black uppercase text-text-primary">Menu / Số ly / Biên lợi nhuận</h3>
                </div>
                <p className="text-[12px] text-text-secondary mt-1 ml-7">Giúp quyết định giữ / bỏ / đẩy mạnh món nào.</p>
            </div>

            {classifiedItems.length > 0 ? (
                <div className="flex flex-col gap-3">
                    {classifiedItems.map(item => {
                        const maxRev = Math.max(...classifiedItems.map(i => i.revenue), 1)
                        const revWidth = Math.max(8, (item.revenue / maxRev) * 100)
                        const costWidth = item.revenue > 0 ? (item.cost / item.revenue) * 100 : 0

                        return (
                            <div key={item.id} className="bg-surface-light rounded-2xl p-3 border border-border/40">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-[13px] font-bold text-text-primary truncate pr-2">{item.name}</span>
                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${tagColors[item.tag]}`}>
                                        {item.emoji} {item.tag}
                                    </span>
                                </div>
                                <div className="flex items-center gap-3 mb-2">
                                    <span className="text-[11px] text-text-secondary">{item.qty} ly</span>
                                    <span className="text-[11px] text-success font-semibold">+{formatVND(item.profit)}</span>
                                    <span className={`text-[11px] font-bold ml-auto ${item.margin >= 50 ? 'text-success' : item.margin >= 30 ? 'text-warning' : 'text-danger'}`}>
                                        {item.margin.toFixed(0)}% margin
                                    </span>
                                </div>
                                <div className="h-[6px] rounded-full bg-border/30 overflow-hidden" style={{ width: `${revWidth}%` }}>
                                    <div className="h-full rounded-full bg-success" style={{ width: `${100 - costWidth}%` }}></div>
                                </div>
                                <div className="flex justify-between mt-1">
                                    <span className="text-[9px] text-text-dim">Vốn {formatVND(item.cost)}</span>
                                    <span className="text-[9px] text-text-dim">DT {formatVND(item.revenue)}</span>
                                </div>
                            </div>
                        )
                    })}
                </div>
            ) : (
                <div className="text-center text-text-secondary text-[12px] py-4 bg-surface-light rounded-xl border border-border/40">
                    Chưa có dữ liệu menu
                </div>
            )}
        </div>
    )
}
