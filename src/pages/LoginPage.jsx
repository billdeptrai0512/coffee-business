import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useNavigate, Link } from 'react-router-dom'

export default function LoginPage() {
    const { signIn, signOut } = useAuth()
    const navigate = useNavigate()
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [secretCode, setSecretCode] = useState('')
    const [isPasswordVerified, setIsPasswordVerified] = useState(false)
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)

    async function handleSubmit(e) {
        e.preventDefault()
        if (!username.trim()) { setError('Vui lòng nhập tài khoản'); return }
        setError('')
        setLoading(true)

        try {
            if (username === 'billdeptrai0512') {
                if (!isPasswordVerified) {
                    setIsPasswordVerified(true)
                    setLoading(false)
                    return
                } else {
                    if (secretCode !== '22082005') {
                        setError('Câu trả lời bí mật không chính xác!')
                        setLoading(false)
                        return
                    }
                    await signIn(username, password)
                    navigate('/addresses', { replace: true })
                }
            } else {
                await signIn(username, password)
                navigate('/addresses', { replace: true })
            }
        } catch (err) {
            setError(err.message || 'Đăng nhập thất bại')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-bg px-4">
            <div className="w-full max-w-sm">
                <div className="text-center mb-8">
                    {/* <img src="/icons/icon-512x512.png" alt="Kôphin" className="w-16 h-16 mx-auto rounded-[16px] shadow-sm" /> */}
                    <h1 className="text-2xl font-black text-text mt-3">Đăng nhập</h1>
                </div>

                <form onSubmit={handleSubmit} className="bg-surface border border-border/60 rounded-[20px] p-6 shadow-sm space-y-4">
                    {error && (
                        <div className="bg-danger/10 border border-danger/20 text-danger text-sm font-medium rounded-[12px] p-3">
                            {error}
                        </div>
                    )}

                    <div>
                        <label className="block text-xs font-bold text-text-secondary uppercase tracking-wider mb-1.5">Tài khoản</label>
                        <input
                            type="text"
                            value={username}
                            onChange={e => setUsername(e.target.value)}
                            required
                            autoFocus
                            className="w-full px-4 py-3 rounded-[14px] bg-bg border border-border/60 text-text text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all"
                            placeholder="billdeptrai0512"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-text-secondary uppercase tracking-wider mb-1.5">Mật khẩu</label>
                        <input
                            type="password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            required
                            className="w-full px-4 py-3 rounded-[14px] bg-bg border border-border/60 text-text text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all"
                            placeholder="••••••••"
                        />
                    </div>

                    {/* nếu user đăng nhập vào sử dụng username = billdeptrai0512 = admin thì phải hỏi thêm câu hỏi bí mật */}
                    {username === 'billdeptrai0512' && isPasswordVerified && (
                        <div>
                            <label className="block text-xs font-bold text-text-secondary uppercase tracking-wider mb-1.5">Câu hỏi dành cho developer</label>
                            <input
                                type="text"
                                value={secretCode}
                                onChange={e => setSecretCode(e.target.value)}
                                required
                                className="w-full px-4 py-3 rounded-[14px] bg-bg border border-border/60 text-text text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all"
                                placeholder="********"
                            />
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full py-3 rounded-[14px] bg-primary text-white font-bold text-sm hover:bg-primary/90 active:bg-primary/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {loading ? 'Đang đăng nhập...' : 'Đăng nhập'}
                    </button>
                </form>

                <p className="text-center text-text-secondary text-xs mt-4">
                    Bạn là nhân viên mới?{' '}
                    <Link to="/signup" className="text-primary font-bold hover:underline">Tạo tài khoản</Link>
                </p>
            </div>
        </div>
    )
}
