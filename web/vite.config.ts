import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'

/**
 * The admin console.
 *
 * Served under `/admin` (Vite `base` and the router's `basepath` must agree). The browser
 * never talks to this dev server directly. In development the API reverse-proxies `/admin`
 * here (WEB_DEV_SERVER_URL); in production it serves `dist/` itself. Either way the console
 * and the API share one origin, which is what lets `/v1` calls carry the session cookie with
 * no CORS and no second token.
 *
 * That also means HMR must not be configured: with no `server.ws.clientPort`, Vite's client
 * connects its websocket back to whichever origin served the page — the API — and the proxy
 * forwards the upgrade. Pinning a port here would make the client dial 5273 directly,
 * escaping the proxy.
 *
 * https://vite.dev/config/
 */
export default defineConfig({
  base: '/admin/',
  plugins: [
    // Must run before the React plugin so the route tree exists before JSX is compiled.
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
      quoteStyle: 'single',
    }),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    // Tailwind is the layout/spacing tool here, not the design system — Ant Design owns the
    // components. Preflight is deliberately not imported; see the note in src/index.css.
    tailwindcss()
  ],
  server: {
    // Not Vite's default 5173, nor 5174 that it falls back to: those belong to whichever
    // project starts first, and a developer with a second Vite app open would find this
    // console's proxy quietly serving the other one. Must match WEB_DEV_SERVER_URL.
    port: 5273,
    // The API's proxy targets a fixed URL. Without strictPort, Vite moves to the next free
    // port on a clash and the proxy answers 502 with nothing in either log to explain it.
    // Refusing to start is the more findable failure.
    strictPort: true,
  },
  build: {
    // The API reads this directory as WEB_DIST_DIR. Stated rather than defaulted because
    // the two sides have to agree.
    outDir: 'dist',
  },
})
