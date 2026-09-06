import { useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useProducts } from '../contexts/ProductContext'
import { useAddress } from '../contexts/AddressContext'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../hooks/useToast'
import Toast from '../components/POSPage/Toast'
import IngredientDetailHeader from '../components/IngredientManagementPage/IngredientDetailHeader'
import { parseWorkbook, resolveImportPlan, commitImportPlan } from '../services/importService'

// Nhập liệu hàng loạt từ 1 file Excel (mẫu ở public/templates/mau-nhap-lieu.xlsx) — dùng lúc
// setup ban đầu cho khách có nhiều sản phẩm/nguyên liệu/topping, thay vì bấm tay từng dòng.
// 3 bước: chọn file → xem trước (resolveImportPlan, thuần, chưa ghi gì) → xác nhận (commitImportPlan).
export default function ImportPage() {
    const navigate = useNavigate()
    const location = useLocation()
    const { products, toppings, ingredientCosts, refreshProducts } = useProducts()
    const { selectedAddress } = useAddress()
    const { isManager, isAdmin } = useAuth()
    const canEdit = isManager || isAdmin
    const { toast, showToast, showError } = useToast()
    const fileInputRef = useRef(null)

    const [fileName, setFileName] = useState('')
    const [result, setResult] = useState(null) // { plan, blockingErrors, warnings }
    const [committing, setCommitting] = useState(false)

    async function handleFileChange(e) {
        const file = e.target.files?.[0]
        e.target.value = '' // cho phép chọn lại đúng file đó lần sau (VD sau khi sửa lỗi)
        if (!file) return
        try {
            const buf = await file.arrayBuffer()
            const parsed = parseWorkbook(buf)
            setResult(resolveImportPlan(parsed, { products, toppings, ingredientCosts }))
            setFileName(file.name)
        } catch (err) {
            showError(err, 'Đọc file Excel')
        }
    }

    async function handleCommit() {
        if (!result || result.blockingErrors.length > 0 || committing) return
        setCommitting(true)
        try {
            await commitImportPlan(result.plan, selectedAddress?.id ?? null, { products, toppings, ingredientCosts })
            await refreshProducts()
            showToast('Đã nhập dữ liệu thành công', 'success')
            setResult(null)
            setFileName('')
        } catch (err) {
            showError(err, 'Nhập liệu Excel')
        } finally {
            setCommitting(false)
        }
    }

    const summary = result && [
        [result.plan.products.length, 'sản phẩm mới'],
        [result.plan.ingredients.length, 'nguyên liệu mới'],
        [result.plan.recipes.length, 'dòng công thức'],
        [result.plan.toppings.length, 'topping mới'],
        [result.plan.toppingIngredients.length, 'dòng công thức topping'],
        [result.plan.toppingLinks.reduce((s, l) => s + l.productNames.length, 0), 'liên kết topping-món'],
    ].filter(([n]) => n > 0)

    return (
        <div className="flex flex-col h-full bg-bg">
            <Toast toast={toast} />

            <IngredientDetailHeader
                title="Nhập liệu Excel"
                subtitle={fileName || 'Sản phẩm / nguyên liệu / công thức / topping'}
                onBack={() => navigate('/recipes', { state: location.state })}
            />

            <main className="flex-1 overflow-y-auto px-4 py-4 pb-8 space-y-3">
                {!canEdit ? (
                    <p className="text-text-secondary text-[13px] text-center py-8 bg-surface-light/50 rounded-[16px] border border-border/40">
                        Chỉ quản lý mới nhập liệu hàng loạt được.
                    </p>
                ) : (
                    <>
                        <a
                            href="/templates/mau-nhap-lieu.xlsx"
                            download
                            className="block text-center text-[13px] text-primary/80 hover:text-primary font-medium bg-surface border border-border/60 rounded-[16px] px-4 py-3 transition-colors"
                        >
                            Tải file mẫu Excel
                        </a>

                        <button
                            onClick={() => fileInputRef.current?.click()}
                            className="w-full py-4 rounded-[16px] bg-surface border border-dashed border-border text-text-secondary text-[13px] font-bold hover:bg-surface-light transition-colors"
                        >
                            + Chọn file Excel đã điền
                        </button>
                        <input ref={fileInputRef} type="file" accept=".xlsx" onChange={handleFileChange} className="hidden" />

                        {result && (
                            <div className="bg-surface border border-border/60 rounded-[16px] p-4 flex flex-col gap-3">
                                {summary.length > 0 && (
                                    <div className="space-y-1">
                                        {summary.map(([n, label]) => (
                                            <p key={label} className="text-[13px] font-bold text-success">Sẽ tạo {n} {label}</p>
                                        ))}
                                    </div>
                                )}

                                {result.blockingErrors.length > 0 && (
                                    <div className="space-y-1 bg-danger-soft border border-danger/20 rounded-[12px] p-3">
                                        <p className="text-[12px] font-black text-danger uppercase">Lỗi cần sửa trong file ({result.blockingErrors.length})</p>
                                        {result.blockingErrors.map((e, i) => (
                                            <p key={i} className="text-[12px] text-danger">{e}</p>
                                        ))}
                                    </div>
                                )}

                                {result.warnings.length > 0 && (
                                    <div className="space-y-1 bg-warning-soft border border-warning/20 rounded-[12px] p-3">
                                        <p className="text-[12px] font-black text-warning uppercase">Cảnh báo — vẫn nhập được ({result.warnings.length})</p>
                                        {result.warnings.map((w, i) => (
                                            <p key={i} className="text-[12px] text-warning">{w}</p>
                                        ))}
                                    </div>
                                )}

                                {summary.length === 0 && result.blockingErrors.length === 0 && result.warnings.length === 0 && (
                                    <p className="text-[13px] text-text-secondary text-center py-2">File không có dòng dữ liệu nào.</p>
                                )}

                                <button
                                    onClick={handleCommit}
                                    disabled={result.blockingErrors.length > 0 || summary.length === 0 || committing}
                                    className="w-full py-3 rounded-[12px] bg-primary text-bg text-[14px] font-black hover:bg-primary/90 active:bg-primary/80 transition-colors disabled:opacity-50 uppercase"
                                >
                                    {committing ? 'Đang nhập...' : 'Xác nhận nhập liệu'}
                                </button>
                            </div>
                        )}
                    </>
                )}
            </main>
        </div>
    )
}
