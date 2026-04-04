import { useState, useEffect } from 'react'
import { useAddress } from '../contexts/AddressContext'
import { useAuth } from '../contexts/AuthContext'
import { useNavigate } from 'react-router-dom'
import { fetchBranchTodayCups, fetchActiveSessions } from '../services/authService'

export default function AddressSelectPage() {
    const { addresses, setSelectedAddress, createNewAddress, renameAddress, removeAddress, loading } = useAddress()
    const { signOut, profile, isStaff } = useAuth()
    const navigate = useNavigate()
    const [newName, setNewName] = useState('')
    const [creating, setCreating] = useState(false)
    const [showForm, setShowForm] = useState(false)
    const [error, setError] = useState('')
    const [editingAddressId, setEditingAddressId] = useState(null)
    const [editName, setEditName] = useState('')

    // Quick stats
    const [cupsMap, setCupsMap] = useState({})       // { addressId: cupCount }
    const [sessionsMap, setSessionsMap] = useState({}) // { addressId: [{ name }] }
    const [statsLoading, setStatsLoading] = useState(false)

    // Fetch stats when addresses are loaded
    useEffect(() => {
        if (!addresses.length) return
        const addrIds = addresses.map(a => a.id)
        setStatsLoading(true)

        Promise.all([
            fetchBranchTodayCups(addrIds),
            fetchActiveSessions(addrIds)
        ]).then(([cups, sessions]) => {
            setCupsMap(cups)
            // Group sessions by address_id
            const grouped = {}
            sessions.forEach(s => {
                if (!grouped[s.address_id]) grouped[s.address_id] = []
                grouped[s.address_id].push(s.users?.name || 'Unknown')
            })
            setSessionsMap(grouped)
        }).finally(() => setStatsLoading(false))
    }, [addresses])

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
            <div className="flex flex-col items-center justify-center min-h-screen bg-bg px-4">
                <div className="w-full max-w-sm space-y-3">
                    <div className="animate-pulse bg-surface-light rounded-[16px] h-16 w-full" />
                    <div className="animate-pulse bg-surface-light rounded-[16px] h-16 w-full" />
                    <div className="animate-pulse bg-surface-light rounded-[16px] h-16 w-full" />
                    <div className="animate-pulse bg-surface-light rounded-[16px] h-10 w-1/2 mx-auto mt-4" />
                </div>
            </div>
        )
    }

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

                    {addresses.map(addr => {
                        const cups = cupsMap[addr.id] || 0
                        const staffNames = sessionsMap[addr.id] || []

                        return (
                            <div key={addr.id} className="w-full bg-surface border border-border/60 rounded-[16px] overflow-hidden shadow-sm group">
                                {editingAddressId === addr.id ? (
                                    <form
                                        className="flex w-full px-2 py-2 gap-2"
                                        onSubmit={async (e) => {
                                            e.preventDefault()
                                            if (!editName.trim()) return
                                            try {
                                                await renameAddress(addr.id, editName.trim())
                                                setEditingAddressId(null)
                                            } catch (err) {
                                                setError(err.message || 'Không thể đổi tên địa chỉ')
                                            }
                                        }}
                                    >
                                        <input
                                            type="text"
                                            value={editName}
                                            onChange={e => setEditName(e.target.value)}
                                            className="flex-1 px-3 py-2 rounded-[10px] bg-bg border border-border/60 text-text text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
                                            autoFocus
                                        />
                                        <button type="submit" className="px-3 py-2 bg-primary text-white text-xs font-bold rounded-[10px]">Lưu</button>
                                        <button type="button" onClick={() => { setEditingAddressId(null); setError(''); }} className="px-3 py-2 bg-bg border border-border/60 text-text-secondary text-xs font-bold rounded-[10px]">Hủy</button>
                                    </form>
                                ) : (
                                    <div className="flex items-center">
                                        <button
                                            onClick={() => handleSelect(addr)}
                                            className="flex-1 px-5 py-3 text-left hover:bg-surface-light active:bg-border/30 transition-colors"
                                        >
                                            <span className="text-text font-bold text-sm group-hover:text-primary transition-colors block">{addr.name}</span>
                                            {!statsLoading && (
                                                <span className="text-text-secondary text-xs mt-1 flex items-center gap-3">
                                                    <span>☕ {cups} ly</span>
                                                    {staffNames.length > 0 && (
                                                        <span>👤 {staffNames.join(', ')}</span>
                                                    )}
                                                </span>
                                            )}
                                        </button>
                                        {(!isStaff) && (
                                            <div className="flex flex-shrink-0 px-2 space-x-1">
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setEditingAddressId(addr.id);
                                                        setEditName(addr.name);
                                                        setError('');
                                                    }}
                                                    className="p-2 text-text-secondary hover:text-primary transition-colors"
                                                    title="Đổi tên"
                                                >
                                                    ✏️
                                                </button>
                                                <button
                                                    onClick={async (e) => {
                                                        e.stopPropagation();
                                                        if (window.confirm(`Bạn có chắc muốn xóa địa chỉ "${addr.name}"? Việc này có thể ảnh hưởng đến các dữ liệu liên quan.`)) {
                                                            try {
                                                                await removeAddress(addr.id)
                                                            } catch (err) {
                                                                setError(err.message || 'Không thể xóa địa chỉ')
                                                            }
                                                        }
                                                    }}
                                                    className="p-2 text-text-secondary hover:text-danger transition-colors"
                                                    title="Xóa"
                                                >
                                                    🗑️
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )
                    })}
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
