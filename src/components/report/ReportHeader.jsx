import { ArrowLeft } from 'lucide-react'

export default function ReportHeader({ onBack }) {
    return (
        <header className="shrink-0 pt-6 pb-4 bg-surface border-b border-border/60 shadow-sm relative z-20 flex items-center px-4 gap-3">
            <button
                onClick={onBack}
                className="w-10 h-10 flex flex-col items-center justify-center rounded-[14px] bg-surface-light border border-border/60 text-text hover:bg-border/40 active:bg-border/60 transition-colors shadow-sm focus:outline-none"
                title="Trở về"
            >
                <ArrowLeft size={20} strokeWidth={2.5} />
            </button>
            <div className="flex-1 text-center pr-10">
                <h1 className="text-[16px] font-black uppercase text-primary tracking-wider">Báo Cáo Cuối Ngày</h1>
                <span className="text-[12px] font-medium text-text-secondary">{new Date().toLocaleDateString('vi-VN')}</span>
            </div>
        </header>
    )
}
