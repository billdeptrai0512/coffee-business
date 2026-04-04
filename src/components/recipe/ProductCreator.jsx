export default function ProductCreator({ addingProduct, setAddingProduct, newProductName, setNewProductName, newProductPrice, setNewProductPrice, handleCreateProduct }) {
    return (
        <div className="flex items-center justify-between px-4 py-2 bg-surface border border-border/60 rounded-[16px] shadow-sm">
            {addingProduct ? (
                <div className="flex w-full items-center gap-2">
                    <input
                        className="flex-1 min-w-0 bg-bg border border-border/60 rounded-lg px-2 py-1.5 text-[13px] text-text focus:outline-none focus:border-primary"
                        placeholder="Tên món"
                        value={newProductName}
                        onChange={e => setNewProductName(e.target.value)}
                        autoFocus
                    />
                    <input
                        className="w-[85px] bg-bg border border-border/60 rounded-lg px-2 py-1.5 text-[13px] text-text focus:outline-none focus:border-primary"
                        placeholder="Giá bán"
                        type="number"
                        value={newProductPrice}
                        onChange={e => setNewProductPrice(e.target.value)}
                    />
                    <div className="flex gap-1 shrink-0">
                        <button
                            onClick={handleCreateProduct}
                            className="bg-primary text-bg px-3 py-1.5 rounded-lg text-[13px] font-bold"
                        >
                            Lưu
                        </button>
                        <button
                            onClick={() => setAddingProduct(false)}
                            className="bg-surface-light text-text px-2 py-1.5 rounded-lg text-[13px] font-bold"
                        >
                            Hủy
                        </button>
                    </div>
                </div>
            ) : (
                <button
                    onClick={() => setAddingProduct(true)}
                    className="w-full text-center py-1.5 text-[14px] font-bold text-primary"
                >
                    + Thêm món mới
                </button>
            )}
        </div>
    )
}
