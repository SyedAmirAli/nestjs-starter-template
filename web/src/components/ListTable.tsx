import { useMemo, useState, type Key, type ReactNode } from 'react';
import {
    Button,
    Checkbox,
    Dropdown,
    Flex,
    Input,
    Pagination,
    Select,
    Space,
    Table,
    Tooltip,
    Typography,
    theme,
} from 'antd';
import type { ColumnsType, ColumnType } from 'antd/es/table';
import type { SorterResult } from 'antd/es/table/interface';
import type { MenuProps } from 'antd';
import { SearchOutlined, SettingOutlined } from '@ant-design/icons';
import { listDefaults, type ListSearch } from '../lib/listQuery';
import { EllipsisText } from './EllipsisText';

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

/**
 * Plain string/number cells get single-line ellipsis + full-value tooltip.
 * Custom renders (Switch, Tag, Avatar, …) are left alone — those pages own the cell UI.
 */
function withEllipsisText<T>(col: ColumnType<T>): ColumnType<T> {
    const prevRender = col.render;
    return {
        ...col,
        // Handled by EllipsisText when the cell value is plain text.
        ellipsis: false,
        render: (value, record, index) => {
            const content = prevRender ? prevRender(value, record, index) : value;
            if (typeof content === 'string' || typeof content === 'number') {
                return <EllipsisText>{content}</EllipsisText>;
            }
            return content as ReactNode;
        },
    };
}

export interface ListTableProps<T> {
    /** Row identity — a key on T, or a function. */
    rowKey: keyof T | ((row: T) => string);
    /**
     * Include the `⋮` row-actions column yourself (see `actionsColumn` in `RowActions.tsx`) as
     * the first entry — ListTable doesn't own row actions, it just renders whatever columns
     * you give it.
     */
    columns: ColumnsType<T>;
    rows: Array<T>;
    /** Server pagination envelope values. */
    total: number;
    currentPage: number;
    perPage: number;
    /** Current URL- (or state-) driven search (for sort/search echo). */
    search: ListSearch;
    /** Patch the search — the caller owns where it's stored (URL, useState, …). */
    onSearchChange: (next: Partial<ListSearch>) => void;
    loading?: boolean;
    /** Placeholder naming the searchable fields. */
    searchPlaceholder?: string;
    /** Bulk-selection bar content; receives selected rows. Enables checkboxes when set. */
    bulkBar?: (selected: Array<T>, clear: () => void) => ReactNode;
    /** Primary top-right action, e.g. a Create button. */
    primaryAction?: ReactNode;
    /** Extra header filter controls (Select dropdowns mapped to whitelisted params). */
    filters?: ReactNode;
    onRowClick?: (row: T) => void;
}

/**
 * The one list-table every admin module uses. Bundles the house standard so no page hand-rolls
 * it again: bulk select, a column show/hide toggle, a page-size control, an explicit search
 * button, sortable headers, and a verbose "N entries (Showing X items on page Y of total Z
 * pages)" footer with pagination.
 *
 * State is caller-driven — this component never owns page/sort/filter itself; it calls
 * `onSearchChange` and expects fresh `rows`/`total` back. Drive it from a URL search
 * (`../lib/listQuery`) for server-paginated routes, or from `useClientList` for an
 * already-in-memory array.
 */
