import { formatVND } from '../utils'

export default function Header({ isOnline, dayName, dateOnly, cupsSold, revenue, totalCost, onOpenHistory, addressName, onAddressClick }) {
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
                    <div className="flex flex-col justify-between items-start relative z-10">
                        <span className="text-[12px] sm:text-[13px] text-text-secondary font-bold uppercase tracking-wider">Trạng thái</span>
                        <div className="flex items-center gap-1.5 mb-1">
                            <span className={`w-2 h-2 rounded-full shadow-sm ${isOnline ? 'bg-success shadow-success/40' : 'bg-danger shadow-danger/40'}`} />
                            <span className="text-[15px] sm:text-[16px] text-text font-black tracking-tight leading-none">{isOnline ? 'Online' : 'Offline'}</span>
                        </div>
                    </div>
                    <div className="w-full h-[1px] bg-border/60 rounded-full relative z-10 my-[3px] mt-[4px]"></div>

                    <div className="flex flex-col justify-between items-start relative z-10 mt-[6px] w-full">

                        <span className="text-[12px] sm:text-[13px] text-text-secondary font-black uppercase tracking-wider">Địa chỉ</span>
                        <div className="flex items-center justify-between w-full mt-0.5">
                            {addressName && <span className="text-[13px] text-primary font-black uppercase tracking-wider line-clamp-1">{addressName}</span>}
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
                    <div className="flex flex-col justify-between relative z-10">
                        <span className="text-[12px] sm:text-[13px] text-text-secondary font-bold uppercase tracking-wider">{dayName}</span>
                        <span className="text-[15px] sm:text-[16px] text-text font-black tracking-tight">{dateOnly}</span>
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
