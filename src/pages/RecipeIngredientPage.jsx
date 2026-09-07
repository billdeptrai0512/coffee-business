import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { useProducts } from '../contexts/ProductContext'
import { useAuth } from '../contexts/AuthContext'
import { useAddress } from '../contexts/AddressContext'
import { useOnboardingVisibility } from '../contexts/OnboardingVisibilityContext'
import { useOnboardingProgressPersist } from '../hooks/useOnboardingProgressPersist'
import { readOnboardingState, DEFAULT_ONBOARDING_STATE, isRecipeProgressDone } from '../utils/onboardingStorage'
import { norm, findCoffeeIngredient, nextIngredientSetupField } from '../utils/onboardingHint'
import { RECIPE_TARGET_PRODUCT } from '../components/common/onboarding/steps/recipeStep'
import {
    upsertRecipe,
    upsertRecipes,
    upsertProductPrice,
    updateProductName,
    updateProductCountAsCup,
    insertProductExtra,
    updateProductExtraName,
    updateProductExtraPrice,
    updateProductExtraSticky,
    duplicateProductExtra,
    updateExtrasSortOrder,
    deleteProductExtra,
    removeProductFromAddress,
    upsertExtraIngredient,
    deleteExtraIngredient,
    upsertIngredientCost,
    deleteRecipeRow,
} from '../services/orderService'
import { sortIngredients, getIngredientUnit, normalizeIngredientCategory, registerNewIngredients } from '../utils/ingredients'
import { useToast } from '../hooks/useToast'
import { useConfirm } from '../contexts/ConfirmContext'
import Toast from '../components/POSPage/Toast'
import RecipeHeader from '../components/RecipeIngredientPage/RecipeHeader'
import FastIngredientFill from '../components/RecipeIngredientPage/FastIngredientFill'
import ExtrasSection from '../components/RecipeIngredientPage/ExtrasSection'
import CopyRecipeModal from '../components/RecipeIngredientPage/CopyRecipeModal'
import { Trash2 } from 'lucide-react'

