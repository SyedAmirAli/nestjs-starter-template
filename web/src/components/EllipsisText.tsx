import { Typography } from 'antd';
import type { CSSProperties, ReactNode } from 'react';

const DEFAULT_MAX_WIDTH = 400;
const DEFAULT_TOOLTIP_MAX_WIDTH = 480;

export interface EllipsisTextProps {
    children: ReactNode;
    /** Cell text cap — CSS ellipsis needs a real max-width. */
    maxWidth?: number;
    /** Hover tooltip width for the full string. */
    tooltipMaxWidth?: number;
    code?: boolean;
    strong?: boolean;
    type?: 'secondary' | 'success' | 'warning' | 'danger';
    style?: CSSProperties;
}

/**
 * Single-line truncated text for table cells. Hover shows the full value.
 * Use this (or let ListTable apply it to plain string/number cells) instead of
 * manual `.slice()` / ad-hoc Tooltip wrappers.
 */
export function EllipsisText({
    children,
    maxWidth = DEFAULT_MAX_WIDTH,
    tooltipMaxWidth = DEFAULT_TOOLTIP_MAX_WIDTH,
    code,
    strong,
    type,
    style,
}: EllipsisTextProps) {
    const text = children == null ? '' : String(children);
    if (!text) return null;

    return (
        <Typography.Text
            code={code}
            strong={strong}
            type={type}
            style={{ maxWidth, display: 'inline-block', verticalAlign: 'bottom', ...style }}
            ellipsis={{ tooltip: { title: text, styles: { root: { maxWidth: tooltipMaxWidth } } } }}
        >
            {text}
        </Typography.Text>
    );
}
