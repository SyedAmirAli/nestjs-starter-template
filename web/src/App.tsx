import { Route, Routes } from 'react-router'
import { AppShell } from './components/AppShell'
import { OverviewPage } from './pages/OverviewPage'
import { SystemPage } from './pages/SystemPage'
import { NotFoundPage } from './pages/NotFoundPage'

/**
 * There is no login route and no route guard here, by design: the admin gate on the server
 * refuses to serve this bundle at all without an ADMIN session, so every route below is
 * already behind authentication before a single byte of it is downloaded.
 * See src/web/admin-gate.ts.
 */
export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<OverviewPage />} />
        <Route path="system" element={<SystemPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
