// Title-case each whitespace-separated word: uppercase the first letter,
// leave the rest as typed. Length-preserving (case-only) so the caret stays
// put on end-typing. ponytail: caret jumps to end on mid-string edits —
// acceptable for short name fields; track caret via selectionStart if it bites.
// Viết hoa chữ cái đầu của cả chuỗi ('đ' → 'Đ' được toUpperCase xử lý đúng).
export const capFirst = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

export function capitalizeWords(s) {
    return s.replace(/(^|\s)(\p{L})/gu, (_, sp, ch) => sp + ch.toUpperCase())
}
