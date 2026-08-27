/* eslint-disable react-hooks/set-state-in-effect */
import { Fragment, useEffect, useState } from 'react';
import { App, Button, Select, Space, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { MenuProps } from 'antd';
import { DeleteOutlined, EditOutlined, KeyOutlined, PlusOutlined } from '@ant-design/icons';
import { getRouteApi } from '@tanstack/react-router';
import { PageHeader } from '../components/PageHeader';
import { AvatarCell } from '../components/AvatarCell';
import { actionsColumn } from '../components/RowActions';
import { activeColumn } from '../components/ActiveColumn';
import { ListTable } from '../components/ListTable';
import type { UsersSearch } from '../routes/_authenticated/users';
import { isApiError } from '../lib/api';
import { EMPTY_PAGE, type Paginated } from '../lib/pagination';
import { formatDateTime, relativeTime } from '../lib/format';
import { USER_ROLES, deleteUser, listUsers, setUserActive, type AdminUser, type UserRole } from '../features/users/api';
import { UserFormDrawer } from '../features/users/user-form-drawer';
import { ChangePasswordDrawer } from '../features/users/change-password-drawer';

const authRoute = getRouteApi('/_authenticated');

/**
 * The house list-page pattern: `ListTable` (pagination, column toggle, search, sort, footer)
 * driven entirely by the route's URL search params — see `routes/_authenticated/users.tsx` for
 * the `validateSearch` + `makeSearchPatcher` wiring. Every other list page in the console should
 * follow this same shape; see AGENTS.md.
 */
export function UsersPage({
    search,
    onSearchChange,
}: {
    search: UsersSearch;
    onSearchChange: (next: Partial<UsersSearch>) => void;
}) {
    const { user: currentAdmin } = authRoute.useRouteContext();
    const { message, modal } = App.useApp();

    const [result, setResult] = useState<Paginated<AdminUser>>(EMPTY_PAGE);
    const [loading, setLoading] = useState(true);
    const [tick, setTick] = useState(0);
    const [togglingId, setTogglingId] = useState<string | null>(null);

    const [drawer, setDrawer] = useState<{ mode: 'create' } | { mode: 'edit'; row: AdminUser } | null>(null);
    const [pwUser, setPwUser] = useState<AdminUser | null>(null);

    const reload = () => setTick((n) => n + 1);

    useEffect(() => {
        const ac = new AbortController();
        setLoading(true);
        listUsers(
            {
                page: search.page,
                limit: search.limit,
                search: search.search,
                role: search.role,
                active: search.active,
                orderBy: search.orderBy,
                order: search.order,
            },
            ac.signal,
        )
            .then((next) => {
                if (!ac.signal.aborted) setResult(next);
            })
            .catch((error: unknown) => {
                if (ac.signal.aborted) return;
                message.error(isApiError(error) ? error.message : 'Could not load users');
            })
            .finally(() => {
                if (!ac.signal.aborted) setLoading(false);
            });
        return () => ac.abort();
    }, [
        search.page,
        search.limit,
        search.search,
        search.role,
        search.active,
        search.orderBy,
        search.order,
        tick,
        message,
    ]);

    const confirmSoftDelete = (row: AdminUser) =>
        modal.confirm({
            title: 'Delete this user?',
            content: (
                <>
                    <Typography.Paragraph>
                        <b>{row.name}</b> — <Typography.Text code>{row.email}</Typography.Text>
                    </Typography.Paragraph>
                    <Typography.Text type="secondary">
                        Soft delete — the account is hidden and signed out, but can be restored from Account delete.
                    </Typography.Text>
                </>
            ),
            okText: 'Delete',
            okButtonProps: { danger: true },
            onOk: async () => {
                try {
                    await deleteUser(row.id);
                    message.success('User deleted');
                    reload();
                } catch (error: unknown) {
                    message.error(isApiError(error) ? error.message : 'Could not delete the user');
                    throw error;
                }
            },
        });

    const toggleActive = (row: AdminUser) => {
        setTogglingId(row.id);
        setUserActive(row.id, !row.isActive)
            .then(() => {
                message.success(`${row.name} ${row.isActive ? 'deactivated' : 'activated'}`);
                reload();
            })
            .catch((error: unknown) => {
                message.error(isApiError(error) ? error.message : 'Could not update status');
            })
            .finally(() => setTogglingId(null));
    };

    const rowActions = (row: AdminUser): MenuProps['items'] => {
        const isSelf = row.id === currentAdmin.id;
        return [
            { key: 'edit', icon: <EditOutlined />, label: 'Edit', onClick: () => setDrawer({ mode: 'edit', row }) },
            {
                key: 'password',
                icon: <KeyOutlined />,
                label: 'Reset password',
                disabled: !currentAdmin.isSuperAdmin,
                onClick: () => setPwUser(row),
            },
            { type: 'divider' },
            {
                key: 'delete',
                icon: <DeleteOutlined />,
                label: 'Delete',
                danger: true,
                disabled: isSelf,
                onClick: () => confirmSoftDelete(row),
            },
        ];
    };

    const columns: ColumnsType<AdminUser> = [
        actionsColumn((row) => row.id, rowActions),
        {
            title: 'Name',
            dataIndex: 'name',
            ellipsis: true,
            render: (name: string, row) => (
                <AvatarCell
                    name={name}
                    image={row.image}
                    secondary={
                        <Space size={4} wrap>
                            <span>{row.email}</span>
                            {row.id === currentAdmin.id && <Tag color="blue">you</Tag>}
                        </Space>
                    }
                />
            ),
        },
        {
            title: 'Role',
            dataIndex: 'role',
            width: 110,
            render: (value: UserRole) => <Tag color={value === 'ADMIN' ? 'purple' : 'default'}>{value}</Tag>,
        },
        {
            title: 'Sessions',
            key: 'sessions',
            width: 100,
            render: (_, row) => row._count?.sessions ?? '—',
        },
        activeColumn<AdminUser>({
            getActive: (row) => row.isActive,
            onToggle: toggleActive,
            getId: (row) => row.id,
            pendingId: togglingId,
        }),
        {
            title: 'Created',
            dataIndex: 'createdAt',
            key: 'createdAt',
            width: 160,
            sorter: true,
            render: (at: string) => (
                <Typography.Text title={formatDateTime(at)} type="secondary">
                    {relativeTime(at)}
                </Typography.Text>
            ),
        },
    ];

    return (
        <Fragment>
            <PageHeader
                title="Users"
                description="Create, edit, activate, and soft-delete accounts. Permanent purge lives under Account delete."
            />

            <ListTable<AdminUser>
                rowKey="id"
                columns={columns}
                rows={result.data}
                total={result.total}
                currentPage={result.currentPage}
                perPage={result.perPage}
                search={search}
                onSearchChange={onSearchChange}
                loading={loading}
                searchPlaceholder="Search name or email"
                filters={
                    <>
                        <Select
                            allowClear
                            placeholder="Role"
                            value={search.role}
                            style={{ minInlineSize: 140 }}
                            options={USER_ROLES.map((value) => ({ value, label: value }))}
                            onChange={(value) => onSearchChange({ role: value, page: undefined })}
                        />
                        <Select
                            allowClear
                            placeholder="All statuses"
                            value={search.active}
                            style={{ minInlineSize: 140 }}
                            options={[
                                { value: true, label: 'Active only' },
                                { value: false, label: 'Inactive only' },
                            ]}
                            onChange={(value) => onSearchChange({ active: value, page: undefined })}
                        />
                    </>
                }
                primaryAction={
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => setDrawer({ mode: 'create' })}>
                        Create user
                    </Button>
                }
                onRowClick={(row) => setDrawer({ mode: 'edit', row })}
            />

            <UserFormDrawer
                open={!!drawer}
                mode={drawer?.mode ?? 'create'}
                user={drawer?.mode === 'edit' ? drawer.row : undefined}
                onClose={() => setDrawer(null)}
                onSaved={reload}
            />
            <ChangePasswordDrawer open={!!pwUser} user={pwUser} onClose={() => setPwUser(null)} />
        </Fragment>
    );
}
