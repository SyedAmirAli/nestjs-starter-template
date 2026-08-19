import { Alert, Card, Col, Descriptions, Row, Skeleton, Tag, Typography } from 'antd';
import { useSession } from '../lib/session';

/** The API's own namespaces, mirroring src/web/reserved-paths.ts on the server. */
const NAMESPACES = [
    { path: '/v1', purpose: 'Versioned API' },
    { path: '/api/auth', purpose: 'Sessions, sign-in, OTP' },
    { path: '/health', purpose: 'Liveness probe' },
    { path: '/docs', purpose: 'OpenAPI explorer' },
];

export function OverviewPage() {
    const { user, loading, error } = useSession();

    return (
        <>
            <Typography.Title level={3} className="mb-1!">
                Overview
            </Typography.Title>
            <Typography.Paragraph type="secondary">
                Signed in through the same session the mobile app uses.
            </Typography.Paragraph>

            {error && <Alert type="error" showIcon message={error} className="mb-4" />}

            <Row gutter={[16, 16]}>
                <Col xs={24} lg={12}>
                    <Card title="Your account">
                        {loading || !user ? (
                            <Skeleton active paragraph={{ rows: 4 }} />
                        ) : (
                            <Descriptions column={1} size="small" colon={false}>
                                <Descriptions.Item label="Name">{user.name || '—'}</Descriptions.Item>
                                <Descriptions.Item label="Email">{user.email}</Descriptions.Item>
                                <Descriptions.Item label="Role">
                                    <Tag color="blue" bordered={false}>
                                        {user.role}
                                    </Tag>
                                </Descriptions.Item>
                                <Descriptions.Item label="Verified">
                                    <Tag color={user.emailVerified ? 'success' : 'warning'} bordered={false}>
                                        {user.emailVerified ? 'Yes' : 'No'}
                                    </Tag>
                                </Descriptions.Item>
                                <Descriptions.Item label="Member since">
                                    {new Date(user.createdAt).toLocaleDateString()}
                                </Descriptions.Item>
                            </Descriptions>
                        )}
                    </Card>
                </Col>

                <Col xs={24} lg={12}>
                    <Card title="Where things live">
                        <Typography.Paragraph type="secondary">
                            This console is served by the API process at <Typography.Text code>/</Typography.Text>. The
                            API keeps its own namespaces, so the two never collide.
                        </Typography.Paragraph>
                        <Descriptions column={1} size="small" colon={false}>
                            {NAMESPACES.map(({ path, purpose }) => (
                                <Descriptions.Item key={path} label={<Typography.Text code>{path}</Typography.Text>}>
                                    {purpose}
                                </Descriptions.Item>
                            ))}
                        </Descriptions>
                    </Card>
                </Col>
            </Row>
        </>
    );
}
