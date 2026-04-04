import { useEffect, useState } from 'react'
import { Bell } from 'lucide-react'
import { formatVND } from '../utils'

export default function RealtimeNotification({ notification, onClose }) {
    const [visible, setVisible] = useState(false)

    useEffect(() => {
        if (notification) {
            setVisible(true)
            const timer = setTimeout(() => {
                setVisible(false)
                setTimeout(onClose, 300) // wait for exit animation
            }, 5000)
            return () => clearTimeout(timer)
        }
    }, [notification, onClose])

    if (!notification && !visible) return null

    return (
        <div
            className={`fixed top-4 left-1/2 -translate-x-1/2 z-[100] transition-all duration-300 w-[90%] max-w-[360px] ${visible ? 'translate-y-0 opacity-100 scale-100' : '-translate-y-12 opacity-0 scale-95'
                }`}
        >
            <div className="bg-primary border border-primary/20 shadow-lg rounded-2xl p-4 flex items-start gap-3 text-bg text-left relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-white/20">
                    <div className="h-full bg-white/80 animate-[shrink_5s_linear_forwards]" />
                </div>

                <div className="mt-1 shrink-0 bg-white/20 p-2 rounded-full">
                    <Bell size={20} className="text-white" />
                </div>

                <div className="flex-1 min-w-0 pr-4">
                    <h4 className="text-[14px] font-black uppercase tracking-wider mb-1">
                        {notification?.title || 'Có đơn mới!'}
                    </h4>
                    <p className="text-[13px] font-medium opacity-90 truncate">
                        {notification?.description}
                    </p>
                    <p className="text-[15px] font-black mt-1">
                        + {formatVND(notification?.total || 0)}
                    </p>
                </div>

                <button
                    onClick={() => setVisible(false)}
                    className="absolute top-3 right-3 p-1 rounded-full hover:bg-white/20 transition-colors"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                </button>
            </div>
        </div>
    )
}
