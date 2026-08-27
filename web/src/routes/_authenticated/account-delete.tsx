import { createFileRoute } from '@tanstack/react-router'
import { AccountDeletePage } from '../../pages/AccountDeletePage'

export const Route = createFileRoute('/_authenticated/account-delete')({
  component: AccountDeletePage,
})
