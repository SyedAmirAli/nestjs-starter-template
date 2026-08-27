/* eslint-disable react-hooks/set-state-in-effect */
import { Fragment, useEffect, useState } from 'react';
import { App, Button, DatePicker, Input, Select, Space, Table, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { MenuProps } from 'antd';
import { DeleteOutlined, EyeOutlined, PlusOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { PageHeader } from '../components/PageHeader';
import { actionsColumn } from '../components/RowActions';
import { isApiError } from '../lib/api';
import { EMPTY_PAGE, type Paginated } from '../lib/pagination';
import { formatDateTime, relativeTime } from '../lib/format';
import {
    AUDIT_ACTIONS,
    AUDIT_RESOURCES,
    bulkDeleteAuditLogs,
    deleteAuditLog,
    listAuditLogs,
    type AuditAction,
    type AuditLog,
} from '../features/audit/api';
import { AuditActionTag, ResourceTag } from '../features/audit/action-tag';
import { AuditDetailDrawer } from '../features/audit/audit-detail-drawer';
import { AuditNoteDrawer } from '../features/audit/audit-note-drawer';
import { PurgeModal } from '../features/audit/purge-modal';

export function AuditPage() {
    const { message, modal } = App.useApp();

    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(20);
    const [search, setSearch] = useState('');
    const [draftSearch, setDraftSearch] = useState('');
    const [action, setAction] = useState<string>('');
    const [resource, setResource] = useState<string>('');
    const [fromDate, setFromDate] = useState<string>('');
    const [toDate, setToDate] = useState<string>('');
    const [result, setResult] = useState<Paginated<AuditLog>>(EMPTY_PAGE);
    const [loading, setLoading] = useState(true);
    const [tick, setTick] = useState(0);
    const [selected, setSelected] = useState<Array<string>>([]);

    const [detail, setDetail] = useState<AuditLog | null>(null);
    const [noteOpen, setNoteOpen] = useState(false);
    const [purgeOpen, setPurgeOpen] = useState(false);

    const reload = () => setTick((n) => n + 1);

    useEffect(() => {
        const ac = new AbortController();
        setLoading(true);
        listAuditLogs(
            { page, limit, search, action, resource, fromDate, toDate, orderBy: 'createdAt', order: 'desc' },
            ac.signal,
        )
            .then((next) => {
                if (!ac.signal.aborted) setResult(next);
            })
            .catch((error: unknown) => {
                if (ac.signal.aborted) return;
                message.error(isApiError(error) ? error.message : 'Could not load audit logs');
            })
            .finally(() => {
                if (!ac.signal.aborted) setLoading(false);
            });
        return () => ac.abort();
    }, [page, limit, search, action, resource, fromDate, toDate, tick, message]);

    const confirmDelete = (row: AuditLog) =>
        modal.confirm({
            title: 'Delete this audit entry?',
            content: 'The trail is append-only history — deleting it cannot be undone.',
            okText: 'Delete',
            okButtonProps: { danger: true },
            onOk: async () => {
                try {
                    await deleteAuditLog(row.id);
                    message.success('Entry deleted');
                    reload();
                } catch (error: unknown) {
                    message.error(isApiError(error) ? error.message : 'Could not delete the entry');
                    throw error;
                }
            },
        });

    const confirmBulk = () =>
        modal.confirm({
            title: `Delete ${selected.length} entries?`,
            content: 'This cannot be undone.',
            okText: 'Delete',
            okButtonProps: { danger: true },
            onOk: async () => {
                try {
                    const result = await bulkDeleteAuditLogs(selected);
                    message.success(`Deleted ${result.data.deleted} of ${result.data.requested} entries`);
                    setSelected([]);
                    reload();
                } catch (error: unknown) {
                    message.error(isApiError(error) ? error.message : 'Bulk delete failed');
                    throw error;
                }
            },
        });

    const columns: ColumnsType<AuditLog> = [
        actionsColumn(
            (row) => row.id,
            (row) => {
                const items: MenuProps['items'] = [
                    { key: 'view', icon: <EyeOutlined />, label: 'View details', onClick: () => setDetail(row) },
                    { type: 'divider' },
                    {
                        key: 'delete',
                        icon: <DeleteOutlined />,
                        label: 'Delete',
                        danger: true,
                        onClick: () => confirmDelete(row),
                    },
                ];
                return items;
            },
        ),
        {
            title: 'Action',
            dataIndex: 'action',
            width: 160,
            render: (value: AuditAction) => <AuditActionTag action={value} />,
        },
        {
            title: 'Resource',
            dataIndex: 'resource',
            render: (value: string) => <ResourceTag resource={value} />,
        },
        {
            title: 'Summary',
            dataIndex: 'summary',
            ellipsis: true,
            render: (summary: string | null) => summary ?? <Typography.Text type="secondary">—</Typography.Text>,
        },
        {
            title: 'Actor',
            dataIndex: 'actorEmail',
            ellipsis: true,
            render: (email: string | null, row) =>
                email ?? row.actorId ?? <Typography.Text type="secondary">System</Typography.Text>,
        },
        {
            title: 'When',
            dataIndex: 'createdAt',
            width: 160,
            render: (at: string) => <Tooltip title={formatDateTime(at)}>{relativeTime(at)}</Tooltip>,
        },
    ];

    return (
        <Fragment>
            <PageHeader
                title="Audit logs"
                description="Human and admin actions across the system. Append-only by design — delete only for retention."
                extra={
                    <>
                        <Button icon={<PlusOutlined />} onClick={() => setNoteOpen(true)}>
                            Add note
                        </Button>
                        <Button danger icon={<ThunderboltOutlined />} onClick={() => setPurgeOpen(true)}>
                            Purge
                        </Button>
                    </>
                }
            />

            <Space wrap className="mb-4">
                <Input.Search
                    allowClear
                    placeholder="Search summary, resource, actor"
                    value={draftSearch}
                    onChange={(e) => setDraftSearch(e.target.value)}
                    onSearch={(value) => {
                        setSearch(value.trim());
                        setPage(1);
                    }}
                    style={{ inlineSize: 280 }}
                />
                <Select
                    allowClear
                    placeholder="Action"
                    value={action || undefined}
                    style={{ inlineSize: 160 }}
                    options={AUDIT_ACTIONS.map((value) => ({ value, label: value }))}
                    onChange={(value) => {
                        setAction(value ?? '');
                        setPage(1);
                    }}
                />
                <Select
                    allowClear
                    showSearch
                    placeholder="Resource"
                    value={resource || undefined}
                    style={{ inlineSize: 180 }}
                    options={AUDIT_RESOURCES.map((value) => ({ value, label: value }))}
                    onChange={(value) => {
                        setResource(value ?? '');
                        setPage(1);
                    }}
                />
                <DatePicker.RangePicker
                    onChange={(_dates, strings) => {
                        const [from, to] = strings;
                        setFromDate(from || '');
                        setToDate(to || '');
                        setPage(1);
                    }}
                />
                {selected.length > 0 && (
                    <Button danger onClick={confirmBulk}>
                        Delete selected ({selected.length})
                    </Button>
                )}
            </Space>

            <Table<AuditLog>
                rowKey="id"
                loading={loading}
                columns={columns}
                dataSource={result.data}
                scroll={{ x: true }}
                rowSelection={{
                    selectedRowKeys: selected,
                    onChange: (keys) => setSelected(keys.map(String)),
                }}
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

            <AuditDetailDrawer row={detail} onClose={() => setDetail(null)} />
            <AuditNoteDrawer open={noteOpen} onClose={() => setNoteOpen(false)} onCreated={reload} />
            <PurgeModal open={purgeOpen} onClose={() => setPurgeOpen(false)} onPurged={reload} />
        </Fragment>
    );
}
