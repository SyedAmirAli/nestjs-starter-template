import { createFileRoute, redirect } from '@tanstack/react-router';
import { fetchCurrentUser } from '../lib/session';
import { dashboardPathFromRedirect } from '../lib/paths';
import { LoginPage } from '../pages/LoginPage';
import { RoutePending } from '../components/RoutePending';

export const Route = createFileRoute('/login')({
    validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
        redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
    }),
    beforeLoad: async ({ search }) => {
        const user = await fetchCurrentUser();
        if (user?.role === 'ADMIN') {
            throw redirect({ to: dashboardPathFromRedirect(search.redirect) });
        }
        return { user };
    },
    component: LoginPage,
    pendingComponent: RoutePending,
});
