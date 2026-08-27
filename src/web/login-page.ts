import { APP_NAME } from '@/config/dotenv';
import { ADMIN_LOGIN_PATH } from './console-path';

/**
 * Shown to a caller holding a valid session that is not an admin — typically a normal app
 * account signed in on the same browser.
 *
 * Sign-in itself lives in the SPA at `/admin/login`. This page is the one surface that must
 * still render when we refuse a dashboard navigation without handing the operator the
 * console shell: a USER session hitting `/admin` is turned away here, and they can sign out
 * without downloading the rest of the bundle.
 */

const SIGN_OUT_ENDPOINT = '/api/auth/sign-out';

/**
 * HTML-escapes an interpolated value.
 *
 * Only `email` is ever interpolated today, and it arrives from the database rather than from
 * the request — but "the value is trusted" is exactly the assumption that rots when someone
 * later interpolates a query parameter next to it.
 */
function escapeHtml(value: string): string {
    return value.replace(
        /[&<>"']/g,
        (char) =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? /* c8 ignore next */ char,
    );
}

/**
 * Ant Design's dark tokens, hard-coded.
 *
 * The console is built on antd and reads these from its theme at runtime; this page is
 * plain HTML served before the dashboard shell is allowed through, so it cannot. When
 * `web/src/theme.ts` changes, change these to match.
 *
 * Source: `theme.darkAlgorithm(theme.defaultSeed)`, with colorPrimary overridden to the
 * same brand hue the console sets.
 */
const STYLES = `
  *, *::before, *::after { box-sizing: border-box; }
  :root {
    color-scheme: dark;
    --bg: #000000;              /* colorBgBase */
    --panel: #141414;           /* colorBgContainer */
    --panel-2: #1f1f1f;         /* colorBgElevated */
    --border: #303030;          /* colorBorderSecondary */
    --text: rgba(255,255,255,0.85);   /* colorText */
    --muted: rgba(255,255,255,0.45);  /* colorTextTertiary */
    --accent: #6366f1;          /* colorPrimary — matches web/src/theme.ts */
    --radius: 6px;              /* borderRadius */
    --radius-lg: 8px;           /* borderRadiusLG */
  }
  body {
    margin: 0;
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 24px;
    background: var(--bg);
    color: var(--text);
    font: 14px/1.5714 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue",
          Arial, "Noto Sans", sans-serif;
  }
  main {
    width: 100%;
    max-width: 380px;
    padding: 32px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--panel);
  }
  .brand { font-size: 13px; letter-spacing: .12em; text-transform: uppercase; color: var(--muted); }
  h1 { margin: 6px 0 4px; font-size: 21px; font-weight: 600; letter-spacing: -.01em; }
  p.sub { margin: 0 0 24px; color: var(--muted); font-size: 14px; }
  button {
    width: 100%;
    padding: 7px 15px;
    border: 1px solid #424242;
    border-radius: var(--radius);
    background: transparent;
    color: var(--text);
    font: inherit;
    cursor: pointer;
    transition: background .2s, border-color .2s, color .2s;
  }
  button:hover:not(:disabled) { background: transparent; border-color: var(--accent); color: var(--accent); }
  button:disabled { opacity: .65; cursor: not-allowed; }
  .account { margin: 0 0 20px; padding: 8px 12px; border: 1px solid var(--border); border-radius: var(--radius);
             background: var(--panel-2); font-size: 13px; color: var(--muted); word-break: break-all; }
`;

function page(title: string, body: string, script = ''): string {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)}</title>
<style>${STYLES}</style>
</head>
<body>
<main>${body}</main>
${script ? `<script>${script}</script>` : ''}
</body>
</html>`;
}

/**
 * Shown to a caller holding a valid session that is not an admin — typically a normal app
 * account signed in on the same browser. The way out is to sign out, so that is the only
 * control offered.
 */
export function renderForbiddenPage(email: string): string {
    const body = `
  <p class="brand">${escapeHtml(APP_NAME)}</p>
  <h1>Not an admin account</h1>
  <p class="sub">This console is restricted to administrators.</p>
  <p class="account">Signed in as ${escapeHtml(email)}</p>
  <button type="button" class="secondary" id="signout">Sign out</button>`;

    const script = `
  document.getElementById('signout').addEventListener('click', function () {
    var button = this;
    button.disabled = true;
    button.textContent = 'Signing out\\u2026';
    fetch(${JSON.stringify(SIGN_OUT_ENDPOINT)}, { method: 'POST', credentials: 'same-origin' })
      .then(function () { window.location.assign(${JSON.stringify(ADMIN_LOGIN_PATH)}); })
      .catch(function () { window.location.assign(${JSON.stringify(ADMIN_LOGIN_PATH)}); });
  });`;

    return page(`Access denied — ${APP_NAME}`, body, script);
}
