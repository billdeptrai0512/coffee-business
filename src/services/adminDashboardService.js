import { supabase } from '../lib/supabaseClient'

// 1 RPC tổng hợp toàn bộ số liệu cho /admin/dashboard (revenue, subscription
// health, danh sách cần chú ý, hoạt động gần đây) — admin_dashboard_overview
// tự chặn non-admin (RAISE EXCEPTION), đây chỉ gọi thẳng không cache vì trang
// chỉ có 1 nơi dùng và luôn muốn số mới nhất khi mở/refresh.
//
// Phễu onboarding khách dùng thử là RPC RIÊNG (guest_onboarding_funnel_stats,
// xem onboardingFunnelService.js) — OnboardingFunnelCard tự fetch lấy, KHÔNG
// gộp vào đây, vì hàm đó body 378 dòng và quy ước CREATE OR REPLACE nguyên
// body, sửa vào chỉ để thêm 1 số liệu không liên quan là rủi ro không đáng.
export async function fetchAdminDashboard() {
    const { data, error } = await supabase.rpc('admin_dashboard_overview')
    if (error) throw error
    return data
}

// Cohort funnel theo tuần (admin_funnel_cohorts, migration 20260824). RPC RIÊNG
// vì cùng lý do như guest funnel ở trên: overview() body 400+ dòng, quy ước
// CREATE OR REPLACE nguyên body. Ném lỗi để caller tự ẩn thẻ khi chưa apply.
export async function fetchAdminFunnelCohorts() {
    const { data, error } = await supabase.rpc('admin_funnel_cohorts')
    if (error) throw error
    return data
}
