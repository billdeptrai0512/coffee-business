import { Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { AddressProvider, useAddress } from './contexts/AddressContext'
import { ProductProvider } from './contexts/ProductContext'
import { POSProvider } from './contexts/POSContext'
import ErrorBoundary from './components/ErrorBoundary'
import './index.css'

// Pages
import LoginPage from './pages/LoginPage'
import SignUpPage from './pages/SignUpPage'
import AddressSelectPage from './pages/AddressSelectPage'
import POSPage from './pages/POSPage'
import HistoryPage from './pages/HistoryPage'
import RecipeManagerPage from './pages/RecipeManagerPage'
import DailyReportPage from './pages/DailyReportPage'

// Protected route: redirects to /login if not authenticated
function ProtectedRoute() {
  const { user, loading } = useAuth()

  if (loading) {
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

  if (!user) return <Navigate to="/login" replace />
  return <Outlet />
}

// Requires a selected address before entering POS pages
function RequireAddress() {
  const { selectedAddress, loading } = useAddress()

  if (loading) {
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

  if (!selectedAddress) return <Navigate to="/addresses" replace />
  return <Outlet />
}

// Manager-only route guard
function ManagerOnly() {
  const { isManager, isAdmin, loading } = useAuth()

  if (loading) {
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

  if (!isManager && !isAdmin) return <Navigate to="/pos" replace />

  return <Outlet />
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignUpPage />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<AddressProvider />}>
              <Route path="/addresses" element={<AddressSelectPage />} />
              <Route element={<RequireAddress />}>
                <Route element={<ProductProvider />}>
                  <Route element={<POSProvider />}>
                    <Route path="/pos" element={<POSPage />} />
                    <Route path="/history" element={<HistoryPage />} />
                    <Route path="/daily-report" element={<DailyReportPage />} />
                    {/* Manager-only routes */}
                    <Route element={<ManagerOnly />}>
                      <Route path="/recipes" element={<RecipeManagerPage />} />
                    </Route>
                  </Route>
                </Route>
              </Route>
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/pos" />} />
        </Routes>
      </AuthProvider>
    </ErrorBoundary>
  )
}
