import type { ReactNode } from 'react';
import { Space, Typography } from 'antd';
import { PageDescription } from './PageDescription';

export function PageHeader({
    title,
    description,
    extra,
}: {
    /** Plain text, or a node (e.g. `<Space>{title}<Tag>Agronomy</Tag></Space>`) for a badge next to the title. */
    title: ReactNode;
    /**
     * A string is treated as Markdown and rendered as a collapsible guide (first two lines +
     * "Show more"). Any other node renders inline as-is.
     */
    description?: ReactNode;
    extra?: ReactNode;
}) {
    return (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div style={{ minWidth: 0 }}>
                <Typography.Title level={3} className="mb-1!">
                    {title}
                </Typography.Title>
                {typeof description === 'string'
                    ? description && <PageDescription source={description} />
                    : description && (
                          <Typography.Paragraph type="secondary" className="mb-0!">
                              {description}
                          </Typography.Paragraph>
                      )}
            </div>
            {extra ? <Space wrap>{extra}</Space> : null}
        </div>
    );
}
