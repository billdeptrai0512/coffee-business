import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useNavigate, Link } from 'react-router-dom'
import { fetchManagers } from '../services/authService'

export default function SignUpPage() {
    const { signUp } = useAuth()
    const navigate = useNavigate()
    const [name, setName] = useState('')
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [role, setRole] = useState('staff')
    const [managerId, setManagerId] = useState('')
    const [secretCode, setSecretCode] = useState('')
    const [managers, setManagers] = useState([])
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)

    useEffect(() => {
        fetchManagers().then(data => {
            setManagers(data)
            if (data.length > 0) setManagerId(data[0].id)
        }).catch(err => console.error('Failed to load managers', err))
    }, [])

    async function handleSubmit(e) {
        e.preventDefault()
        if (!name.trim()) { setError('Vui lòng nhập tên'); return }
        if (!username.trim()) { setError('Vui lòng nhập tài khoản'); return }
        if (username.length < 3) { setError('Tài khoản ít nhất 3 ký tự'); return }
        if (role === 'staff' && !managerId) { setError('Vui lòng chọn quản lý để trực thuộc'); return }
        if (role === 'manager' && secretCode !== '8888') { setError('Mã giới thiệu không hợp lệ'); return }
        setError('')
        setLoading(true)
        try {
            await signUp(username.trim(), password, name.trim(), role, role === 'staff' ? managerId : null)
            navigate('/addresses', { replace: true })
        } catch (err) {
            setError(err.message || 'Đăng ký thất bại')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-bg px-4">
            <div className="w-full max-w-sm">
                <div className="text-center mb-8">
                    {/* <img src="/icons/icon-512x512.png" alt="Kôphin" className="w-16 h-16 mx-auto rounded-[16px] shadow-sm" /> */}
                    <h1 className="text-2xl font-black text-text mt-3">Tạo tài khoản</h1>
                    <p className="text-text-secondary text-sm mt-1">Đăng ký để bắt đầu làm việc</p>
                </div>

                <form onSubmit={handleSubmit} className="bg-surface border border-border/60 rounded-[20px] p-6 shadow-sm space-y-4">
                    {error && (
                        <div className="bg-danger/10 border border-danger/20 text-danger text-sm font-medium rounded-[12px] p-3">
                            {error}
                        </div>
                    )}

                    <div>
                        <label className="block text-xs font-bold text-text-secondary uppercase tracking-wider mb-1.5">Tên</label>
                        <input
                            type="text"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            required
                            autoFocus
                            className="w-full px-4 py-3 rounded-[14px] bg-bg border border-border/60 text-text text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all"
                            placeholder="Nguyễn Thiện B"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-text-secondary uppercase tracking-wider mb-1.5">Tài khoản</label>
                        <input
                            type="text"
                            value={username}
                            onChange={e => setUsername(e.target.value)}
                            required
                            className="w-full px-4 py-3 rounded-[14px] bg-bg border border-border/60 text-text text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all"
                            placeholder="Đăng nhập"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-text-secondary uppercase tracking-wider mb-1.5">Mật khẩu</label>
                        <input
                            type="password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            required
                            minLength={6}
                            className="w-full px-4 py-3 rounded-[14px] bg-bg border border-border/60 text-text text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all"
                            placeholder="Tối thiểu 6 ký tự"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-text-secondary uppercase tracking-wider mb-1.5">Vai trò</label>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => setRole('manager')}
                                className={`flex-1 py-2.5 rounded-[12px] text-xs font-bold border transition-colors ${role === 'manager'
                                    ? 'bg-primary/10 text-primary border-primary'
                                    : 'bg-bg text-text-secondary border-border/60 hover:bg-border/30'
                                    }`}
                            >
                                Quản lý
                            </button>
                            <button
                                type="button"
                                onClick={() => setRole('staff')}
                                className={`flex-1 py-2.5 rounded-[12px] text-xs font-bold border transition-colors ${role === 'staff'
                                    ? 'bg-primary/10 text-primary border-primary'
                                    : 'bg-bg text-text-secondary border-border/60 hover:bg-border/30'
                                    }`}
                            >
                                Nhân viên
                            </button>
                        </div>
                    </div>

                    {role === 'manager' && (
                        <div>
                            <label className="block text-xs font-bold text-text-secondary uppercase tracking-wider mb-1.5">Mã giới thiệu</label>
                            <input
                                type="password"
                                value={secretCode}
                                onChange={e => setSecretCode(e.target.value)}
                                required
                                className="w-full px-4 py-3 rounded-[14px] bg-bg border border-border/60 text-text text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all"
                                placeholder="Nhập mã bí mật..."
                            />
                        </div>
                    )}

                    {role === 'staff' && (
                        <div>
                            <label className="block text-xs font-bold text-text-secondary uppercase tracking-wider mb-1.5">Chọn quản lý của bạn</label>
                            <select
                                value={managerId}
                                onChange={e => setManagerId(e.target.value)}
                                required
                                className="w-full px-4 py-3 rounded-[14px] bg-bg border border-border/60 text-text text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all appearance-none"
                            >
                                {managers.length === 0 && <option value="" disabled>Chưa có quản lý nào</option>}
                                {managers.map(mgr => (
                                    <option key={mgr.id} value={mgr.id}>
                                        {mgr.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full py-3 rounded-[14px] bg-primary text-white font-bold text-sm hover:bg-primary/90 active:bg-primary/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {loading ? 'Đang tạo...' : 'Đăng ký'}
                    </button>
                </form>

                <p className="text-center text-text-secondary text-xs mt-4">
                    Đã có tài khoản?{' '}
                    <Link to="/login" className="text-primary font-bold hover:underline">Đăng nhập</Link>
                </p>
            </div>
        </div>
    )
}
