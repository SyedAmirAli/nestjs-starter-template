import { createFileRoute, redirect } from '@tanstack/react-router';
import { AppShell } from '../components/AppShell';
import { fetchCurrentUser } from '../lib/session';
import { RoutePending } from '../components/RoutePending';

export const Route = createFileRoute('/_authenticated')({
    beforeLoad: async ({ location }) => {
        const user = await fetchCurrentUser();
        if (!user || user.role !== 'ADMIN') {
            const path = location.pathname.replace(/^\/admin/, '') || '/';
            throw redirect({
                to: '/login',
                search: {
                    redirect: path === '/' ? undefined : `${path}${location.searchStr}`,
                },
            });
        }
        return { user };
    },
    component: AppShell,
    pendingComponent: RoutePending,
});
