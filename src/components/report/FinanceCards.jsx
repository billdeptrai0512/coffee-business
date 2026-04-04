import { Banknote, ArrowRight, MinusCircle, Activity } from 'lucide-react'
import { formatVND } from '../../utils'

export default function FinanceCards({ totalRevenue, totalCOGS, totalExpense, netProfit, onRecipesClick, onExpenseClick }) {
    return (
        <div className="grid grid-cols-2 gap-3">
            <div className="bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 flex flex-col justify-center relative overflow-hidden group">
                <div className="absolute top-3 right-3 text-success/20 group-hover:text-success/30 transition-colors">
                    <Banknote size={36} />
                </div>
                <h3 className="text-[12px] font-black text-text-secondary uppercase mb-1">Doanh thu</h3>
                <div className="text-[18px] font-bold text-success tabular-nums">
                    {formatVND(totalRevenue)}
                </div>
            </div>
            <div
                onClick={onRecipesClick}
                className="bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 flex flex-col justify-center relative overflow-hidden group cursor-pointer hover:bg-surface-light active:scale-[0.98] transition-all"
            >
                <div className="absolute top-3 right-3 text-warning/30 group-hover:text-warning/50 transition-colors">
                    <ArrowRight size={36} />
                </div>
                <h3 className="text-[12px] font-black text-text-secondary uppercase mb-1">Giá vốn</h3>
                <div className="text-[18px] font-bold text-warning tabular-nums">
                    - {formatVND(totalCOGS)}
                </div>
            </div>
            <div
                onClick={onExpenseClick}
                className="bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 flex flex-col justify-center relative overflow-hidden group cursor-pointer hover:bg-surface-light active:scale-[0.98] transition-all"
            >
                <div className="absolute top-3 right-3 text-danger/20 group-hover:text-danger/30 transition-colors">
                    <MinusCircle size={36} />
                </div>
                <h3 className="text-[12px] font-black text-text-secondary uppercase mb-1">Chi phí</h3>
                <div className="text-[18px] font-bold text-danger tabular-nums">
                    - {formatVND(totalExpense)}
                </div>
            </div>
            <div className="bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 flex flex-col justify-center relative overflow-hidden group">
                <div className="absolute top-3 right-3 text-success/20 group-hover:text-success/30 transition-colors">
                    <Activity size={36} />
                </div>
                <h3 className="text-[12px] font-black text-text-secondary uppercase mb-1">Lợi nhuận ròng</h3>
                <div className="text-[18px] font-bold text-success tabular-nums">
                    {formatVND(netProfit)}
                </div>
            </div>
        </div>
    )
}