export function ListTable<T extends object>({
    rowKey,
    columns,
    rows,
    total,
    currentPage,
    perPage,
    search,
    onSearchChange,
    loading,
    searchPlaceholder = 'Search…',
    bulkBar,
    primaryAction,
    filters,
    onRowClick,
}: ListTableProps<T>) {
    const { token } = theme.useToken();
    const applied = listDefaults(search);

    const keyOf = (row: T): string => (typeof rowKey === 'function' ? rowKey(row) : String(row[rowKey]));

    // ---- local UI state ----
    const [draftSearch, setDraftSearch] = useState(search.search ?? '');
    const [selectedKeys, setSelectedKeys] = useState<Array<Key>>([]);
    const [hidden, setHidden] = useState<Set<string>>(new Set());

    const columnKey = (c: ColumnType<T>, i: number): string =>
        String(c.key ?? (typeof c.dataIndex === 'string' ? c.dataIndex : `col-${i}`));

    const visibleColumns = useMemo(() => {
        const base = columns.filter((c, i) => !hidden.has(columnKey(c as ColumnType<T>, i)));
        // Re-apply sort direction to whichever column matches orderBy.
        return base.map((c) => {
            const col = c as ColumnType<T>;
            if (!col.sorter) return withEllipsisText(col);
            const k = String(col.key ?? col.dataIndex);
            return withEllipsisText({
                ...col,
                sortOrder: applied.orderBy === k ? (applied.order === 'asc' ? 'ascend' : 'descend') : null,
            } as ColumnType<T>);
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [columns, hidden, applied.orderBy, applied.order]);

    // ---- column show/hide toggle ----
    const toggle = (k: string, checked: boolean) =>
        setHidden((prev) => {
            const next = new Set(prev);
            if (checked) next.delete(k);
            else next.add(k);
            return next;
        });

    const toggleItems: MenuProps['items'] = [
        { key: '__hdr', type: 'group', label: 'SHOW COLUMNS' },
        ...columns.map((c, i) => {
            const k = columnKey(c as ColumnType<T>, i);
            const label =
                typeof c.title === 'string' && c.title ? c.title : ((c as ColumnType<T>).key ?? `Column ${i + 1}`);
            return {
                key: k,
                label: (
                    <Checkbox
                        checked={!hidden.has(k)}
                        onClick={(e: React.MouseEvent) => e.stopPropagation()}
                        onChange={(e) => toggle(k, e.target.checked)}
                    >
                        {label as ReactNode}
                    </Checkbox>
                ),
            };
        }),
    ];

    const rowSelection = bulkBar
        ? {
              selectedRowKeys: selectedKeys,
              onChange: (keys: Array<Key>) => setSelectedKeys(keys),
              columnWidth: 44,
              fixed: 'left' as const,
          }
        : undefined;

    const selectedRows = rows.filter((r) => selectedKeys.includes(keyOf(r)));
    const clearSelection = () => setSelectedKeys([]);

    const submitSearch = () => onSearchChange({ search: draftSearch.trim() || undefined, page: undefined });

    const onTableChange = (
        _pagination: unknown,
        _filters: unknown,
        sorter: SorterResult<T> | Array<SorterResult<T>>,
    ) => {
        const s = Array.isArray(sorter) ? sorter[0] : sorter;
        if (!s?.order) {
            onSearchChange({ orderBy: undefined, order: undefined });
            return;
        }
        onSearchChange({
            orderBy: s.field as string,
            order: s.order === 'ascend' ? 'asc' : 'desc',
        });
    };

    const from = total === 0 ? 0 : (currentPage - 1) * perPage + 1;
    const to = Math.min(currentPage * perPage, total);
    const totalPages = Math.max(1, Math.ceil(total / perPage));

    return (
        <Flex vertical gap={token.margin}>
            {/* Control bar */}
            <Flex gap="small" wrap align="center" justify="space-between">
                {/* flex:1 so the controls claim the space between them and the primary action. Without it
            this is a flex item with no grow, so it sits at content width and spends any slack on
            an empty gap while the filters wrap to a second line. */}
                <Flex gap="small" wrap align="center" style={{ flex: 1, minInlineSize: 0 }}>
                    <Dropdown trigger={['click']} menu={{ items: toggleItems }} placement="bottomLeft">
                        <Tooltip title="Show / hide columns">
                            <Button icon={<SettingOutlined />} aria-label="Columns" />
                        </Tooltip>
                    </Dropdown>

                    <Space size={4}>
                        <Typography.Text type="secondary">Select</Typography.Text>
                        <Select
                            value={applied.limit}
                            onChange={(v) => onSearchChange({ limit: v, page: undefined })}
                            options={PAGE_SIZE_OPTIONS.map((n) => ({ value: n, label: n }))}
                            style={{ minInlineSize: '4.5rem' }}
                        />
                        <Typography.Text type="secondary">in single page.</Typography.Text>
                    </Space>

                    <Input
                        allowClear
                        placeholder={searchPlaceholder}
                        prefix={<SearchOutlined />}
                        value={draftSearch}
                        onChange={(e) => setDraftSearch(e.target.value)}
                        onPressEnter={submitSearch}
                        onClear={() => onSearchChange({ search: undefined, page: undefined })}
                        // The only elastic control here, so it absorbs the slack instead of leaving a dead
                        // gap — and yields it back before anything wraps.
                        style={{ flex: '1 1 12rem', maxInlineSize: '24rem', minInlineSize: '9rem' }}
                    />
                    <Button type="primary" ghost icon={<SearchOutlined />} onClick={submitSearch}>
                        Search
                    </Button>

                    {filters}
                </Flex>

                {primaryAction}
            </Flex>

            {/* Bulk bar (only when something is selected) */}
            {bulkBar && selectedRows.length > 0 && (
                <Flex
                    align="center"
                    justify="space-between"
                    style={{
                        padding: `${token.paddingXS}px ${token.padding}px`,
                        background: token.colorInfoBg,
                        borderRadius: token.borderRadius,
                    }}
                >
                    <Typography.Text>{selectedRows.length} selected</Typography.Text>
                    <Space>{bulkBar(selectedRows, clearSelection)}</Space>
                </Flex>
            )}

            <Table<T>
                rowKey={rowKey as never}
                size="middle"
                columns={visibleColumns}
                dataSource={rows}
                loading={loading}
                rowSelection={rowSelection}
                onChange={onTableChange}
                pagination={false}
                scroll={{ x: 'max-content' }}
                onRow={(row) => (onRowClick ? { onClick: () => onRowClick(row), style: { cursor: 'pointer' } } : {})}
            />

            {/* Verbose footer */}
            <Flex align="center" justify="space-between" wrap gap="small">
                <Typography.Text type="secondary">
                    {total} entries (Showing <b>{total === 0 ? 0 : to - from + 1}</b> items on page <b>{currentPage}</b>{' '}
                    of total <b>{totalPages}</b> pages)
                </Typography.Text>
                <Pagination
                    current={currentPage}
                    pageSize={perPage}
                    total={total}
                    showSizeChanger={false}
                    onChange={(page) => onSearchChange({ page: page === 1 ? undefined : page })}
                />
            </Flex>
        </Flex>
    );
}
