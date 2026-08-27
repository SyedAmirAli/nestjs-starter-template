/* eslint-disable react-refresh/only-export-components */
import { App, Button, Dropdown } from 'antd';
import type { ColumnType } from 'antd/es/table';
import type { MenuProps } from 'antd';
import { CopyOutlined, MoreOutlined } from '@ant-design/icons';

async function copyText(text: string): Promise<boolean> {
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch {
        // fall through
    }
    try {
        const el = document.createElement('textarea');
        el.value = text;
        el.style.position = 'fixed';
        el.style.opacity = '0';
        document.body.appendChild(el);
        el.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(el);
        return ok;
    } catch {
        return false;
    }
}

/**
 * The ⋮ control for one table row. Copy ID is always last so every list shares it.
 * Pin this column first (after any row-selection checkbox) — see AGENTS.md.
 */
export function RowActions({ id, items }: { id: string; items: MenuProps['items'] }) {
    const { message } = App.useApp();
    const pageItems = items ?? [];
    const menuItems: MenuProps['items'] = [
        ...pageItems,
        ...(pageItems.length ? [{ type: 'divider' as const }] : []),
        {
            key: '__copy_id',
            icon: <CopyOutlined />,
            label: 'Copy ID',
            onClick: () => {
                void copyText(id).then((ok) => {
                    if (ok) message.success('ID copied');
                    else message.error('Could not copy ID');
                });
            },
        },
    ];

    return (
        <Dropdown
            trigger={['click']}
            menu={{
                items: menuItems,
                onClick: ({ domEvent }) => domEvent.stopPropagation(),
            }}
        >
            <Button type="text" icon={<MoreOutlined />} aria-label="Row actions" onClick={(e) => e.stopPropagation()} />
        </Dropdown>
    );
}

/** First data column of every admin list: the ⋮ menu, pinned left. */
export function actionsColumn<T>(getId: (row: T) => string, itemsOf: (row: T) => MenuProps['items']): ColumnType<T> {
    return {
        key: 'actions',
        title: '',
        width: 48,
        fixed: 'left',
        render: (_value, row) => <RowActions id={getId(row)} items={itemsOf(row)} />,
    };
}
