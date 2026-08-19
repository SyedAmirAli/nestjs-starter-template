/**
 * Client for the versioned API.
 *
 * There is no base URL to configure and no token to attach. The console is served by the API
 * process itself, so `/v1/...` is same-origin and the Better Auth session cookie rides along
 * on its own — which is exactly why the console is co-hosted rather than deployed separately.
 */

/** Matches the server's global prefix. See src/main.ts and src/web/reserved-paths.ts. */
const API_PREFIX = '/v1'

/** The error envelope every failing endpoint returns (src/common/errors/api-error.types.ts). */
interface ApiErrorBody {
  message?: string
  code?: string | null
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string | null

  constructor(message: string, status: number, code: string | null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

/**
 * A 401 means the session died mid-visit — expired, revoked, or signed out in another tab.
 * The sign-in form lives on the server side of the admin gate, not in this bundle, so the
 * only way back to it is a full reload.
 *
 * Rate-limited because a 401 that survives the reload (a bug, or an admin whose role was
 * revoked while the cookie stayed valid) would otherwise spin the browser indefinitely.
 */
const RELOAD_COOLDOWN_MS = 10_000
const RELOAD_KEY = 'glowquest:gate-reload-at'

function reloadIntoGate(): void {
  const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0)
  if (Date.now() - last < RELOAD_COOLDOWN_MS) return

  sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
  window.location.reload()
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_PREFIX}${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: { accept: 'application/json', ...init?.headers },
  })

  if (response.status === 401) {
    reloadIntoGate()
    throw new ApiError('Your session has expired.', 401, 'UNAUTHENTICATED')
  }

  // 204, and any response that simply has no body to read.
  const text = await response.text()
  const body: unknown = text ? JSON.parse(text) : null

  if (!response.ok) {
    const { message, code } = (body ?? {}) as ApiErrorBody
    throw new ApiError(message ?? `Request failed (${response.status})`, response.status, code ?? null)
  }

  return body as T
}

/**
 * The liveness probe, which sits outside the version prefix so orchestrators need not track
 * API versions — hence the bare fetch rather than `apiFetch`.
 */
export async function fetchHealth(): Promise<{ status: string; name: string; env: string; at: string }> {
  const response = await fetch('/health', { headers: { accept: 'application/json' } })
  if (!response.ok) throw new ApiError(`Health check failed (${response.status})`, response.status, null)

  return response.json() as Promise<{ status: string; name: string; env: string; at: string }>
}
