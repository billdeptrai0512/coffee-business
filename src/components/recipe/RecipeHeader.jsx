export default function RecipeHeader({ onBack, showCosts, setShowCosts }) {
    return (
        <header className="shrink-0 pt-6 pb-4 bg-surface border-b border-border/60 shadow-sm relative z-20 flex flex-col px-4 gap-3">
            <div className="flex items-center gap-3">
                <button
                    onClick={onBack}
                    className="w-10 h-10 flex items-center justify-center rounded-[14px] bg-surface-light border border-border/60 text-text hover:bg-border/40 active:bg-border/60 transition-colors shadow-sm focus:outline-none"
                    title="Trở về"
                >
                    <span className="text-xl leading-none -mt-[3px] font-bold">←</span>
                </button>
                {/* Toggle: Recipes / Costs */}
                <div className="flex flex-row gap-2 flex-1">
                    <button
                        onClick={() => setShowCosts(false)}
                        className={`flex-1 py-2 rounded-[12px] text-[13px] font-bold transition-colors ${!showCosts
                            ? 'bg-primary text-bg'
                            : 'bg-surface-light text-text-secondary border border-border/60'
                            }`}
                    >
                        Công thức
                    </button>
                    <button
                        onClick={() => setShowCosts(true)}
                        className={`flex-1 py-2 rounded-[12px] text-[13px] font-bold transition-colors ${showCosts
                            ? 'bg-primary text-bg'
                            : 'bg-surface-light text-text-secondary border border-border/60'
                            }`}
                    >
                        Giá nguyên liệu
                    </button>
                </div>
            </div>
        </header>
    )
}
