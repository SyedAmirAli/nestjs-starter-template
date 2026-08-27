/* eslint-disable react-hooks/set-state-in-effect */
import { Fragment, useEffect, useMemo, useState } from 'react';
import { App, Button, Input, Space, Table, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { MenuProps } from 'antd';
import { DeleteOutlined, EditOutlined, EyeOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { PageHeader } from '../components/PageHeader';
import { actionsColumn } from '../components/RowActions';
import { isApiError } from '../lib/api';
import { formatBytes } from '../lib/format';
import {
    bulkDeleteCacheEntries,
    deleteCacheEntry,
    fetchRedisStatus,
    listCacheKeys,
    type CacheEntryMeta,
    type RedisStatus,
} from '../features/caches/api';
import { RedisStatusCard } from '../features/caches/redis-status-card';
import { TtlText, TypeTag } from '../features/caches/cache-tags';
import { CacheValueDrawer } from '../features/caches/cache-value-drawer';
import { SetCacheDrawer } from '../features/caches/set-cache-drawer';

export function CachesPage() {
    const { message, modal } = App.useApp();

    const [pattern, setPattern] = useState('*');
    const [draftPattern, setDraftPattern] = useState('*');
    const [filter, setFilter] = useState('');
    const [status, setStatus] = useState<RedisStatus | undefined>();
    const [statusLoading, setStatusLoading] = useState(true);
    const [keys, setKeys] = useState<Array<CacheEntryMeta>>([]);
    const [keysLoading, setKeysLoading] = useState(false);
    const [tick, setTick] = useState(0);
    const [selected, setSelected] = useState<Array<string>>([]);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);

    const [viewing, setViewing] = useState<string | null>(null);
    const [setDrawer, setSetDrawer] = useState<{ key?: string } | null>(null);

    const reload = () => setTick((n) => n + 1);
    const redisUp = !status || status.state === 'up';

    useEffect(() => {
        const ac = new AbortController();
        setStatusLoading(true);
        fetchRedisStatus(ac.signal)
            .then((next) => {
                if (!ac.signal.aborted) setStatus(next);
            })
            .catch((error: unknown) => {
                if (ac.signal.aborted) return;
                message.error(isApiError(error) ? error.message : 'Could not read Redis status');
            })
            .finally(() => {
                if (!ac.signal.aborted) setStatusLoading(false);
            });

        const interval = window.setInterval(
            () => {
                fetchRedisStatus(ac.signal)
                    .then((next) => {
                        if (!ac.signal.aborted) setStatus(next);
                    })
                    .catch(() => undefined);
            },
            status?.state === 'up' ? 30_000 : 5_000,
        );

        return () => {
            ac.abort();
            window.clearInterval(interval);
        };
    }, [tick, message, status?.state]);

    useEffect(() => {
        if (!redisUp) {
            setKeys([]);
            return;
        }
        const ac = new AbortController();
        setKeysLoading(true);
        listCacheKeys(pattern, ac.signal)
            .then((next) => {
                if (!ac.signal.aborted) setKeys(next.data);
            })
            .catch((error: unknown) => {
                if (ac.signal.aborted) return;
                message.error(isApiError(error) ? error.message : 'Could not list cache keys');
            })
            .finally(() => {
                if (!ac.signal.aborted) setKeysLoading(false);
            });
        return () => ac.abort();
    }, [pattern, tick, redisUp, message]);

    const filtered = useMemo(() => {
        const q = filter.trim().toLowerCase();
        if (!q) return keys;
        return keys.filter((row) => row.key.toLowerCase().includes(q) || row.type.toLowerCase().includes(q));
    }, [keys, filter]);

    const paged = useMemo(() => {
        const start = (page - 1) * pageSize;
        return filtered.slice(start, start + pageSize);
    }, [filtered, page, pageSize]);

    const confirmDelete = (row: CacheEntryMeta) =>
        modal.confirm({
            title: 'Delete this key?',
            content: row.key,
            okText: 'Delete',
            okButtonProps: { danger: true },
            onOk: async () => {
                try {
                    await deleteCacheEntry(row.key);
                    message.success('Key deleted');
                    reload();
                } catch (error: unknown) {
                    message.error(isApiError(error) ? error.message : 'Could not delete the key');
                    throw error;
                }
            },
        });

    const confirmBulk = () =>
        modal.confirm({
            title: `Delete ${selected.length} keys?`,
            okText: 'Delete',
            okButtonProps: { danger: true },
            onOk: async () => {
                try {
                    const result = await bulkDeleteCacheEntries(selected);
                    message.success(`Deleted ${result.data.deleted} of ${result.data.requested} keys`);
                    setSelected([]);
                    reload();
                } catch (error: unknown) {
                    message.error(isApiError(error) ? error.message : 'Bulk delete failed');
                    throw error;
                }
            },
        });

    const columns: ColumnsType<CacheEntryMeta> = [
        actionsColumn(
            (row) => row.key,
            (row) => {
                const items: MenuProps['items'] = [
                    { key: 'view', icon: <EyeOutlined />, label: 'View value', onClick: () => setViewing(row.key) },
                    {
                        key: 'edit',
                        icon: <EditOutlined />,
                        label: 'Overwrite',
                        disabled: row.type !== 'string',
                        onClick: () => setSetDrawer({ key: row.key }),
                    },
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
            title: 'Key',
            dataIndex: 'key',
            render: (key: string) => (
                <Typography.Text style={{ fontFamily: 'monospace', fontSize: 12 }} copyable>
                    {key}
                </Typography.Text>
            ),
        },
        {
            title: 'Type',
            dataIndex: 'type',
            width: 110,
            render: (type: CacheEntryMeta['type']) => <TypeTag type={type} />,
        },
        {
            title: 'Size',
            dataIndex: 'size',
            width: 110,
            render: (size: number) => formatBytes(size),
        },
        {
            title: 'Expires',
            key: 'ttl',
            width: 150,
            render: (_, row) => <TtlText duration={row.duration} revalidatesAt={row.revalidatesAt} />,
        },
        {
            title: 'Idle',
            dataIndex: 'idleSeconds',
            width: 120,
            render: (idle: number | null) => (
                <Tooltip title="Seconds since last access — Redis stores no creation time.">
                    {idle == null ? '—' : `${idle}s`}
                </Tooltip>
            ),
        },
    ];

    return (
        <Fragment>
            <PageHeader
                title="Cache management"
                description="Inspect and delete Redis keys, including background-job keys. Redis health is at the top of the page."
                extra={
                    <>
                        <Button icon={<ReloadOutlined />} onClick={reload}>
                            Refresh
                        </Button>
                        <Button
                            type="primary"
                            icon={<PlusOutlined />}
                            disabled={!redisUp}
                            onClick={() => setSetDrawer({})}
                        >
                            Set key
                        </Button>
                    </>
                }
            />

            <RedisStatusCard status={status} loading={statusLoading} onChanged={reload} />

            <Space wrap className="mb-4">
                <Input.Search
                    allowClear
                    placeholder="SCAN pattern, e.g. session:*"
                    value={draftPattern}
                    onChange={(e) => setDraftPattern(e.target.value)}
                    onSearch={(value) => {
                        setPattern(value.trim() || '*');
                        setPage(1);
                    }}
                    style={{ inlineSize: 280 }}
                    enterButton="Scan"
                />
                <Input.Search
                    allowClear
                    placeholder="Filter listed keys"
                    value={filter}
                    onChange={(e) => {
                        setFilter(e.target.value);
                        setPage(1);
                    }}
                    style={{ inlineSize: 220 }}
                />
                {selected.length > 0 && (
                    <Button danger onClick={confirmBulk}>
                        Delete selected ({selected.length})
                    </Button>
                )}
            </Space>

            <Table<CacheEntryMeta>
                rowKey="key"
                loading={keysLoading}
                columns={columns}
                dataSource={paged}
                scroll={{ x: true }}
                rowSelection={{
                    selectedRowKeys: selected,
                    onChange: (keys) => setSelected(keys.map(String)),
                }}
                pagination={{
                    current: page,
                    pageSize,
                    total: filtered.length,
                    showSizeChanger: true,
                    onChange: (next, size) => {
                        setPage(next);
                        setPageSize(size);
                    },
                }}
            />

            <CacheValueDrawer cacheKey={viewing} onClose={() => setViewing(null)} />
            <SetCacheDrawer
                open={!!setDrawer}
                initialKey={setDrawer?.key}
                onClose={() => setSetDrawer(null)}
                onSaved={reload}
            />
        </Fragment>
    );
}
