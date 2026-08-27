import { apiFetch, apiMutate, toQuery } from '../../lib/api'
import type { Paginated } from '../../lib/pagination'

export const USER_ROLES = ['USER', 'ADMIN'] as const
export type UserRole = (typeof USER_ROLES)[number]

export interface AdminUser {
  id: string
  name: string
  email: string
  emailVerified: boolean
  image: string | null
  isActive: boolean
  role: UserRole
  deletedAt: string | null
  createdAt: string
  updatedAt: string
  _count?: { sessions: number }
}

export interface UserListQuery {
  page?: number
  limit?: number
  search?: string
  role?: UserRole | ''
  active?: boolean | ''
  orderBy?: string
  order?: 'asc' | 'desc'
}

const BASE = '/admin/users'

export function listUsers(query: UserListQuery, signal?: AbortSignal) {
  return apiFetch<Paginated<AdminUser>>(
    `${BASE}${toQuery({
      page: query.page ?? 1,
      limit: query.limit ?? 10,
      search: query.search,
      role: query.role || undefined,
      active: query.active === '' || query.active === undefined ? undefined : query.active,
      orderBy: query.orderBy,
      order: query.order,
    })}`,
    { signal },
  )
}

export function listDeletedUsers(query: UserListQuery, signal?: AbortSignal) {
  return apiFetch<Paginated<AdminUser>>(
    `${BASE}/deleted${toQuery({
      page: query.page ?? 1,
      limit: query.limit ?? 10,
      search: query.search,
      orderBy: query.orderBy ?? 'deletedAt',
      order: query.order,
    })}`,
    { signal },
  )
}

export function createUser(input: { email: string; name: string; password: string; role?: UserRole }) {
  return apiMutate<AdminUser>(BASE, { method: 'POST', body: JSON.stringify(input) })
}

export function updateUser(id: string, input: { name?: string; role?: UserRole }) {
  return apiMutate<AdminUser>(`${BASE}/${id}`, { method: 'PUT', body: JSON.stringify(input) })
}

export function setUserActive(id: string, isActive?: boolean) {
  return apiMutate<{ id: string; isActive: boolean }>(`${BASE}/${id}/active`, {
    method: 'PATCH',
    body: JSON.stringify(isActive === undefined ? {} : { isActive }),
  })
}

export function resetUserPassword(id: string, password: string) {
  return apiMutate<{ id: string }>(`${BASE}/${id}/password`, {
    method: 'POST',
    body: JSON.stringify({ password }),
  })
}

export function deleteUser(id: string) {
  return apiMutate<{ id: string; deleted: boolean }>(`${BASE}/${id}`, { method: 'DELETE' })
}

export function restoreUser(id: string) {
  return apiMutate<{ id: string; restored: boolean }>(`${BASE}/${id}/restore`, { method: 'POST' })
}

export function permanentDeleteUser(id: string) {
  return apiMutate<{ id: string; purged: boolean }>(`${BASE}/${id}/permanent`, { method: 'DELETE' })
}
