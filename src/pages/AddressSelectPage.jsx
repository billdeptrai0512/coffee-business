import { useState } from 'react'
import { useAddress } from '../contexts/AddressContext'
import { useAuth } from '../contexts/AuthContext'
import { useNavigate } from 'react-router-dom'

export default function AddressSelectPage() {
    const { addresses, setSelectedAddress, createNewAddress, loading } = useAddress()
    const { signOut, profile, isStaff } = useAuth()
    const navigate = useNavigate()
    const [newName, setNewName] = useState('')
    const [creating, setCreating] = useState(false)
    const [showForm, setShowForm] = useState(false)
    const [error, setError] = useState('')

    function handleSelect(addr) {
        setSelectedAddress(addr)
        navigate('/pos', { replace: true })
    }

    async function handleCreate(e) {
        e.preventDefault()
        if (!newName.trim()) return
        setCreating(true)
        setError('')
        try {
            const addr = await createNewAddress(newName.trim())
            setNewName('')
            setShowForm(false)
            handleSelect(addr)
        } catch (err) {
            setError(err.message || 'Không thể tạo địa chỉ')
        } finally {
            setCreating(false)
        }
    }

    async function handleSignOut() {
        await signOut()
        navigate('/login', { replace: true })
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-bg">
                <span className="text-text-secondary font-medium">Đang tải...</span>
            </div>
        )
    }

    console.log(profile)

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-bg px-4">
            <div className="w-full max-w-sm">
                <div className="text-center mb-6">
                    <span className="text-4xl">📍</span>
                    <h1 className="text-xl font-black text-text mt-3">Chọn địa chỉ</h1>
                    {profile && (
                        <p className="text-text-secondary text-sm mt-1">
                            Xin chào, <span className="font-bold text-text">{profile.name}</span>
                        </p>
                    )}
                </div>

                <div className="space-y-3 mb-4">
                    {addresses.length === 0 && !showForm && (
                        <div className="bg-surface border border-border/60 rounded-[16px] p-5 text-center text-text-secondary text-sm">
                            Chưa có địa chỉ nào. Tạo địa chỉ mới để bắt đầu!
                        </div>
                    )}

                    {addresses.map(addr => (
                        <button
                            key={addr.id}
                            onClick={() => handleSelect(addr)}
                            className="w-full bg-surface border border-border/60 rounded-[16px] px-5 py-4 text-left hover:bg-surface-light active:bg-border/30 transition-colors shadow-sm group"
                        >
                            <span className="text-text font-bold text-sm group-hover:text-primary transition-colors">{addr.name}</span>
                        </button>
                    ))}
                </div>

                {(!isStaff) && (
                    showForm ? (
                        <form onSubmit={handleCreate} className="bg-surface border border-border/60 rounded-[16px] p-4 shadow-sm space-y-3">
                            {error && (
                                <div className="bg-danger/10 border border-danger/20 text-danger text-xs font-medium rounded-[10px] p-2">
                                    {error}
                                </div>
                            )}
                            <input
                                type="text"
                                value={newName}
                                onChange={e => setNewName(e.target.value)}
                                placeholder="Tên địa chỉ mới (vd: Quán Cầu Giấy)"
                                autoFocus
                                className="w-full px-4 py-3 rounded-[14px] bg-bg border border-border/60 text-text text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all"
                            />
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => { setShowForm(false); setNewName(''); setError('') }}
                                    className="flex-1 py-2.5 rounded-[12px] bg-bg border border-border/60 text-text-secondary font-bold text-xs hover:bg-border/30 transition-colors"
                                >
                                    Hủy
                                </button>
                                <button
                                    type="submit"
                                    disabled={creating || !newName.trim()}
                                    className="flex-1 py-2.5 rounded-[12px] bg-primary text-white font-bold text-xs hover:bg-primary/90 active:bg-primary/80 transition-colors disabled:opacity-50"
                                >
                                    {creating ? 'Đang tạo...' : 'Tạo'}
                                </button>
                            </div>
                        </form>
                    ) : (
                        <button
                            onClick={() => setShowForm(true)}
                            className="w-full py-3 rounded-[14px] bg-primary/10 border border-primary/20 text-primary font-bold text-sm hover:bg-primary/15 active:bg-primary/20 transition-colors"
                        >
                            +
                        </button>
                    )
                )}

                <button
                    onClick={handleSignOut}
                    className="w-full mt-4 py-2.5 rounded-[14px] text-text-secondary text-xs font-bold hover:text-danger transition-colors"
                >
                    Đăng xuất
                </button>
            </div>
        </div>
    )
}
