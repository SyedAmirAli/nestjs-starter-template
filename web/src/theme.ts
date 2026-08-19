import { theme, type ThemeConfig } from 'antd'

/**
 * The console's Ant Design theme.
 *
 * Deliberately thin: the dark algorithm's defaults are the design, and every colour in the
 * console is expected to come from a token rather than from a hand-written hex. The one
 * place that cannot read these tokens is the server-rendered sign-in page
 * (`src/web/login-page.ts` in the API), which hard-codes the values below — the seam
 * between the two is a full page load, so they have to agree.
 *
 * Do NOT add `layer` to the ConfigProvider that consumes this. See src/index.css for why.
 */
export const consoleTheme: ThemeConfig = {
  algorithm: theme.darkAlgorithm,
  token: {
    // The API's brand hue, in place of antd's default blue. Everything derived from it —
    // hover states, focus rings, active menu items — follows automatically.
    colorPrimary: '#6366f1',
  },
  components: {
    Layout: {
      // The sider reads as a panel against the near-black page, matching `colorBgContainer`
      // so cards and navigation share one surface colour.
      siderBg: '#141414',
      headerBg: '#141414',
      bodyBg: '#000000',
    },
    Menu: {
      darkItemBg: '#141414',
      darkSubMenuItemBg: '#141414',
    },
  },
}
