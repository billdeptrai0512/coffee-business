import { lazy, Suspense, useEffect } from 'react'
import { Routes, Route, Navigate, Outlet, useSearchParams, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { AddressProvider, useAddress } from './contexts/AddressContext'
import { AddressStatsProvider } from './contexts/AddressStatsContext'
import { ProductProvider } from './contexts/ProductContext'
import { POSProvider } from './contexts/POSContext'
import { ConfirmProvider } from './contexts/ConfirmContext'
import { OnboardingVisibilityProvider, useOnboardingVisibility } from './contexts/OnboardingVisibilityContext'
import ErrorBoundary from './components/common/ErrorBoundary'
import OnboardingGuide from './components/common/onboarding/OnboardingGuide'
import './index.css'

// Pages — lazy-loaded for route-level code splitting
const LoginPage = lazy(() => import('./pages/LoginPage'))
const SignUpPage = lazy(() => import('./pages/SignUpPage'))
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'))

const AddressSelectPage = lazy(() => import('./pages/AddressSelectPage'))
const SubscriptionPage = lazy(() => import('./pages/SubscriptionPage'))
const AdminReconciliationPage = lazy(() => import('./pages/AdminReconciliationPage'))
const AdminDashboardPage = lazy(() => import('./pages/AdminDashboardPage'))
const POSPage = lazy(() => import('./pages/POSPage'))
const HistoryPage = lazy(() => import('./pages/HistoryPage'))
const RecipeMenuPage = lazy(() => import('./pages/RecipeMenuPage'))
const RecipeIngredientPage = lazy(() => import('./pages/RecipeIngredientPage'))
const DailyReportPage = lazy(() => import('./pages/DailyReportPage'))
const IngredientManagementPage = lazy(() => import('./pages/IngredientManagementPage'))
const IngredientDetailPage = lazy(() => import('./pages/IngredientDetailPage'))
const ToppingsPage = lazy(() => import('./pages/ToppingsPage'))
const ToppingDetailPage = lazy(() => import('./pages/ToppingDetailPage'))
const DiscountProgramsPage = lazy(() => import('./pages/DiscountProgramsPage'))
const DiscountProgramDetailPage = lazy(() => import('./pages/DiscountProgramDetailPage'))

function PageLoading() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-bg px-6 gap-4">
      <div className="w-full max-w-sm space-y-3">
        <div className="animate-pulse bg-surface-light rounded-[16px] h-14 w-full" />
        <div className="animate-pulse bg-surface-light rounded-[16px] h-14 w-full" />
        <div className="animate-pulse bg-surface-light rounded-[16px] h-10 w-3/4 mx-auto" />
      </div>
    </div>
  )
}

// Legacy /range-report entry — folded into /daily-report's range mode. Preserve
// the requested range (and any nav state) by seeding scope on the redirect.
function RangeReportRedirect() {
  const [params] = useSearchParams()
  const { state } = useLocation()
  const scope = params.get('range') === 'month' ? 'month' : 'week'
  return <Navigate to="/daily-report" replace state={{ ...state, scope }} />
}

// Capture a ?clone=CODE share link the moment the app loads (before any auth
// redirect can drop it). Stash in sessionStorage so it survives login/signup;
// AddressSelectPage picks it up and pre-fills "Tạo địa chỉ". Then strip the
// param so a refresh doesn't re-trigger.
function CloneCapture() {
  const [params, setParams] = useSearchParams()
  useEffect(() => {
    const code = params.get('clone')
    if (!code) return
    sessionStorage.setItem('pending_clone_code', code.trim().toUpperCase())
    const next = new URLSearchParams(params)
    next.delete('clone')
    setParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

// Protected route: allows both authenticated users and active guest sessions
function ProtectedRoute() {
  const { user, isGuest, loading } = useAuth()
  if (loading) return <PageLoading />
  if (!user && !isGuest) return <Navigate to="/login" replace />
  return <Outlet />
}

// Requires a selected address before entering POS pages
function RequireAddress() {
  const { selectedAddress, loading } = useAddress()
  if (loading) return <PageLoading />
  if (!selectedAddress) return <Navigate to="/addresses" replace />
  return <Outlet />
}

// Mounts the "Bắt đầu bán hàng" onboarding guide once for every page inside
// RequireAddress/ProductProvider, instead of each page wiring it in individually.
// Pages can still hide it via useOnboardingVisibility() when they have their
// own bottom-fixed UI (e.g. sort mode) that would otherwise overlap it.
function OnboardingLayout() {
  return (
    <OnboardingVisibilityProvider>
      <Outlet />
      <OnboardingGuideSlot />
    </OnboardingVisibilityProvider>
  )
}
function OnboardingGuideSlot() {
  const { hidden } = useOnboardingVisibility()
  if (hidden) return null
  return <OnboardingGuide />
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <ConfirmProvider>
        <Suspense fallback={<PageLoading />}>
          <CloneCapture />
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignUpPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />

            <Route element={<ProtectedRoute />}>
              <Route element={<AddressProvider />}>
                <Route element={<AddressStatsProvider />}>
                  <Route path="/addresses" element={<AddressSelectPage />} />
                  <Route path="/subscription" element={<SubscriptionPage />} />
                  <Route path="/admin/reconciliation" element={<AdminReconciliationPage />} />
                  <Route path="/admin/dashboard" element={<AdminDashboardPage />} />
                  <Route element={<RequireAddress />}>
                    <Route element={<ProductProvider />}>
                      <Route element={<POSProvider />}>
                        <Route element={<OnboardingLayout />}>
                          <Route path="/pos" element={<POSPage />} />
                          <Route path="/history" element={<HistoryPage />} />
                          <Route path="/shift-closing" element={<Navigate to="/daily-report" replace state={{ initialView: 'inventory' }} />} />
                          <Route path="/daily-report" element={<DailyReportPage />} />
                          <Route path="/range-report" element={<RangeReportRedirect />} />
                          <Route path="/expenses" element={<Navigate to="/history" replace />} />
                          {/* Feature-level permission routes (anyone can view, managers can edit) */}
                          <Route path="/recipes" element={<RecipeMenuPage />} />
                          <Route path="/recipes/:productId" element={<RecipeIngredientPage />} />
                          <Route path="/ingredients" element={<IngredientManagementPage />} />
                          <Route path="/ingredients/:ingredientKey" element={<IngredientDetailPage />} />
                          <Route path="/toppings" element={<ToppingsPage />} />
                          <Route path="/toppings/:toppingId" element={<ToppingDetailPage />} />
                          <Route path="/discounts" element={<DiscountProgramsPage />} />
                          <Route path="/discounts/:id" element={<DiscountProgramDetailPage />} />
                        </Route>
                      </Route>
                    </Route>
                  </Route>
                </Route>
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/pos" />} />
          </Routes>
        </Suspense>
        </ConfirmProvider>
      </AuthProvider>
    </ErrorBoundary>
  )
}
