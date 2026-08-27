/* eslint-disable react-hooks/set-state-in-effect */
import { Fragment, useEffect, useState } from 'react';
import { App, Input, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { MenuProps } from 'antd';
import { UndoOutlined, WarningOutlined } from '@ant-design/icons';
import { getRouteApi } from '@tanstack/react-router';
import { PageHeader } from '../components/PageHeader';
import { AvatarCell } from '../components/AvatarCell';
import { actionsColumn } from '../components/RowActions';
import { isApiError } from '../lib/api';
import { EMPTY_PAGE, type Paginated } from '../lib/pagination';
import { formatDateTime, relativeTime } from '../lib/format';
import {
    listDeletedUsers,
    permanentDeleteUser,
    restoreUser,
    type AdminUser,
    type UserRole,
} from '../features/users/api';

const authRoute = getRouteApi('/_authenticated');

export function AccountDeletePage() {
    const { user: currentAdmin } = authRoute.useRouteContext();
    const { message, modal } = App.useApp();

    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(10);
    const [search, setSearch] = useState('');
    const [draftSearch, setDraftSearch] = useState('');
    const [result, setResult] = useState<Paginated<AdminUser>>(EMPTY_PAGE);
    const [loading, setLoading] = useState(true);
    const [tick, setTick] = useState(0);

    const reload = () => setTick((n) => n + 1);

    useEffect(() => {
        const ac = new AbortController();
        setLoading(true);
        listDeletedUsers({ page, limit, search, orderBy: 'deletedAt', order: 'desc' }, ac.signal)
            .then((next) => {
                if (!ac.signal.aborted) setResult(next);
            })
            .catch((error: unknown) => {
                if (ac.signal.aborted) return;
                message.error(isApiError(error) ? error.message : 'Could not load deleted accounts');
            })
            .finally(() => {
                if (!ac.signal.aborted) setLoading(false);
            });
        return () => ac.abort();
    }, [page, limit, search, tick, message]);

    const confirmRestore = (row: AdminUser) =>
        modal.confirm({
            title: 'Restore this account?',
            content: (
                <>
                    <Typography.Paragraph>
                        <b>{row.name}</b> — <Typography.Text code>{row.email}</Typography.Text>
                    </Typography.Paragraph>
                    <Typography.Text type="secondary">
                        The user is marked active again and can sign in. Sessions that were purged stay gone.
                    </Typography.Text>
                </>
            ),
            okText: 'Restore',
            onOk: async () => {
                try {
                    await restoreUser(row.id);
                    message.success('Account restored');
                    reload();
                } catch (error: unknown) {
                    message.error(isApiError(error) ? error.message : 'Could not restore the account');
                    throw error;
                }
            },
        });

    const confirmPurge = (row: AdminUser) =>
        modal.confirm({
            title: 'Permanently delete this account?',
            icon: <WarningOutlined />,
            content: (
                <>
                    <Typography.Paragraph>
                        <b>{row.name}</b> — <Typography.Text code>{row.email}</Typography.Text>
                    </Typography.Paragraph>
                    <Typography.Text type="secondary">
                        Hard-deletes the user and related records. A JSON snapshot is written to the audit log first.
                        Restricted to protected system administrators.
                    </Typography.Text>
                </>
            ),
            okText: 'Permanently delete',
            okButtonProps: { danger: true },
            onOk: async () => {
                try {
                    await permanentDeleteUser(row.id);
                    message.success('Account permanently deleted');
                    reload();
                } catch (error: unknown) {
                    message.error(isApiError(error) ? error.message : 'Could not purge the account');
                    throw error;
                }
            },
        });

    const rowActions = (row: AdminUser): MenuProps['items'] => [
        { key: 'restore', icon: <UndoOutlined />, label: 'Restore', onClick: () => confirmRestore(row) },
        {
            key: 'purge',
            icon: <WarningOutlined />,
            label: 'Permanently delete',
            danger: true,
            disabled: !currentAdmin.isSuperAdmin,
            onClick: () => confirmPurge(row),
        },
    ];

    const columns: ColumnsType<AdminUser> = [
        actionsColumn((row) => row.id, rowActions),
        {
            title: 'Name',
            dataIndex: 'name',
            ellipsis: true,
            render: (name: string, row) => <AvatarCell name={name} image={row.image} secondary={row.email} />,
        },
        {
            title: 'Role',
            dataIndex: 'role',
            width: 110,
            render: (value: UserRole) => <Tag>{value}</Tag>,
        },
        {
            title: 'Deleted',
            dataIndex: 'deletedAt',
            width: 180,
            render: (at: string | null) =>
                at ? (
                    <Typography.Text title={formatDateTime(at)} type="secondary">
                        {relativeTime(at)}
                    </Typography.Text>
                ) : (
                    '—'
                ),
        },
    ];

    return (
        <Fragment>
            <PageHeader
                title="Account delete"
                description="Soft-deleted accounts. Restore them, or permanently purge (super-admin only)."
            />

            <Space wrap className="mb-4">
                <Input.Search
                    allowClear
                    placeholder="Search name or email"
                    value={draftSearch}
                    onChange={(e) => setDraftSearch(e.target.value)}
                    onSearch={(value) => {
                        setSearch(value.trim());
                        setPage(1);
                    }}
                    style={{ inlineSize: 260 }}
                />
            </Space>

            <Table<AdminUser>
                rowKey="id"
                loading={loading}
                columns={columns}
                dataSource={result.data}
                scroll={{ x: true }}
                pagination={{
                    current: result.currentPage,
                    pageSize: result.perPage,
                    total: result.total,
                    showSizeChanger: true,
                    onChange: (next, size) => {
                        setPage(next);
                        setLimit(size);
                    },
                }}
            />
        </Fragment>
    );
}