export default function RecipeIngredientPage() {
    const navigate = useNavigate()
    const location = useLocation()
    const { productId } = useParams()
    const {
        products, recipes: allRecipes,
        ingredientCosts: contextCosts, ingredientUnits: contextUnits,
        productExtras: contextExtras, extraIngredients: contextExtraIngs,
        ingredientConfigs, refreshProducts,
    } = useProducts()
    const { selectedAddress } = useAddress()
    const { isManager, isAdmin, isGuest } = useAuth()
    const { toast, showError, showToast } = useToast()
    const confirm = useConfirm()
    const canEdit = isManager || isAdmin
    const { requestRefresh: requestOnboardingRefresh } = useOnboardingVisibility()

    const [ingredientCosts, setIngredientCosts] = useState(contextCosts || {})
    const [ingredientUnits, setIngredientUnits] = useState(contextUnits || {})
    const [recipes, setRecipes] = useState(allRecipes || [])
    const [extras, setExtras] = useState([])
    const [extraIngs, setExtraIngs] = useState(contextExtraIngs || {})
    const [saving, setSaving] = useState(false)
    const [showCopyFrom, setShowCopyFrom] = useState(false)
    const [recipeProgress, setRecipeProgress] = useState(() =>
        (selectedAddress?.id ? readOnboardingState(selectedAddress.id) : DEFAULT_ONBOARDING_STATE).recipeProgress
    )
    useOnboardingProgressPersist('recipeProgress', recipeProgress, { isGuest, addressId: selectedAddress?.id, requestOnboardingRefresh })

    const product = useMemo(() => products.find(p => p.id === productId), [products, productId])

    // Onboarding phase 5 — chỉ hint/track trên đúng công thức "Cà phê đen".
    const isCafeDen = isGuest && norm(product?.name) === RECIPE_TARGET_PRODUCT

    // Phase 5 xong nhưng user vẫn đứng ở trang chi tiết công thức — tab "Nguyên liệu" của
    // phase 6 chỉ có ở /recipes (trang này không render MenuTabsBar), nên hint nút trở về
    // trước, rồi RecipeMenuPage.jsx (hintIngredientsTab) tiếp quản. Cùng điều kiện với nó,
    // kể cả guard coffeeConfig: không còn NVL "Cà phê" thì phase 6 tự done (ingredientSetupStep)
    // → không được hint nữa, nếu không nút trở về nhấp nháy vĩnh viễn.
    const coffeeConfig = useMemo(() => findCoffeeIngredient(ingredientConfigs), [ingredientConfigs])
    const hintBack = isGuest && isRecipeProgressDone(recipeProgress)
        && !!coffeeConfig && nextIngredientSetupField(coffeeConfig, true) !== null

    // Index recipes by product — used by the "copy from" picker and to count rows.
    const recipesByProduct = useMemo(() => {
        const map = new Map()
        for (const r of recipes || []) {
            const list = map.get(r.product_id)
            if (list) list.push(r)
            else map.set(r.product_id, [r])
        }
        return map
    }, [recipes])

    // Category lookup for the add-ingredient combobox (groups chips into Chính / Bao bì).
    const categoryOf = useMemo(() => {
        const m = new Map()
        for (const c of ingredientConfigs || []) m.set(c.ingredient, c.category)
        return (key) => normalizeIngredientCategory(m.get(key))
    }, [ingredientConfigs])

    // Fetch fresh data on mount to avoid showing stale localStorage cache.
    // ponytail: mount-only — refreshProducts already refetches on address change via
    // its own effect in ProductContext; adding it here would double-fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { refreshProducts?.() }, [])

    // Sync from context when it updates
    useEffect(() => { setRecipes(allRecipes) }, [allRecipes])
    useEffect(() => { setIngredientCosts(contextCosts) }, [contextCosts])
    useEffect(() => { setIngredientUnits(contextUnits || {}) }, [contextUnits])
    useEffect(() => { setExtras(contextExtras?.[productId] || []) }, [contextExtras, productId])
    useEffect(() => { setExtraIngs(contextExtraIngs || {}) }, [contextExtraIngs])

    const prodRecipes = useMemo(
        () => recipes
            .filter(r => r.product_id === productId)
            .sort((a, b) => sortIngredients(a.ingredient, b.ingredient, selectedAddress?.ingredient_sort_order)),
        [recipes, productId, selectedAddress?.ingredient_sort_order]
    )

    const baseAmounts = useMemo(
        () => Object.fromEntries(prodRecipes.map(r => [r.ingredient, r.amount])),
        [prodRecipes]
    )

    // Render-time-adjust (cùng pattern DailyReportPage.jsx) — track hành động thật, không cần
    // nút Lưu riêng vì FastIngredientFill/ExtrasSection đã ghi DB ngay khi user nhập.
    if (isCafeDen && prodRecipes.some(r => r.amount > 0) && !recipeProgress.filledAmount) {
        setRecipeProgress(prev => ({ ...prev, filledAmount: true }))
    }
    if (isCafeDen && extras.length > 0 && !recipeProgress.addedExtra) {
        setRecipeProgress(prev => ({ ...prev, addedExtra: true }))
    }

    const dbIngredients = useMemo(
        () => Object.keys(ingredientCosts)
            .sort((a, b) => sortIngredients(a, b, selectedAddress?.ingredient_sort_order)),
        [ingredientCosts, selectedAddress?.ingredient_sort_order]
    )
    // Wraps an async action with saving=true/false + error toast
    const withSaving = async (errorContext, fn) => {
        setSaving(true)
        try { await fn() }
        catch (err) { showError(err, errorContext) }
        finally { setSaving(false) }
    }

    // ─── Base recipe handlers ─────────────────────────────────────────
    // Amount box only upserts (0 stays a 0-amount row, never deletes — removal is the
    // ✕ button). Optimistic state is authoritative; no refetch on a pure amount edit.
    async function setBaseAmount(ingredient, amount, unit) {
        await withSaving('Lưu công thức', async () => {
            await upsertRecipe(productId, ingredient, amount, selectedAddress?.id, unit)
            setRecipes(prev => {
                const exists = prev.some(r => r.product_id === productId && r.ingredient === ingredient)
                if (exists) return prev.map(r => r.product_id === productId && r.ingredient === ingredient ? { ...r, amount } : r)
                return [...prev, { product_id: productId, ingredient, amount, unit: unit || getIngredientUnit(ingredient) }]
            })
        })
    }

    async function removeBaseIngredient(ingredient) {
        await withSaving('Xóa nguyên liệu khỏi công thức', async () => {
            await deleteRecipeRow(productId, ingredient, selectedAddress?.id)
            setRecipes(prev => prev.filter(r => !(r.product_id === productId && r.ingredient === ingredient)))
            refreshProducts?.()
        })
    }

    async function handleCopyFrom(sourceProductId, sourceName) {
        const srcRows = recipesByProduct.get(sourceProductId) || []
        const srcExtras = contextExtras?.[sourceProductId] || []
        if (srcRows.length === 0 && srcExtras.length === 0) return
        setShowCopyFrom(false)
        const parts = []
        if (srcRows.length) parts.push(`${srcRows.length} nguyên liệu`)
        if (srcExtras.length) parts.push(`${srcExtras.length} tùy chọn`)
        if (!await confirm({ title: `Chép ${parts.join(' + ')} từ "${sourceName}"?`, detail: 'Nguyên liệu trùng tên sẽ bị ghi đè lượng; tùy chọn được thêm mới.', confirmLabel: 'Chép' })) return
        await withSaving('Chép công thức', async () => {
            await upsertRecipes(srcRows.map(r => ({ productId, ingredient: r.ingredient, amount: r.amount, addressId: selectedAddress?.id, unit: r.unit })))
            // Extras are copied as new rows (each with its own ingredient impacts).
            // Skip any whose name already exists here so copying twice / into a product that
            // already has "Lớn" doesn't create duplicate options.
            const existingExtraNames = new Set(extras.map(e => e.name.trim().toLowerCase()))
            for (const se of srcExtras) {
                if (existingExtraNames.has(se.name.trim().toLowerCase())) continue
                const newExtra = await insertProductExtra(productId, se.name, se.price, selectedAddress?.id)
                if (se.is_sticky) await updateProductExtraSticky(newExtra.id, true)
                for (const ei of (contextExtraIngs?.[se.id] || [])) {
                    await upsertExtraIngredient(newExtra.id, ei.ingredient, ei.amount, ei.unit)
                }
            }
            setRecipes(prev => {
                const next = prev.filter(r => r.product_id !== productId || !srcRows.some(s => s.ingredient === r.ingredient))
                return [...next, ...srcRows.map(r => ({ product_id: productId, ingredient: r.ingredient, amount: r.amount, unit: r.unit }))]
            })
            refreshProducts?.()
        })
    }

    async function saveProductPrice(newPrice) {
        if (!selectedAddress) return
        await withSaving('Lưu giá bán sản phẩm', async () => {
            await upsertProductPrice(productId, selectedAddress.id, newPrice)
            refreshProducts?.()
        })
    }

    async function saveProductName(newName) {
        const trimmed = newName.trim()
        if (!trimmed || trimmed === product?.name) return
        await withSaving('Lưu tên món', async () => {
            await updateProductName(productId, trimmed)
            refreshProducts?.()
        })
    }

    async function toggleCountAsCup() {
        const next = product?.count_as_cup === false
        await withSaving('Cập nhật cờ đếm ly', async () => {
            await updateProductCountAsCup(productId, next)
            refreshProducts?.()
        })
    }

    async function handleAddBaseIngredients({ keys, custom }) {
        const toAdd = keys.map(key => ({ key, unit: null }))
        if (custom) toAdd.push(custom)
        if (toAdd.length === 0) return
        await withSaving('Thêm nguyên liệu vào công thức', async () => {
            // Guard against resetting an ingredient that already exists: only seed amount 0
            // when it's not yet in this recipe, and only register a cost row when it's
            // brand-new — else "Tạo mới" typed with an existing name would zero its amount
            // and (worse) its shared unit cost.
            const existingKeys = new Set(prodRecipes.map(r => r.ingredient))
            const fresh = await registerNewIngredients(toAdd, { existingKeys, ingredientCosts, addressId: selectedAddress?.id, upsertIngredientCost })
            if (fresh.length) {
                await upsertRecipes(fresh.map(({ key, unit }) => ({ productId, ingredient: key, amount: 0, addressId: selectedAddress?.id, unit })))
            }
            setRecipes(prev => {
                const present = new Set(prev.filter(r => r.product_id === productId).map(r => r.ingredient))
                return [
                    ...prev,
                    ...toAdd.filter(t => !present.has(t.key)).map(({ key, unit }) => ({
                        product_id: productId, ingredient: key, amount: 0,
                        unit: unit || getIngredientUnit(key),
                    })),
                ]
            })
            refreshProducts?.()
        })
    }

    async function handleDeleteFromMenu() {
        const addrId = selectedAddress?.id || null
        if (!addrId && !isAdmin) return
        const targetName = addrId ? 'của chi nhánh này' : 'mặc định của hệ thống'
        if (!await confirm({ title: `Xóa "${product.name}" khỏi menu ${targetName}?`, danger: true, confirmLabel: 'Xóa' })) return
        await withSaving('Xóa món khỏi menu', async () => {
            await removeProductFromAddress(productId, addrId)
            refreshProducts?.()
            navigate('/recipes', { state: location.state })
        })
    }

    // ─── Extras handlers ──────────────────────────────────────────────
    async function handleAddExtra(name, price) {
        if (extras.some(e => e.name.trim().toLowerCase() === name.trim().toLowerCase())) {
            showToast(`Đã có tùy chọn "${name.trim()}"`, 'warning')
            return
        }
        await withSaving('Thêm tùy chọn', async () => {
            const newExtra = await insertProductExtra(productId, name, price, selectedAddress?.id)
            setExtras(prev => [...prev, { id: newExtra.id, name: newExtra.name, price: newExtra.price }])
            refreshProducts?.()
        })
    }

    async function saveExtraName(extraId, newName) {
        const trimmed = newName.trim()
        if (!trimmed) return
        await withSaving('Lưu tên tùy chọn', async () => {
            await updateProductExtraName(extraId, trimmed)
            setExtras(prev => prev.map(e => e.id === extraId ? { ...e, name: trimmed } : e))
            refreshProducts?.()
        })
    }

    async function saveExtraPrice(extraId, newPrice) {
        await withSaving('Lưu giá tùy chọn', async () => {
            await updateProductExtraPrice(extraId, newPrice)
            setExtras(prev => prev.map(e => e.id === extraId ? { ...e, price: newPrice } : e))
            refreshProducts?.()
        })
    }

    async function toggleExtraSticky(extraId, nextValue) {
        await withSaving('Cập nhật sticky', async () => {
            await updateProductExtraSticky(extraId, nextValue)
            setExtras(prev => prev.map(e => e.id === extraId ? { ...e, is_sticky: nextValue } : e))
            refreshProducts?.()
        })
    }

    async function deleteExtra(extraId, extraName) {
        if (!await confirm({ title: `Xóa tùy chọn "${extraName}"?`, danger: true, confirmLabel: 'Xóa' })) return
        await withSaving('Xóa tùy chọn', async () => {
            await deleteProductExtra(extraId)
            setExtras(prev => prev.filter(e => e.id !== extraId))
            refreshProducts?.()
        })
    }

    async function duplicateExtra(extraId, newName) {
        await withSaving('Nhân bản tùy chọn', async () => {
            await duplicateProductExtra(extraId, newName, selectedAddress?.id)
            refreshProducts?.()
        })
    }

    async function saveExtrasSortOrder(orderedIds) {
        await withSaving('Lưu thứ tự tùy chọn', async () => {
            await updateExtrasSortOrder(orderedIds)
            await refreshProducts?.()
        })
    }

    async function handleAddExtraIngredients(extraId, { keys, custom }) {
        const toAdd = keys.map(key => ({ key, unit: null }))
        if (custom) toAdd.push(custom)
        if (toAdd.length === 0) return
        const present = new Set((extraIngs[extraId] || []).map(ei => ei.ingredient))
        await withSaving('Thêm nguyên liệu vào tùy chọn', async () => {
            for (const { key, unit, category } of toAdd) {
                // Same guard as the base recipe: don't zero an impact/cost that already exists.
                if (!present.has(key)) {
                    await upsertExtraIngredient(extraId, key, 0, unit)
                }
                // A brand-new ingredient created here must exist in ingredient_costs (with its
                // category) too, else it won't show in /ingredients or the chip list.
                if (unit !== null && !(key in ingredientCosts)) {
                    await upsertIngredientCost(key, 0, selectedAddress?.id, unit, category ? { category } : {})
                }
            }
            setExtraIngs(prev => ({
                ...prev,
                [extraId]: [
                    ...(prev[extraId] || []),
                    ...toAdd.filter(t => !present.has(t.key)).map(({ key, unit }) => ({
                        extra_id: extraId, ingredient: key, amount: 0,
                        unit: unit || getIngredientUnit(key),
                    })),
                ],
            }))
            refreshProducts?.()
        })
    }

    async function saveExtraAmount(extraId, ingredient, newAmount) {
        await withSaving('Lưu lượng nguyên liệu tùy chọn', async () => {
            await upsertExtraIngredient(extraId, ingredient, newAmount)
            setExtraIngs(prev => ({
                ...prev,
                [extraId]: (prev[extraId] || []).map(ei =>
                    ei.ingredient === ingredient ? { ...ei, amount: newAmount } : ei
                ),
            }))
        })
    }

    async function deleteExtraIng(extraId, ingredient) {
        if (!await confirm({ title: 'Xóa tác động nguyên liệu này?', danger: true, confirmLabel: 'Xóa' })) return
        await withSaving('Xóa nguyên liệu khỏi tùy chọn', async () => {
            await deleteExtraIngredient(extraId, ingredient)
            setExtraIngs(prev => ({
                ...prev,
                [extraId]: (prev[extraId] || []).filter(ei => ei.ingredient !== ingredient),
            }))
            refreshProducts?.()
        })
    }

    if (!product) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-bg px-6 gap-4">
                <span className="text-text-secondary text-[14px]">Không tìm thấy món này.</span>
                <button onClick={() => navigate('/recipes', { state: location.state })} className="text-primary font-bold text-[14px] underline">
                    ← Quay lại
                </button>
            </div>
        )
    }

    const extraHandlers = {
        saveName: saveExtraName,
        savePrice: saveExtraPrice,
        toggleSticky: toggleExtraSticky,
        deleteExtra,
        saveExtraAmount,
        deleteExtraIngredient: deleteExtraIng,
        addExtraIngredients: handleAddExtraIngredients,
        duplicate: duplicateExtra,
    }

    return (
        <div className="flex flex-col h-[100dvh] max-w-lg mx-auto bg-bg relative">
            <Toast toast={toast} />

            <RecipeHeader
                product={product}
                canEdit={canEdit}
                onBack={() => navigate('/recipes', { state: location.state })}
                hintBack={hintBack}
                onSavePrice={saveProductPrice}
                onSaveName={saveProductName}
                onCopyFrom={() => setShowCopyFrom(true)}
            />

            <main className="flex-1 overflow-y-auto px-4 max-[329px]:px-2 py-4 space-y-3 bg-bg">
                <FastIngredientFill
                    entries={prodRecipes}
                    dbIngredients={dbIngredients}
                    getUnit={(k) => getIngredientUnit(k, ingredientUnits?.[k], ingredientUnits)}
                    categoryOf={categoryOf}
                    ingredientCosts={ingredientCosts}
                    canEdit={canEdit}
                    showCost
                    onSetAmount={setBaseAmount}
                    onRemove={removeBaseIngredient}
                    onAddCustom={handleAddBaseIngredients}
                    hint={isCafeDen && !recipeProgress.filledAmount}
                />

                <ExtrasSection
                    extras={extras}
                    extraIngs={extraIngs}
                    ingredientUnits={ingredientUnits}
                    dbIngredients={dbIngredients}
                    canEdit={canEdit}
                    saving={saving}
                    onAddExtra={handleAddExtra}
                    onSaveSortOrder={saveExtrasSortOrder}
                    extraHandlers={extraHandlers}
                    categoryOf={categoryOf}
                    baseAmounts={baseAmounts}
                    hint={isCafeDen && recipeProgress.filledAmount && !recipeProgress.addedExtra}
                />

                {canEdit && (
                    <div className="mt-4 pt-4 border-t border-border/40">
                        <label className="flex items-center justify-between gap-3 bg-surface border border-border/60 rounded-[14px] px-4 py-3 cursor-pointer select-none">
                            <span className="flex flex-col min-w-0">
                                <span className="text-[13px] font-bold text-text">Cộng vào tổng số ly bán/ngày</span>
                            </span>
                            <input
                                type="checkbox"
                                checked={product?.count_as_cup !== false}
                                onChange={toggleCountAsCup}
                                disabled={saving}
                                className="w-5 h-5 accent-primary cursor-pointer shrink-0"
                            />
                        </label>

                        <button
                            onClick={handleDeleteFromMenu}
                            className="mt-2 flex items-center justify-center gap-1.5 w-full text-[12px] font-bold text-danger/80 bg-danger/5 border border-danger/20 rounded-[12px] px-3 py-2.5 hover:bg-danger/10 hover:text-danger active:scale-[0.99] transition-all"
                        >
                            <Trash2 size={14} /> Xóa món khỏi menu
                        </button>
                    </div>
                )}
            </main>

            {showCopyFrom && (
                <CopyRecipeModal
                    products={products.filter(p => p.id !== productId && !p.is_divider)}
                    recipesByProduct={recipesByProduct}
                    onPick={handleCopyFrom}
                    onClose={() => setShowCopyFrom(false)}
                />
            )}

            {saving && (
                <div className="fixed bottom-4 right-4 z-50 pointer-events-none">
                    <span className="text-text-secondary text-[11px] animate-pulse">Đang lưu...</span>
                </div>
            )}
        </div>
    )
}
