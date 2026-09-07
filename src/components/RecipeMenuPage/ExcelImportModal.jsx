import { useRef, useState } from 'react'
import { X } from 'lucide-react'
import { Dialog } from '../common/ModalShell'
import { useProducts } from '../../contexts/ProductContext'
import { useAddress } from '../../contexts/AddressContext'
import { useToast } from '../../hooks/useToast'
import Toast from '../POSPage/Toast'
import { parseWorkbook, resolveImportPlan, commitImportPlan } from '../../services/importService'

// Nhập liệu hàng loạt từ 1 file Excel (mẫu ở public/templates/mau-nhap-lieu.xlsx) — mở từ
// "+ Tạo công thức" ở RecipeMenuPage thay vì 1 trang riêng. 2 cột trái/phải (tải mẫu | chọn
// file), kết quả xem trước (resolveImportPlan, thuần, chưa ghi gì) hiện full-width bên dưới
// sau khi chọn file, xác nhận mới thật sự ghi (commitImportPlan).
export default function ExcelImportModal({ onClose }) {
    const { products, toppings, ingredientCosts, refreshProducts } = useProducts()
    const { selectedAddress } = useAddress()
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
        <Dialog onClose={() => !committing && onClose()} panelClassName="w-full max-w-xl mx-4 max-h-[85dvh] flex flex-col bg-surface border border-border/60 rounded-[24px] shadow-2xl overflow-hidden">
            <Toast toast={toast} />

            <div className="shrink-0 flex items-center justify-between px-5 pt-5 pb-3 border-b border-border/60">
                <span className="text-[16px] font-black text-text">Nhập liệu Excel</span>
                <button
                    onClick={() => !committing && onClose()}
                    className="w-8 h-8 flex items-center justify-center rounded-full bg-surface-light border border-border/60 text-text-secondary hover:text-text transition-all"
                >
                    <X size={16} />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-3">
                    <a
                        href="/templates/mau-nhap-lieu.xlsx"
                        download
                        className="flex flex-col items-center justify-center text-center gap-1 py-6 px-3 text-[13px] text-primary/80 hover:text-primary font-medium bg-surface-light border border-border/60 rounded-[16px] transition-colors"
                    >
                        <span className="font-black">Tải file mẫu</span>
                        <span className="text-[11px] text-text-secondary">mau-nhap-lieu.xlsx</span>
                    </a>

                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className="flex flex-col items-center justify-center text-center gap-1 py-6 px-3 text-[13px] text-text-secondary font-bold bg-surface-light border border-dashed border-border rounded-[16px] hover:bg-border/20 transition-colors"
                    >
                        <span className="font-black">+ Chọn file đã điền</span>
                        {fileName && <span className="text-[11px] text-text-secondary/80 line-clamp-1 break-all px-1">{fileName}</span>}
                    </button>
                    <input ref={fileInputRef} type="file" accept=".xlsx" onChange={handleFileChange} className="hidden" />
                </div>

                {result && (
                    <div className="flex flex-col gap-3">
                        {summary.length > 0 && (
                            <div className="space-y-1">
                                {summary.map(([n, label]) => (
                                    <p key={label} className="text-[13px] font-bold text-success">Sẽ tạo {n} {label}</p>
                                ))}
                            </div>
                        )}

                        {(result.plan.recipes.length > 0 || result.plan.toppingIngredients.length > 0 || result.plan.toppingLinks.length > 0) && (
                            <div className="space-y-1 bg-warning-soft border border-warning/20 rounded-[12px] p-3">
                                <p className="text-[12px] font-black text-warning uppercase">Lưu ý ghi đè</p>
                                {(result.plan.recipes.length > 0 || result.plan.toppingIngredients.length > 0) && (
                                    <p className="text-[12px] text-warning">Công thức/Công thức Topping: dòng trùng đúng nguyên liệu đã có trong công thức sẽ bị ghi đè số lượng, không hỏi lại.</p>
                                )}
                                {result.plan.toppingLinks.length > 0 && (
                                    <p className="text-[12px] text-warning">Topping áp dụng món: ghi đè TOÀN BỘ danh sách món của mỗi topping trong file — món cũ không có trong file sẽ bị gỡ liên kết.</p>
                                )}
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
            </div>
        </Dialog>
    )
}
