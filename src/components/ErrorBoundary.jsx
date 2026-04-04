import { Component } from 'react'

export default class ErrorBoundary extends Component {
    constructor(props) {
        super(props)
        this.state = { hasError: false, error: null }
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error }
    }

    componentDidCatch(error, errorInfo) {
        console.error('ErrorBoundary caught:', error, errorInfo)
    }

    handleReload = () => {
        window.location.reload()
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="flex flex-col items-center justify-center min-h-screen bg-bg px-6 text-center">
                    <span className="text-5xl mb-4">⚠️</span>
                    <h1 className="text-xl font-black text-text mb-2">Đã xảy ra lỗi</h1>
                    <p className="text-text-secondary text-sm mb-6 max-w-sm">
                        Ứng dụng gặp sự cố không mong muốn. Vui lòng tải lại trang để tiếp tục.
                    </p>
                    {this.state.error && (
                        <pre className="text-[11px] text-danger/70 bg-surface border border-border/60 rounded-xl p-3 mb-6 max-w-sm overflow-auto text-left whitespace-pre-wrap">
                            {this.state.error.message}
                        </pre>
                    )}
                    <button
                        onClick={this.handleReload}
                        className="px-6 py-3 rounded-[14px] bg-primary text-white font-bold text-sm hover:bg-primary/90 active:bg-primary/80 transition-colors"
                    >
                        Tải lại trang
                    </button>
                </div>
            )
        }

        return this.props.children
    }
}
