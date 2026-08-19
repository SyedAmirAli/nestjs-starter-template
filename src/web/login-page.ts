import { APP_NAME } from '@/config/dotenv';

/**
 * The two pages the admin gate serves to callers it turns away.
 *
 * These are hand-written HTML rather than routes in the React console, and that is forced by
 * the gate's own rule: the console bundle is never served to a non-admin, so a sign-in screen
 * living inside it could never be reached by the only people who need it. They are also the
 * one surface that must render when the console is broken — an unbuilt `web/dist`, a Vite dev
 * server that is not running — so they carry no build step, no assets, and no dependencies.
 *
 * Keep them small and keep them boring.
 */

/** Better Auth's email/password endpoint. Outside `/v1`; see reserved-paths.ts. */
const SIGN_IN_ENDPOINT = '/api/auth/sign-in/email';
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
 * plain HTML served before any bundle is allowed through, so it cannot. The seam between
 * the two is a full page load, and a mismatch here reads as landing on a different site —
 * so when `web/src/theme.ts` changes, change these to match.
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
    --danger: #dc4446;          /* colorError */
    --danger-bg: #2c1618;       /* colorErrorBg */
    --danger-border: #5b2526;   /* colorErrorBorder */
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
  label { display: block; margin-bottom: 6px; font-size: 13px; font-weight: 500; color: var(--muted); }
  input {
    width: 100%;
    padding: 7px 11px;
    margin-bottom: 16px;
    border: 1px solid #424242;   /* colorBorder */
    border-radius: var(--radius);
    background: transparent;
    color: var(--text);
    font: inherit;
    transition: border-color .2s, box-shadow .2s;
  }
  input:hover { border-color: var(--accent); }
  input:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 2px rgb(99 102 241 / 0.15);
  }
  button {
    width: 100%;
    padding: 7px 15px;
    border: 1px solid var(--accent);
    border-radius: var(--radius);
    background: var(--accent);
    color: #fff;
    font: inherit;
    cursor: pointer;
    transition: background .2s, border-color .2s;
  }
  button:hover:not(:disabled) { background: #7c7ef4; border-color: #7c7ef4; }
  button:disabled { opacity: .65; cursor: not-allowed; }
  button.secondary {
    background: transparent;
    border-color: #424242;
    color: var(--text);
  }
  button.secondary:hover:not(:disabled) { background: transparent; border-color: var(--accent); color: var(--accent); }
  .error {
    display: none;
    margin: 0 0 16px;
    padding: 8px 12px;
    border: 1px solid var(--danger-border);
    border-radius: var(--radius);
    background: var(--danger-bg);
    color: var(--text);
    font-size: 14px;
  }
  .error[data-visible="true"] { display: block; }
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

/** Shown to an anonymous visitor. Signs in against Better Auth, then reloads into the console. */
export function renderSignInPage(): string {
    const body = `
  <p class="brand">${escapeHtml(APP_NAME)}</p>
  <h1>Admin console</h1>
  <p class="sub">Sign in with an administrator account.</p>
  <p class="error" id="error" role="alert"></p>
  <form id="form" novalidate>
    <label for="email">Email</label>
    <input id="email" name="email" type="email" autocomplete="username" required autofocus>
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required>
    <button type="submit" id="submit">Sign in</button>
  </form>`;

    // A plain fetch rather than a native form POST: Better Auth answers JSON, and a native
    // submit would navigate the browser to that JSON instead of returning to the console.
    const script = `
  (function () {
    var form = document.getElementById('form');
    var button = document.getElementById('submit');
    var error = document.getElementById('error');

    function fail(message) {
      error.textContent = message;
      error.dataset.visible = 'true';
      button.disabled = false;
      button.textContent = 'Sign in';
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      error.dataset.visible = 'false';
      button.disabled = true;
      button.textContent = 'Signing in\\u2026';

      fetch(${JSON.stringify(SIGN_IN_ENDPOINT)}, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          email: document.getElementById('email').value.trim(),
          password: document.getElementById('password').value,
          rememberMe: true
        })
      }).then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (body) {
          if (!response.ok) throw new Error(body.message || 'Sign-in failed (' + response.status + ')');
          // Full reload, not a redirect: the gate must re-run and serve the console itself.
          window.location.reload();
        });
      }).catch(function (e) {
        fail(e.message || 'Sign-in failed. Check your connection and try again.');
      });
    });
  })();`;

    return page(`Sign in — ${APP_NAME}`, body, script);
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
      .then(function () { window.location.reload(); })
      .catch(function () { window.location.reload(); });
  });`;

    return page(`Access denied — ${APP_NAME}`, body, script);
}
