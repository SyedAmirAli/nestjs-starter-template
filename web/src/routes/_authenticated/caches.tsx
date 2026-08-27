import { createFileRoute } from '@tanstack/react-router'
import { CachesPage } from '../../pages/CachesPage'

export const Route = createFileRoute('/_authenticated/caches')({
  component: CachesPage,
})
