import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { App as AntdApp, ConfigProvider } from 'antd'
import './index.css'
import App from './App.tsx'
import { consoleTheme } from './theme.ts'

// No `basename`: the console owns the root path, and the API lives under prefixes the
// console is barred from claiming (src/web/reserved-paths.ts).
//
// `AntdApp` supplies the context that `message`, `notification` and `modal` need in order to
// pick up the theme above. Calling them off the static import instead — `message.success()`
// — renders them unthemed, which in a dark console means a white toast.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider theme={consoleTheme}>
      <AntdApp>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AntdApp>
    </ConfigProvider>
  </StrictMode>,
)
