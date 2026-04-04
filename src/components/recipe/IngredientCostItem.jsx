import { formatVND } from '../../utils'

export default function IngredientCostItem({ ingredientLabel, getIngredientUnit, ingredient, cost, isEditing, editingCost, setEditingCost, saveCost }) {
    return (
        <div className="bg-surface border border-border/60 rounded-[14px] px-4 py-3 flex items-center justify-between">
            <div className="flex flex-col">
                <span className="text-[14px] font-bold text-text">{ingredientLabel(ingredient)}</span>
                <span className="text-[11px] text-text-dim">Đơn vị: {getIngredientUnit(ingredient)}</span>
            </div>

            {isEditing ? (
                <div className="flex items-center gap-1.5">
                    <input
                        type="number"
                        autoFocus
                        className="w-[90px] bg-bg border border-primary/60 rounded-lg px-2 py-1 text-[14px] text-text text-right focus:outline-none focus:border-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        value={editingCost.value}
                        onChange={e => setEditingCost(prev => ({ ...prev, value: e.target.value }))}
                        onKeyDown={e => {
                            if (e.key === 'Enter') saveCost(ingredient, parseInt(editingCost.value) || 0)
                            if (e.key === 'Escape') setEditingCost(null)
                        }}
                        onBlur={() => saveCost(ingredient, parseInt(editingCost.value) || 0)}
                    />
                    <span className="text-[12px] text-text-dim">đ / {getIngredientUnit(ingredient)}</span>
                </div>
            ) : (
                <span
                    className="text-[14px] font-bold text-primary cursor-pointer hover:underline tabular-nums"
                    onClick={() => setEditingCost({ ingredient, value: cost.toString() })}
                >
                    {formatVND(cost)}<span className="text-[12px] font-normal text-text-dim ml-0.5">/ {getIngredientUnit(ingredient)}</span>
                </span>
            )}
        </div>
    )
}
