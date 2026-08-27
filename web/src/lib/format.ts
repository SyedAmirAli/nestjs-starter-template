export function formatBytes(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = n / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i += 1
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString()
}

function unitsAgo(ms: number): string {
  const min = 60_000
  const hour = 60 * min
  const day = 24 * hour
  const abs = Math.abs(ms)
  if (abs < min) return 'just now'
  if (abs < hour) return `${Math.round(abs / min)}m`
  if (abs < day) return `${Math.round(abs / hour)}h`
  return `${Math.round(abs / day)}d`
}

/** Past timestamps: "3h ago". Future timestamps (TTLs): "in 12m". */
export function relativeTime(iso: string): string {
  const delta = Date.now() - new Date(iso).getTime()
  const label = unitsAgo(delta)
  if (label === 'just now') return label
  return delta >= 0 ? `${label} ago` : `in ${label}`
}

export function formatUptime(seconds: number | null | undefined): string {
  if (seconds == null) return '—'
  const d = Math.floor(seconds / 86_400)
  const h = Math.floor((seconds % 86_400) / 3_600)
  const m = Math.floor((seconds % 3_600) / 60)
  if (d) return `${d}d ${h}h ${m}m`
  if (h) return `${h}h ${m}m`
  return `${m}m`
}
