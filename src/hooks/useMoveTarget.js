import { useState } from 'react'

// Trạng thái "đang chọn bàn đích" — dùng chung cho Gộp/Chuyển bàn (TableDetailModal) và
// Chuyển vào bàn (TakeawayListModal), cả hai chỉ khác nhau ở orderIds/label truyền cho
// TableTargetPicker lúc bấm chuyển.
export function useMoveTarget() {
    const [moving, setMoving] = useState(null) // { orderIds: string[], label: string } | null
    return {
        moving,
        startMove: (orderIds, label) => setMoving({ orderIds, label }),
        cancelMove: () => setMoving(null),
    }
}
