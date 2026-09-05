import ChecklistRow from '../ChecklistRow'

// Phase 2 "Xem nhật ký" — theo dõi việc user tự bấm qua 3 tab của /history (Thu nhập/Chi
// phí/Báo cáo, xem HistoryTabsBar.jsx). "Thu nhập" tick ngay vì đó là tab mặc định
// khi vào /history; "Chi phí"/"Báo cáo" tick khi user tự bấm tab tương ứng —
// ghi từ HistoryPage.jsx (xem onboardingStorage.js).
export default {
    name: 'Xem nhật ký',
    done: (ctx) => ctx.journalProgress.viewedIncome && ctx.journalProgress.viewedExpense && ctx.journalProgress.viewedReport,
    Body: ({ ctx }) => (
        <>
            <ChecklistRow label="Doanh thu" done={ctx.journalProgress.viewedIncome} />
            <ChecklistRow label="Chi phí" done={ctx.journalProgress.viewedExpense} />
            <ChecklistRow label="Báo cáo" done={ctx.journalProgress.viewedReport} />
        </>
    ),
}
