export default function StockWarnings({ lowStockItems, outOfStockItems }) {
    if (lowStockItems.length === 0 && outOfStockItems.length === 0) return null

    return (
        <div className="px-6 pt-5 pb-2 shrink-0 space-y-2">
            {outOfStockItems.length > 0 && (
                <div className="flex items-center gap-2.5 bg-danger-soft rounded-2xl px-4 py-3 border border-danger/20 shadow-sm">
                    <span className="text-sm">⛔</span>
                    <span className="text-xs text-danger font-bold">
                        Hết: {outOfStockItems.join(', ')}
                    </span>
                </div>
            )}
            {lowStockItems.length > 0 && (
                <div className="flex items-center gap-2.5 bg-warning-soft rounded-2xl px-4 py-3 border border-warning/20 shadow-sm">
                    <span className="text-sm">⚠️</span>
                    <span className="text-xs text-warning font-bold">
                        Sắp hết: {lowStockItems.join(', ')}
                    </span>
                </div>
            )}
        </div>
    )
}
