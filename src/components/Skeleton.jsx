export default function Skeleton({ className = '', ...props }) {
    return (
        <div
            className={`animate-pulse bg-surface-light rounded-[16px] ${className}`}
            {...props}
        />
    )
}

export function SkeletonCard({ className = '' }) {
    return (
        <div className={`bg-surface border border-border/60 rounded-[20px] p-4 shadow-sm space-y-3 ${className}`}>
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-5 w-16" />
        </div>
    )
}

export function SkeletonList({ count = 3 }) {
    return (
        <div className="space-y-3">
            {Array.from({ length: count }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
            ))}
        </div>
    )
}
