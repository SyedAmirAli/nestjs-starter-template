import type { MouseEvent } from 'react';
import { Switch, Tooltip } from 'antd';
import type { ColumnType } from 'antd/es/table';

/**
 * The Active/Inactive column every admin list uses: a live `Switch`, not a static tag — toggling
 * calls straight through to your mutation. `onCell` swallows the click on the whole cell (not
 * just the switch) so flipping it never also fires the row's `onClick` (e.g. opening an edit
 * drawer via `ListTable`'s `onRowClick`).
 */
export function activeColumn<T>({
    getActive,
    onToggle,
    getId,
    pendingId,
    title = 'Active',
    width = 90,
}: {
    getActive: (row: T) => boolean;
    onToggle: (row: T) => void;
    /** Row identity, only needed if you pass `pendingId` to spin just the row being toggled. */
    getId?: (row: T) => string;
    pendingId?: string | null;
    title?: string;
    width?: number;
}): ColumnType<T> {
    return {
        key: 'active',
        title,
        width,
        onCell: () => ({ onClick: (e: MouseEvent) => e.stopPropagation() }),
        render: (_value, row) => {
            const active = getActive(row);
            const id = getId?.(row);
            return (
                <Tooltip title={active ? 'Active — click to deactivate' : 'Inactive — click to activate'}>
                    <Switch
                        checked={active}
                        loading={pendingId != null && id === pendingId}
                        onChange={() => onToggle(row)}
                    />
                </Tooltip>
            );
        },
    };
}
