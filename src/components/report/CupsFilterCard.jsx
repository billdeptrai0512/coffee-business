export default function CupsFilterCard({ totalCups, selectedProductId, onFilterChange, products, soldProducts }) {
    return (
        <div className="grid grid-cols-2 gap-3 mt-2">
            <div className="bg-surface rounded-[24px] p-4 shadow-sm border border-border/60 flex flex-col justify-center relative overflow-hidden group">
                {/* <div className={`absolute top-3 right-3 transition-colors ${cupIconColor}`}>
                    <Coffee size={36} />
                </div> */}
                <h3 className="text-[12px] font-black text-text-secondary uppercase mb-1">Tổng cộng</h3>
                <div className="text-[18px] font-bold text-text-primary tabular-nums">
                    {totalCups} ly
                </div>
            </div>
            <div className="bg-surface rounded-[24px] p-3 shadow-sm border border-border/60 flex flex-col justify-center relative overflow-hidden group">
                <div className="flex items-center justify-between mb-2 ml-1 mr-1">
                    <h3 className="text-[12px] font-black text-text-secondary uppercase">Trong đó</h3>
                    {/* <Filter size={14} className="text-text-secondary" /> */}
                </div>
                <div className="relative">
                    <select
                        value={selectedProductId}
                        onChange={(e) => onFilterChange(e.target.value)}
                        className="w-full bg-surface-light text-text border border-border/40 rounded-xl px-2 py-2 text-[13px] font-medium appearance-none focus:outline-none focus:border-primary/50 transition-colors"
                    >
                        <option value="all">Tất cả</option>
                        {products.filter(p => soldProducts.has(p.id)).sort((a, b) => a.name.localeCompare(b.name)).map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                    </select>
                    <div className="absolute inset-y-0 right-2 flex items-center pointer-events-none text-text-secondary">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                    </div>
                </div>
            </div>
        </div>
    )
}
