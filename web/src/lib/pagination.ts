export interface Paginated<T> {
  data: Array<T>
  currentPage: number
  perPage: number
  total: number
  totalPages: number
  from: number
  to: number
  currentTotal: number
}

export const EMPTY_PAGE: Paginated<never> = {
  data: [],
  currentPage: 1,
  perPage: 10,
  total: 0,
  totalPages: 0,
  from: 0,
  to: 0,
  currentTotal: 0,
}
