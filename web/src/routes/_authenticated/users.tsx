import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { UsersPage } from '../../pages/UsersPage';
import { validateListSearch, makeSearchPatcher, type ListSearch } from '../../lib/listQuery';
import { USER_ROLES, type UserRole } from '../../features/users/api';

/** Generic list state (page/limit/sort/search/active) plus this route's own `role` filter. */
export type UsersSearch = ListSearch & { role?: UserRole };

function validateUsersSearch(search: Record<string, unknown>): UsersSearch {
    const base = validateListSearch(search);
    const role = USER_ROLES.find((r) => r === search.role);
    return role ? { ...base, role } : base;
}

export const Route = createFileRoute('/_authenticated/users')({
    validateSearch: validateUsersSearch,
    component: RouteComponent,
});

function RouteComponent() {
    const search = Route.useSearch();
    const onSearchChange = makeSearchPatcher(useNavigate({ from: Route.fullPath }));
    return <UsersPage search={search} onSearchChange={onSearchChange} />;
}
