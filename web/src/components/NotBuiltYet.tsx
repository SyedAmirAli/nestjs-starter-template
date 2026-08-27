import type { ReactNode } from 'react';
import { Card, Empty, Tag, Typography } from 'antd';
import { PageHeader } from './PageHeader';

/**
 * Scaffold placeholder for a module screen that doesn't exist yet — drop this in as the route
 * component and swap it for the real page once it's built.
 */
export function NotBuiltYet({
    title,
    description,
    endpoints,
    extra,
}: {
    title: string;
    description?: string;
    endpoints?: Array<string>;
    extra?: ReactNode;
}) {
    return (
        <>
            <PageHeader title={title} description={description} />
            <Card>
                <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={<Typography.Text type="secondary">Not built yet</Typography.Text>}
                >
                    {endpoints?.length ? (
                        <div style={{ marginTop: 8 }}>
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                Backing endpoints
                            </Typography.Text>
                            <div style={{ marginTop: 8 }}>
                                {endpoints.map((e) => (
                                    <Tag key={e} style={{ fontFamily: 'monospace', marginBottom: 4 }}>
                                        {e}
                                    </Tag>
                                ))}
                            </div>
                        </div>
                    ) : null}
                    {extra}
                </Empty>
            </Card>
        </>
    );
}
