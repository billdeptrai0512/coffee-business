import { useState, useEffect } from 'react'
import { formatVND } from '../utils'
import { INGREDIENT_NAMES } from '../constants'
import {
    fetchIngredientCosts,
    fetchAllRecipes,
    upsertRecipe,
    deleteRecipeRow,
    upsertIngredientCost
} from '../services/orderService'

// All known ingredients for the "add ingredient" dropdown
const ALL_INGREDIENTS = [
    'coffee_g', 'condensed_milk_ml', 'fresh_milk_ml', 'cacao_powder_g',
    'matcha_powder_g', 'salt_cream_ml', 'sugar_syrup_ml', 'rich_g', 'sugar',
    'tea_bag', 'peach_syrup_ml', 'lychee_syrup_ml', 'orange',
    'cup', 'lid'
]

function ingredientLabel(key) {
    return INGREDIENT_NAMES[key] || key
}

export default function RecipeManager({ products, recipes: initialRecipes, onBack, onDataChanged }) {
    const [ingredientCosts, setIngredientCosts] = useState({})
    const [recipes, setRecipes] = useState(initialRecipes || [])
    const [expandedProduct, setExpandedProduct] = useState(null)
    const [editingCost, setEditingCost] = useState(null) // { ingredient, value }
    const [editingAmount, setEditingAmount] = useState(null) // { productId, ingredient, value }
    const [saving, setSaving] = useState(false)
    const [showCosts, setShowCosts] = useState(false)
    const [addingIngredient, setAddingIngredient] = useState(null) // productId

    useEffect(() => {
        fetchIngredientCosts().then(setIngredientCosts)
    }, [])

    // Calculate cost of one product
    function productCost(productId) {
        const prodRecipes = recipes.filter(r => r.product_id === productId)
        return prodRecipes.reduce((sum, r) => {
            return sum + r.amount * (ingredientCosts[r.ingredient] || 0)
        }, 0)
    }

    // Save ingredient amount
    async function saveAmount(productId, ingredient, newAmount) {
        setSaving(true)
        try {
            await upsertRecipe(productId, ingredient, newAmount)
            setRecipes(prev => prev.map(r =>
                r.product_id === productId && r.ingredient === ingredient
                    ? { ...r, amount: newAmount }
                    : r
            ))
            onDataChanged?.()
        } catch (err) {
            console.error('Save recipe error:', err)
        } finally {
            setSaving(false)
            setEditingAmount(null)
        }
    }

    // Save ingredient cost
    async function saveCost(ingredient, newCost) {
        setSaving(true)
        try {
            await upsertIngredientCost(ingredient, newCost)
            setIngredientCosts(prev => ({ ...prev, [ingredient]: newCost }))
            onDataChanged?.()
        } catch (err) {
            console.error('Save cost error:', err)
        } finally {
            setSaving(false)
            setEditingCost(null)
        }
    }

    // Delete an ingredient from a product recipe
    async function handleDeleteIngredient(productId, ingredient) {
        if (!window.confirm(`Xóa ${ingredientLabel(ingredient)} khỏi công thức?`)) return
        setSaving(true)
        try {
            await deleteRecipeRow(productId, ingredient)
            setRecipes(prev => prev.filter(r => !(r.product_id === productId && r.ingredient === ingredient)))
            onDataChanged?.()
        } catch (err) {
            console.error('Delete recipe error:', err)
        } finally {
            setSaving(false)
        }
    }

    // Add a new ingredient to a product recipe
    async function handleAddIngredient(productId, ingredient) {
        setSaving(true)
        try {
            await upsertRecipe(productId, ingredient, 0)
            setRecipes(prev => [...prev, { product_id: productId, ingredient, amount: 0 }])
            setAddingIngredient(null)
            onDataChanged?.()
        } catch (err) {
            console.error('Add ingredient error:', err)
        } finally {
            setSaving(false)
        }
    }

    // Get unique ingredients across all recipes for the cost table
    const allUsedIngredients = [...new Set(recipes.map(r => r.ingredient))].sort()

    return (
        <div className="flex flex-col h-full max-w-lg mx-auto bg-bg">
            {/* Header */}
            <header className="shrink-0 pt-6 pb-4 bg-surface border-b border-border/60 shadow-sm relative z-20 px-4">
                <div className="flex items-center gap-3 mb-3">
                    <button
                        onClick={onBack}
                        className="w-10 h-10 flex items-center justify-center rounded-[14px] bg-surface-light border border-border/60 text-text hover:bg-border/40 active:bg-border/60 transition-colors shadow-sm focus:outline-none"
                    >
                        <span className="text-xl leading-none -mt-[3px] font-bold">←</span>
                    </button>
                    <h1 className="text-[16px] font-black text-text flex-1">Quản lý định lượng & chi phí</h1>
                </div>

                {/* Toggle: Recipes / Costs */}
                <div className="flex gap-2">
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
            </header>

            <main className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-bg">
                {!showCosts ? (
                    /* ========== RECIPES TAB ========== */
                    products.map(product => {
                        const prodRecipes = recipes.filter(r => r.product_id === product.id)
                        const cost = productCost(product.id)
                        const isExpanded = expandedProduct === product.id
                        const usedIngredients = prodRecipes.map(r => r.ingredient)
                        const availableIngredients = ALL_INGREDIENTS.filter(i => !usedIngredients.includes(i))

                        return (
                            <div key={product.id} className="bg-surface border border-border/60 rounded-[16px] overflow-hidden shadow-sm">
                                {/* Product header - clickable */}
                                <button
                                    onClick={() => setExpandedProduct(isExpanded ? null : product.id)}
                                    className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-surface-light/50 active:bg-surface-light transition-colors"
                                >
                                    <div className="flex flex-col gap-0.5">
                                        <span className="text-[14px] font-bold text-text">{product.name}</span>
                                        <span className="text-[12px] text-text-secondary">
                                            Giá bán: {formatVND(product.price)} · Chi phí: <span className="text-danger font-bold">{formatVND(cost)}</span>
                                        </span>
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
                                                        </div>
                                                    ) : (
                                                        <span
                                                            className="text-[13px] font-bold text-primary cursor-pointer hover:underline tabular-nums min-w-[48px] text-right"
                                                            onClick={() => setEditingAmount({ productId: product.id, ingredient: recipe.ingredient, value: recipe.amount.toString() })}
                                                        >
                                                            {recipe.amount}
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
                                    </div>
                                )}
                            </div>
                        )
                    })
                ) : (
                    /* ========== COSTS TAB ========== */
                    <div className="space-y-2">
                        <p className="text-[12px] text-text-dim mb-2">Giá mỗi đơn vị nguyên liệu (VNĐ). Nhấn vào giá để chỉnh sửa.</p>
                        {allUsedIngredients.map(ingredient => {
                            const isEditing = editingCost?.ingredient === ingredient
                            const cost = ingredientCosts[ingredient] || 0

                            return (
                                <div key={ingredient} className="bg-surface border border-border/60 rounded-[14px] px-4 py-3 flex items-center justify-between">
                                    <div className="flex flex-col">
                                        <span className="text-[14px] font-bold text-text">{ingredientLabel(ingredient)}</span>
                                        <span className="text-[11px] text-text-dim">{ingredient}</span>
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
                                            <span className="text-[12px] text-text-dim">đ</span>
                                        </div>
                                    ) : (
                                        <span
                                            className="text-[14px] font-bold text-primary cursor-pointer hover:underline tabular-nums"
                                            onClick={() => setEditingCost({ ingredient, value: cost.toString() })}
                                        >
                                            {formatVND(cost)}
                                        </span>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                )}
            </main>

            {/* Saving overlay */}
            {saving && (
                <div className="fixed inset-0 z-50 bg-bg/60 flex items-center justify-center pointer-events-none">
                    <span className="text-text font-bold text-[14px] animate-pulse">Đang lưu...</span>
                </div>
            )}
        </div>
    )
}
