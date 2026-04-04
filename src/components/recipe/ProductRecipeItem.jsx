import { formatVND } from '../../utils'
import { ingredientLabel, getIngredientUnit } from './recipeUtils'

export default function ProductRecipeItem({
    product,
    prodRecipes,
    cost,
    isExpanded,
    setExpandedProduct,
    editingProductPrice,
    setEditingProductPrice,
    saveProductPrice,
    editingAmount,
    setEditingAmount,
    saveAmount,
    handleDeleteIngredient,
    availableIngredients,
    addingIngredient,
    setAddingIngredient,
    handleAddIngredient,
    customIngredient,
    setCustomIngredient,
    handleDeleteProduct,
    ingredientCosts,
    saving
}) {
    return (
        <div className="bg-surface border border-border/60 rounded-[16px] overflow-hidden shadow-sm">
            {/* Product header - clickable */}
            <button
                onClick={() => setExpandedProduct(isExpanded ? null : product.id)}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-surface-light/50 active:bg-surface-light transition-colors"
            >
                <div className="flex flex-col gap-0.5">
                    <span className="text-[14px] font-bold text-text">{product.name}</span>
                    <div className="flex items-center flex-wrap gap-x-1.5 gap-y-0.5 text-[12px] text-text-secondary mt-0.5">
                        <span>Chi phí: <span className="text-danger font-bold">{formatVND(cost)}</span></span>
                        {product.price > 0 && (
                            <span className="bg-danger/10 text-danger text-[10px] font-bold px-1.5 py-0.5 rounded">
                                {Math.round((cost / product.price) * 100)}%
                            </span>
                        )}
                        <span className="text-text-dim px-0.5">•</span>
                        <span className="flex items-center gap-1.5">Giá bán:
                            {editingProductPrice?.productId === product.id ? (
                                <span className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                                    <input
                                        type="number"
                                        autoFocus
                                        className="w-[72px] bg-bg border border-primary/60 rounded-lg px-2 py-0.5 text-[12px] text-text text-right focus:outline-none focus:border-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                        value={editingProductPrice.value}
                                        onChange={e => setEditingProductPrice(prev => ({ ...prev, value: e.target.value }))}
                                        onKeyDown={e => {
                                            if (e.key === 'Enter') saveProductPrice(product.id, parseInt(editingProductPrice.value) || 0)
                                            if (e.key === 'Escape') setEditingProductPrice(null)
                                        }}
                                        onBlur={() => saveProductPrice(product.id, parseInt(editingProductPrice.value) || 0)}
                                    />
                                </span>
                            ) : (
                                <span
                                    className="text-success font-bold hover:underline cursor-pointer"
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        setEditingProductPrice({ productId: product.id, value: product.price.toString() })
                                    }}
                                >
                                    {formatVND(product.price)}
                                </span>
                            )}
                        </span>
                    </div>
                </div>
                <span className={`text-text-dim text-lg transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                    ▼
                </span>
            </button>

            {/* Expanded recipe details */}
            {isExpanded && (
                <div className="border-t border-border/40 px-4 py-3 space-y-2">
                    {prodRecipes.length === 0 && (
                        <p className="text-text-secondary text-[13px]">Chưa có nguyên liệu.</p>
                    )}

                    {prodRecipes.map(recipe => {
                        const isEditing = editingAmount?.productId === product.id && editingAmount?.ingredient === recipe.ingredient
                        const unitCost = ingredientCosts[recipe.ingredient] || 0
                        const lineCost = recipe.amount * unitCost

                        return (
                            <div key={recipe.ingredient} className="flex items-center gap-2 group">
                                <span className="text-[13px] text-text flex-1 min-w-0 truncate">
                                    {ingredientLabel(recipe.ingredient)}
                                </span>

                                {isEditing ? (
                                    <div className="flex items-center gap-1.5">
                                        <input
                                            type="number"
                                            autoFocus
                                            step="any"
                                            className="w-[72px] bg-bg border border-primary/60 rounded-lg px-2 py-1 text-[13px] text-text text-right focus:outline-none focus:border-primary [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                            value={editingAmount.value}
                                            onChange={e => setEditingAmount(prev => ({ ...prev, value: e.target.value }))}
                                            onKeyDown={e => {
                                                if (e.key === 'Enter') saveAmount(product.id, recipe.ingredient, parseFloat(editingAmount.value) || 0)
                                                if (e.key === 'Escape') setEditingAmount(null)
                                            }}
                                            onBlur={() => saveAmount(product.id, recipe.ingredient, parseFloat(editingAmount.value) || 0)}
                                        />
                                        <span className="text-[12px] text-text-dim">{getIngredientUnit(recipe.ingredient)}</span>
                                    </div>
                                ) : (
                                    <span
                                        className="text-[13px] font-bold text-primary cursor-pointer hover:underline tabular-nums min-w-[56px] text-right"
                                        onClick={() => setEditingAmount({ productId: product.id, ingredient: recipe.ingredient, value: recipe.amount.toString() })}
                                    >
                                        {recipe.amount} <span className="text-[11px] font-normal text-primary/70">{getIngredientUnit(recipe.ingredient)}</span>
                                    </span>
                                )}

                                <span className="text-[11px] text-text-dim tabular-nums w-[64px] text-right shrink-0">
                                    {formatVND(lineCost)}
                                </span>

                                <button
                                    onClick={() => handleDeleteIngredient(product.id, recipe.ingredient)}
                                    className="text-danger/60 hover:text-danger text-[14px] opacity-0 group-hover:opacity-100 transition-opacity shrink-0 w-6 h-6 flex items-center justify-center"
                                    title="Xóa nguyên liệu"
                                >
                                    ✕
                                </button>
                            </div>
                        )
                    })}

                    {/* Add ingredient */}
                    {addingIngredient === product.id ? (
                        <div className="flex flex-col gap-1.5 pt-1 border-t border-border/30 mt-2">
                            <span className="text-[11px] text-text-dim font-bold uppercase">Thêm nguyên liệu</span>
                            <div className="flex flex-wrap gap-1.5">
                                {availableIngredients.map(ing => (
                                    <button
                                        key={ing}
                                        onClick={() => handleAddIngredient(product.id, ing)}
                                        className="text-[11px] bg-primary/10 text-primary border border-primary/20 px-2 py-1 rounded-lg hover:bg-primary/20 active:bg-primary/30 transition-colors font-medium"
                                    >
                                        + {ingredientLabel(ing)}
                                    </button>
                                ))}
                            </div>
                            <div className="flex gap-2 mt-1">
                                <input
                                    type="text"
                                    placeholder="Hoặc nhập tên nguyên liệu mới..."
                                    className="flex-1 bg-bg border border-border/60 rounded-lg px-2 py-1.5 text-[12px] text-text focus:outline-none focus:border-primary"
                                    value={customIngredient}
                                    onChange={e => setCustomIngredient(e.target.value)}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter' && customIngredient.trim()) {
                                            handleAddIngredient(product.id, customIngredient.trim());
                                        }
                                    }}
                                />
                                <button
                                    onClick={() => {
                                        if (customIngredient.trim()) handleAddIngredient(product.id, customIngredient.trim());
                                    }}
                                    disabled={!customIngredient.trim()}
                                    className="bg-primary/10 text-primary border border-primary/20 px-3 py-1.5 rounded-lg text-[12px] font-bold disabled:opacity-50 transition-opacity"
                                >
                                    Thêm
                                </button>
                            </div>
                            <button
                                onClick={() => setAddingIngredient(null)}
                                className="text-[11px] text-text-dim mt-1 self-start"
                            >
                                Hủy
                            </button>
                        </div>
                    ) : (
                        <button
                            onClick={() => setAddingIngredient(product.id)}
                            className="text-[12px] text-primary/70 hover:text-primary font-medium mt-1 transition-colors"
                        >
                            + Thêm nguyên liệu
                        </button>
                    )}

                    <div className="flex justify-end pt-2 mt-3 border-t border-border/30 w-full relative z-10">
                        <span
                            className="text-text-secondary text-[12px] text-end font-bold cursor-pointer underline decoration-dashed decoration-text-secondary/50 underline-offset-4 hover:text-danger hover:decoration-danger active:text-danger/80 transition-all select-none"
                            onClick={(e) => {
                                e.stopPropagation()
                                handleDeleteProduct(product.id, product.name)
                            }}
                            title="Nhấn để xóa món này"
                        >
                            {saving ? '⏳' : 'Xóa món'}
                        </span>
                    </div>
                </div>
            )}
        </div>
    )
}
