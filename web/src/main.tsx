import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { App as AntdApp, ConfigProvider } from 'antd'
import './index.css'
import { consoleTheme } from './theme.ts'
import { routeTree } from './routeTree.gen'
import { ADMIN_BASEPATH } from './lib/paths'

const router = createRouter({
  routeTree,
  basepath: ADMIN_BASEPATH,
  defaultPreload: 'intent',
  scrollRestoration: true,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

// `AntdApp` supplies the context that `message`, `notification` and `modal` need in order to
// pick up the theme above. Calling them off the static import instead — `message.success()`
// — renders them unthemed, which in a dark console means a white toast.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider theme={consoleTheme}>
      <AntdApp>
        <RouterProvider router={router} />
      </AntdApp>
    </ConfigProvider>
  </StrictMode>,
)
