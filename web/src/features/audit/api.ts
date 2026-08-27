import { apiFetch, apiMutate, toQuery } from '../../lib/api'
import type { Paginated } from '../../lib/pagination'

export const AUDIT_ACTIONS = [
  'CREATE',
  'UPDATE',
  'DELETE',
  'STATUS_CHANGE',
  'LOGIN',
  'LOGOUT',
  'EXPORT',
  'PURGE',
  'OTHER',
] as const
export type AuditAction = (typeof AUDIT_ACTIONS)[number]

export const AUDIT_RESOURCES = [
  'auth',
  'user',
  'profile',
  'resume',
  'jobPost',
  'application',
  'file',
  'backup',
  'dataExport',
  'integration',
  'cache',
  'auditLog',
  'system',
] as const

export interface AuditLog {
  id: string
  actorId: string | null
  actorEmail: string | null
  action: AuditAction
  resource: string
  resourceId: string | null
  summary: string | null
  beforeJson: unknown
  afterJson: unknown
  metaJson: Record<string, unknown> | null
  ip: string | null
  userAgent: string | null
  createdAt: string
}

export interface AuditListQuery {
  page?: number
  limit?: number
  search?: string
  action?: string
  resource?: string
  userId?: string
  resourceId?: string
  fromDate?: string
  toDate?: string
  orderBy?: string
  order?: 'asc' | 'desc'
}

const BASE = '/admin/audit'

export function listAuditLogs(query: AuditListQuery, signal?: AbortSignal) {
  return apiFetch<Paginated<AuditLog>>(`${BASE}${toQuery({ ...query })}`, { signal })
}

export async function getAuditLog(id: string, signal?: AbortSignal) {
  const body = await apiFetch<{ data: AuditLog }>(`${BASE}/${id}`, { signal })
  return body.data
}

export function createAuditLog(input: {
  action: AuditAction
  resource: string
  resourceId?: string | null
  summary?: string | null
  meta?: Record<string, unknown>
}) {
  return apiMutate<AuditLog>(BASE, { method: 'POST', body: JSON.stringify(input) })
}

export function deleteAuditLog(id: string) {
  return apiMutate<null>(`${BASE}/${id}`, { method: 'DELETE' })
}

export function bulkDeleteAuditLogs(ids: Array<string>) {
  return apiMutate<{ requested: number; deleted: number }>(`${BASE}/bulk-delete`, {
    method: 'POST',
    body: JSON.stringify({ ids }),
  })
}

export function purgeAuditLogs(input: { before: string; limit?: number }) {
  return apiMutate<{ deleted: number; before: string; cappedAt?: number }>(`${BASE}/purge`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}
