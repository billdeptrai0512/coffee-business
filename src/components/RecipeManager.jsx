import { useState, useEffect } from 'react'
import {
    fetchIngredientCosts,
    fetchAllRecipes,
    upsertRecipe,
    deleteRecipeRow,
    upsertIngredientCost,
    upsertProductPrice,
    insertProduct,
    deleteProduct
} from '../services/orderService'
import { useAuth } from '../contexts/AuthContext'
import { useAddress } from '../contexts/AddressContext'
import { ALL_INGREDIENTS, sortIngredients, ingredientLabel, getIngredientUnit } from './recipe/recipeUtils'

import RecipeHeader from './recipe/RecipeHeader'
import ProductCreator from './recipe/ProductCreator'
import ProductRecipeItem from './recipe/ProductRecipeItem'
import IngredientCostItem from './recipe/IngredientCostItem'

export default function RecipeManager({ products, recipes: initialRecipes, onBack, onDataChanged }) {
    const { profile } = useAuth()
    const activeManagerId = profile?.role === 'manager' ? profile.id : profile?.manager_id
    const { selectedAddress } = useAddress()

    const [ingredientCosts, setIngredientCosts] = useState({})
    const [recipes, setRecipes] = useState(initialRecipes || [])
    const [expandedProduct, setExpandedProduct] = useState(null)
    const [editingCost, setEditingCost] = useState(null) // { ingredient, value }
    const [editingAmount, setEditingAmount] = useState(null) // { productId, ingredient, value }
    const [editingProductPrice, setEditingProductPrice] = useState(null) // { productId, value }
    const [saving, setSaving] = useState(false)
    const [showCosts, setShowCosts] = useState(false)
    const [addingIngredient, setAddingIngredient] = useState(null) // productId
    const [customIngredient, setCustomIngredient] = useState('')
    const [addingProduct, setAddingProduct] = useState(false)
    const [newProductName, setNewProductName] = useState('')
    const [newProductPrice, setNewProductPrice] = useState('')

    useEffect(() => {
        if (selectedAddress?.id) {
            fetchIngredientCosts(selectedAddress.id).then(setIngredientCosts)
        }
    }, [selectedAddress?.id])

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
            await upsertRecipe(productId, ingredient, newAmount, selectedAddress?.id)
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
            await upsertIngredientCost(ingredient, newCost, selectedAddress?.id)
            setIngredientCosts(prev => ({ ...prev, [ingredient]: newCost }))
            onDataChanged?.()
        } catch (err) {
            console.error('Save cost error:', err)
        } finally {
            setSaving(false)
            setEditingCost(null)
        }
    }

    // Save product price
    async function saveProductPrice(productId, newPrice) {
        if (!selectedAddress?.id) return
        setSaving(true)
        try {
            await upsertProductPrice(productId, selectedAddress.id, newPrice)
            onDataChanged?.()
        } catch (err) {
            console.error('Save product price error:', err)
        } finally {
            setSaving(false)
            setEditingProductPrice(null)
        }
    }

    // Delete an ingredient from a product recipe
    async function handleDeleteIngredient(productId, ingredient) {
        if (!window.confirm(`Xóa ${ingredientLabel(ingredient)} khỏi công thức?`)) return
        setSaving(true)
        try {
            await deleteRecipeRow(productId, ingredient, selectedAddress?.id)
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
            await upsertRecipe(productId, ingredient, 0, selectedAddress?.id)
            setRecipes(prev => [...prev, { product_id: productId, ingredient, amount: 0 }])
            setAddingIngredient(null)
            setCustomIngredient('')
            onDataChanged?.()
        } catch (err) {
            console.error('Add ingredient error:', err)
        } finally {
            setSaving(false)
        }
    }

    async function handleCreateProduct() {
        if (!newProductName.trim()) return;
        setSaving(true)
        try {
            const newProd = await insertProduct(newProductName.trim(), parseInt(newProductPrice) || 0)
            if (newProd && selectedAddress?.id) {
                await upsertProductPrice(newProd.id, selectedAddress.id, parseInt(newProductPrice) || 0)
            }
            onDataChanged?.()
            setAddingProduct(false)
            setNewProductName('')
            setNewProductPrice('')
        } catch (error) {
            console.error('Create product error:', error)
        } finally {
            setSaving(false)
        }
    }

    async function handleDeleteProduct(productId, productName) {
        if (!window.confirm(`Xóa món "${productName}" khỏi menu?`)) return
        setSaving(true)
        try {
            await deleteProduct(productId)
            onDataChanged?.()
        } catch (err) {
            console.error('Delete product error:', err)
            alert('Không thể xóa món này. Có thể do món này đã có lịch sử giao dịch bán hàng (order_items liên kết).')
        } finally {
            setSaving(false)
        }
    }

    // Get unique ingredients across all recipes for the cost table
    const allUsedIngredients = [...new Set(recipes.map(r => r.ingredient))].sort(sortIngredients)

    return (
        <div className="flex flex-col h-full max-w-lg mx-auto bg-bg">
            <RecipeHeader onBack={onBack} showCosts={showCosts} setShowCosts={setShowCosts} />

            <main className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-bg">
                {!showCosts ? (
                    <div className="space-y-3">
                        <ProductCreator
                            addingProduct={addingProduct}
                            setAddingProduct={setAddingProduct}
                            newProductName={newProductName}
                            setNewProductName={setNewProductName}
                            newProductPrice={newProductPrice}
                            setNewProductPrice={setNewProductPrice}
                            handleCreateProduct={handleCreateProduct}
                        />

                        {/* ========== RECIPES TAB ========== */}
                        {products.map(product => {
                            const prodRecipes = recipes.filter(r => r.product_id === product.id).sort((a, b) => sortIngredients(a.ingredient, b.ingredient))
                            const cost = productCost(product.id)
                            const isExpanded = expandedProduct === product.id
                            const usedIngredients = prodRecipes.map(r => r.ingredient)
                            const availableIngredients = ALL_INGREDIENTS.filter(i => !usedIngredients.includes(i))

                            return (
                                <ProductRecipeItem
                                    key={product.id}
                                    product={product}
                                    prodRecipes={prodRecipes}
                                    cost={cost}
                                    isExpanded={isExpanded}
                                    setExpandedProduct={setExpandedProduct}
                                    editingProductPrice={editingProductPrice}
                                    setEditingProductPrice={setEditingProductPrice}
                                    saveProductPrice={saveProductPrice}
                                    editingAmount={editingAmount}
                                    setEditingAmount={setEditingAmount}
                                    saveAmount={saveAmount}
                                    handleDeleteIngredient={handleDeleteIngredient}
                                    availableIngredients={availableIngredients}
                                    addingIngredient={addingIngredient}
                                    setAddingIngredient={setAddingIngredient}
                                    handleAddIngredient={handleAddIngredient}
                                    customIngredient={customIngredient}
                                    setCustomIngredient={setCustomIngredient}
                                    handleDeleteProduct={handleDeleteProduct}
                                    ingredientCosts={ingredientCosts}
                                    saving={saving}
                                />
                            )
                        })}
                    </div>
                ) : (
                    /* ========== COSTS TAB ========== */
                    <div className="space-y-2">
                        <p className="text-[12px] text-text-dim mb-2">Giá mỗi đơn vị nguyên liệu (VNĐ). Nhấn vào giá để chỉnh sửa.</p>
                        {allUsedIngredients.map(ingredient => (
                            <IngredientCostItem
                                key={ingredient}
                                ingredient={ingredient}
                                cost={ingredientCosts[ingredient] || 0}
                                isEditing={editingCost?.ingredient === ingredient}
                                editingCost={editingCost}
                                setEditingCost={setEditingCost}
                                saveCost={saveCost}
                                ingredientLabel={ingredientLabel}
                                getIngredientUnit={getIngredientUnit}
                            />
                        ))}
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
