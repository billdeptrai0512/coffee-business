import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Trash2 } from 'lucide-react'
import { useProducts } from '../contexts/ProductContext'
import { useAddress } from '../contexts/AddressContext'
import { useAuth } from '../contexts/AuthContext'
import { useConfirm } from '../contexts/ConfirmContext'
import { useToast } from '../hooks/useToast'
import Toast from '../components/POSPage/Toast'
import InlineEditor from '../components/RecipeIngredientPage/InlineEditor'
import FastIngredientFill from '../components/RecipeIngredientPage/FastIngredientFill'
import { formatVND, capitalizeWords } from '../utils'
import { getIngredientUnit, normalizeIngredientCategory, registerNewIngredients } from '../utils/ingredients'
import {
    updateToppingName, updateToppingPrice, deleteTopping,
    fetchToppingIngredients, upsertToppingIngredient, deleteToppingIngredient,
    fetchProductToppingLinks, setToppingProductLinks,
    upsertIngredientCost,
} from '../services/orderService'

export default function ToppingDetailPage() {
    const navigate = useNavigate()
    const { toppingId } = useParams()
    const { toppings, products, ingredientCosts, ingredientUnits, ingredientConfigs, refreshProducts } = useProducts()
    const { selectedAddress } = useAddress()
    const { isManager, isAdmin } = useAuth()
    const canEdit = isManager || isAdmin
    const { toast, showToast, showError } = useToast()
    const confirm = useConfirm()

    const topping = toppings.find(t => t.id === toppingId)

    const [saving, setSaving] = useState(false)
    const [toppingIngs, setToppingIngs] = useState([])
    const [selectedProductIds, setSelectedProductIds] = useState(new Set())
    const [savedProductIds, setSavedProductIds] = useState(new Set())

    useEffect(() => {
        let cancelled = false
        async function load() {
            const [ingsMap, links] = await Promise.all([
                fetchToppingIngredients([toppingId]),
                fetchProductToppingLinks([toppingId]),
            ])
            if (cancelled) return
            setToppingIngs(ingsMap[toppingId] || [])
            const ids = new Set(links.map(l => l.product_id))
            setSelectedProductIds(ids)
            setSavedProductIds(ids)
        }
        load()
        return () => { cancelled = true }
    }, [toppingId])

    const categoryOf = useMemo(() => {
        const m = new Map()
        for (const c of ingredientConfigs || []) m.set(c.ingredient, c.category)
        return (key) => normalizeIngredientCategory(m.get(key))
    }, [ingredientConfigs])

    const dbIngredients = useMemo(() => Object.keys(ingredientCosts || {}), [ingredientCosts])

    const withSaving = async (errorContext, fn) => {
        setSaving(true)
        try { await fn() } catch (err) { showError(err, errorContext) } finally { setSaving(false) }
    }

    async function saveName(name) {
        if (!name.trim()) return
        await withSaving('Lưu tên topping', async () => {
            await updateToppingName(toppingId, name.trim())
            await refreshProducts()
        })
    }

    async function savePrice(price) {
        await withSaving('Lưu giá topping', async () => {
            await updateToppingPrice(toppingId, price)
            await refreshProducts()
        })
    }

    // ─── Công thức topping (mirrors RecipeIngredientPage's base-recipe handlers) ───
    async function setIngredientAmount(ingredient, amount, unit) {
        await withSaving('Lưu công thức topping', async () => {
            await upsertToppingIngredient(toppingId, ingredient, amount, unit)
            setToppingIngs(prev => {
                const exists = prev.some(r => r.ingredient === ingredient)
                if (exists) return prev.map(r => r.ingredient === ingredient ? { ...r, amount } : r)
                return [...prev, { topping_id: toppingId, ingredient, amount, unit: unit || getIngredientUnit(ingredient) }]
            })
        })
    }

    async function removeIngredient(ingredient) {
        await withSaving('Xoá nguyên liệu khỏi công thức', async () => {
            await deleteToppingIngredient(toppingId, ingredient)
            setToppingIngs(prev => prev.filter(r => r.ingredient !== ingredient))
        })
    }

    async function addCustomIngredients({ keys, custom }) {
        const toAdd = keys.map(key => ({ key, unit: null }))
        if (custom) toAdd.push(custom)
        if (toAdd.length === 0) return
        await withSaving('Thêm nguyên liệu vào công thức', async () => {
            const existingKeys = new Set(toppingIngs.map(r => r.ingredient))
            const fresh = await registerNewIngredients(toAdd, { existingKeys, ingredientCosts, addressId: selectedAddress?.id, upsertIngredientCost })
            for (const { key, unit } of fresh) {
                await upsertToppingIngredient(toppingId, key, 0, unit)
            }
            setToppingIngs(prev => [...prev, ...fresh.map(({ key, unit }) => ({ topping_id: toppingId, ingredient: key, amount: 0, unit: unit || getIngredientUnit(key) }))])
            await refreshProducts()
        })
    }

    // ─── Áp dụng cho món: tick-list nhiều-nhiều ───
    function toggleProduct(productId) {
        setSelectedProductIds(prev => {
            const next = new Set(prev)
            if (next.has(productId)) next.delete(productId)
            else next.add(productId)
            return next
        })
    }

    const linksDirty = useMemo(() => {
        if (selectedProductIds.size !== savedProductIds.size) return true
        for (const id of selectedProductIds) if (!savedProductIds.has(id)) return true
        return false
    }, [selectedProductIds, savedProductIds])

    if (!topping) {
        return (
            <div className="flex flex-col h-full bg-bg items-center justify-center gap-3 px-6">
                <p className="text-text-secondary text-[13px] text-center">Không tìm thấy topping này (có thể đã bị xoá).</p>
                <button onClick={() => navigate('/toppings')} className="text-primary text-[13px] font-bold">Về danh sách topping</button>
            </div>
        )
    }

    async function saveLinks() {
        await withSaving('Lưu danh sách món dùng topping', async () => {
            await setToppingProductLinks(toppingId, [...selectedProductIds])
            setSavedProductIds(new Set(selectedProductIds))
            await refreshProducts()
            showToast('Đã lưu', 'success')
        })
    }

    async function handleDelete() {
        if (!await confirm({ title: `Xoá topping "${topping.name}"?`, danger: true, confirmLabel: 'Xoá' })) return
        await withSaving('Xoá topping', async () => {
            await deleteTopping(toppingId)
            await refreshProducts()
            navigate('/toppings')
        })
    }

    const sellableProducts = products.filter(p => !p.is_divider)

    return (
        <div className="flex flex-col h-full bg-bg">
            <Toast toast={toast} />

            <header className="shrink-0 pt-6 pb-3 bg-surface border-b border-border/60 shadow-sm relative z-20 flex flex-col px-4 gap-3">
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => navigate('/toppings')}
                        className="w-10 h-10 flex items-center justify-center rounded-[14px] bg-surface-light border border-border/60 text-text hover:bg-border/40 active:bg-border/60 transition-colors shadow-sm focus:outline-none shrink-0"
                        title="Trở về"
                    >
                        <ArrowLeft size={20} strokeWidth={2.5} />
                    </button>

                    <div className="flex-1 bg-primary/5 border border-primary/10 shadow-sm rounded-[14px] px-2 py-2 flex flex-col items-center justify-center text-center min-w-0">
                        <InlineEditor
                            value={topping.name}
                            canEdit={canEdit}
                            onSave={saveName}
                            type="text"
                            transform={capitalizeWords}
                            inputWidthClassName="w-full"
                            displayClassName="text-[13px] font-black text-primary uppercase line-clamp-1 break-words w-full px-2"
                            inputClassName="!text-center uppercase"
                            renderDisplay={(v) => <span title={v}>{v}</span>}
                        />
                        <div className="flex items-center justify-center gap-1.5 text-[12px] font-bold text-text-secondary leading-none mt-1 w-full">
                            <span>Giá cộng thêm:</span>
                            <InlineEditor
                                value={topping.price}
                                canEdit={canEdit}
                                onSave={savePrice}
                                type="number"
                                renderDisplay={(v) => <span className="text-success font-bold">{formatVND(v)}</span>}
                                inputWidthClassName="w-[72px]"
                            />
                        </div>
                    </div>

                    {canEdit && (
                        <button
                            onClick={handleDelete}
                            className="w-10 h-10 flex items-center justify-center rounded-[14px] border border-danger/20 text-danger hover:bg-danger/10 active:scale-95 transition-all shadow-sm focus:outline-none shrink-0"
                            title="Xoá topping"
                        >
                            <Trash2 size={20} strokeWidth={2.5} />
                        </button>
                    )}
                </div>
            </header>

            <main className="flex-1 overflow-y-auto px-4 py-4 space-y-4 bg-bg">
                <section>
                    <span className="block text-[13px] font-black text-text uppercase tracking-wide mb-3">Công thức</span>
                    <FastIngredientFill
                        entries={toppingIngs}
                        dbIngredients={dbIngredients}
                        getUnit={(k) => getIngredientUnit(k, ingredientUnits?.[k], ingredientUnits)}
                        categoryOf={categoryOf}
                        ingredientCosts={ingredientCosts}
                        canEdit={canEdit}
                        showCost
                        onSetAmount={setIngredientAmount}
                        onRemove={removeIngredient}
                        onAddCustom={addCustomIngredients}
                    />
                </section>

                <section className="pt-4 border-t border-border/40">
                    <div className="flex items-center justify-between mb-3">
                        <span className="text-[13px] font-black text-text uppercase tracking-wide">Áp dụng cho món</span>
                        {selectedProductIds.size > 0 && (
                            <span className="text-[10px] text-primary font-bold bg-primary/10 px-1.5 py-0.5 rounded">
                                Đã chọn {selectedProductIds.size}
                            </span>
                        )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                        {sellableProducts.map(p => {
                            const isSelected = selectedProductIds.has(p.id)
                            return (
                                <button
                                    key={p.id}
                                    disabled={!canEdit}
                                    onClick={() => toggleProduct(p.id)}
                                    className={`text-[12px] border px-2.5 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-60 ${isSelected
                                        ? 'bg-primary text-bg border-primary shadow-sm'
                                        : 'bg-primary/10 text-primary border-primary/20 hover:bg-primary/20 active:bg-primary/30'
                                        }`}
                                >
                                    {isSelected ? '✓ ' : '+ '}{p.name}
                                </button>
                            )
                        })}
                    </div>
                    {canEdit && linksDirty && (
                        <button
                            onClick={saveLinks}
                            disabled={saving}
                            className="w-full mt-3 py-2.5 rounded-[12px] bg-primary text-bg text-[13px] font-black hover:bg-primary/90 active:bg-primary/80 transition-colors disabled:opacity-50 uppercase"
                        >
                            Lưu danh sách món
                        </button>
                    )}
                </section>
            </main>
        </div>
    )
}
