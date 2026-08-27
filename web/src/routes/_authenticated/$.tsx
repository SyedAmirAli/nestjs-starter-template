import { createFileRoute } from '@tanstack/react-router'
import { NotFoundPage } from '../../pages/NotFoundPage'

export const Route = createFileRoute('/_authenticated/$')({
  component: NotFoundPage,
})
