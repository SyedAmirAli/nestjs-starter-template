import { Fragment, useEffect, useState } from 'react';
import { Alert, Badge, Card, Col, Descriptions, Row, Skeleton, Tag, Typography } from 'antd';
import { fetchHealth } from '../lib/api';

type Health = Awaited<ReturnType<typeof fetchHealth>>;

/** Slow enough not to be a self-inflicted load test, fast enough to notice a restart. */
const POLL_INTERVAL_MS = 15_000;

export function SystemPage() {
    const [health, setHealth] = useState<Health | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        const poll = () => {
            fetchHealth()
                .then((next) => {
                    if (cancelled) return;
                    setHealth(next);
                    setError(null);
                })
                .catch((cause: unknown) => {
                    if (cancelled) return;
                    setError((cause as Error).message);
                });
        };

        poll();
        const timer = window.setInterval(poll, POLL_INTERVAL_MS);

        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, []);

    const online = Boolean(health) && !error;

    return (
        <Fragment>
            <Typography.Title level={3} className="mb-1!">
                System
            </Typography.Title>
            <Typography.Paragraph type="secondary">
                Polled every {POLL_INTERVAL_MS / 1000} seconds.
            </Typography.Paragraph>

            <Row gutter={[16, 16]}>
                <Col xs={24} lg={12}>
                    <Card title={<Badge status={online ? 'success' : 'error'} text="API" />}>
                        {error && <Alert type="error" showIcon message={error} className="mb-4" />}

                        {!health && !error && <Skeleton active paragraph={{ rows: 3 }} />}

                        {health && (
                            <Descriptions column={1} size="small" colon={false}>
                                <Descriptions.Item label="Status">{health.status}</Descriptions.Item>
                                <Descriptions.Item label="Service">{health.name}</Descriptions.Item>
                                <Descriptions.Item label="Environment">
                                    <Tag bordered={false}>{health.env}</Tag>
                                </Descriptions.Item>
                                <Descriptions.Item label="Reported at">
                                    {new Date(health.at).toLocaleTimeString()}
                                </Descriptions.Item>
                            </Descriptions>
                        )}
                    </Card>
                </Col>
            </Row>
        </Fragment>
    );
}
