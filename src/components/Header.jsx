import { formatVND } from '../utils'

export default function Header({ isOnline, dayName, dateOnly, cupsSold, revenue, totalCost, onOpenHistory }) {
    return (
        <header className="shrink-0 pt-6 pb-6 bg-surface border-b border-border/60 shadow-[0_8px_30px_rgba(0,0,0,0.03)] relative z-20">
            <div className="px-6 grid grid-cols-2 gap-3 mb-1">
                {/* Card 1: Date & Status */}
                <div className="bg-bg rounded-[20px] p-3.5 sm:p-4 border border-border/60 shadow-sm flex flex-col justify-center gap-1.5 sm:gap-2 relative overflow-hidden h-full">
                    <div className="flex flex-col justify-between items-start gap-0.5 relative z-10">
                        <span className="text-[12px] sm:text-[13px] text-text-secondary font-bold uppercase tracking-wider">{dayName}</span>
                        <span className="text-[15px] sm:text-[16px] text-text font-black tracking-tight">{dateOnly}</span>
                    </div>
                    <div className="w-full h-[1px] bg-border/60 rounded-full relative z-10"></div>
                    <div className="flex flex-col justify-between items-start gap-0.5 relative z-10">
                        <span className="text-[12px] sm:text-[13px] text-text-secondary font-bold uppercase tracking-wider">Trạng thái</span>
                        <div className="flex items-center gap-1.5 mt-[1px]">
                            <span className={`w-2 h-2 rounded-full shadow-sm ${isOnline ? 'bg-success shadow-success/40' : 'bg-danger shadow-danger/40'}`} />
                            <span className="text-[14px] sm:text-[15px] text-text font-black tracking-tight leading-none mb-[1px]">{isOnline ? 'Online' : 'Offline'}</span>
                        </div>
                    </div>
                    <div className="absolute top-0 right-0 w-24 h-24 bg-primary/5 rounded-full blur-2xl -mr-10 -mt-10 pointer-events-none" />
                </div>

                {/* Card 2: Revenue / Cost / Profit */}
                <div
                    onClick={onOpenHistory}
                    role="button"
                    tabIndex={0}
                    className="cursor-pointer bg-primary/5 rounded-[20px] p-3 sm:p-3.5 border border-primary/10 shadow-sm flex flex-col justify-center gap-[2px] relative overflow-hidden h-full hover:bg-primary/10 active:bg-primary/15 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                    <div className="flex justify-between items-center relative z-10">
                        <span className="text-[11px] sm:text-[12px] text-text-secondary font-bold uppercase tracking-wider">Tổng cộng </span>
                        <span className="text-[13px] sm:text-[14px] font-black text-text">{cupsSold} ly</span>
                    </div>
                    <div className="w-full h-[1px] bg-primary/15 rounded-full relative z-10 my-[3px]"></div>
                    <div className="flex flex-col justify-between items-start relative z-10 mt-[6px] w-full">
                        <span className="text-[12px] sm:text-[13px] text-text-secondary font-black uppercase tracking-wider">Doanh thu</span>
                        <div className="flex items-center justify-between w-full mt-0.5">
                            <span className="text-[15px] sm:text-[16px] font-black text-success">{formatVND(revenue)}</span>
                            <div className="w-7 h-7 flex items-center justify-center rounded-full text-text pointer-events-none shadow-sm">
                                <span className="text-[15px] leading-none mb-[2px] ml-[1px] font-bold">→</span>
                            </div>
                        </div>
                    </div>
                    <div className="absolute bottom-0 right-0 w-24 h-24 bg-primary/10 rounded-full blur-2xl -mr-10 -mb-10 pointer-events-none" />
                </div>
            </div>
        </header >
    )
}
