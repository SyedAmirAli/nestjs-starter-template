import { Outlet, createRootRoute } from '@tanstack/react-router';
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools';
import { NotFoundPage } from '../pages/NotFoundPage';
import { RoutePending } from '../components/RoutePending';
import { Fragment } from 'react';

export const Route = createRootRoute({
    component: RootLayout,
    notFoundComponent: NotFoundPage,
    pendingComponent: RoutePending,
});

function RootLayout() {
    return (
        <Fragment>
            <Outlet />
            {import.meta.env.DEV ? <TanStackRouterDevtools position="bottom-right" /> : null}
        </Fragment>
    );
}
