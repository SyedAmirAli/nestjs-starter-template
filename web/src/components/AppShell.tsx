import {
    ApiOutlined,
    AppstoreOutlined,
    AuditOutlined,
    CloudServerOutlined,
    DatabaseOutlined,
    DeleteOutlined,
    LogoutOutlined,
    TeamOutlined,
    UserOutlined,
} from '@ant-design/icons';
import { Button, Layout, Menu, Space, Tag, theme, Typography } from 'antd';
import type { MenuProps } from 'antd';
import { Outlet, useNavigate, useRouterState, getRouteApi } from '@tanstack/react-router';
import { signOut } from '../lib/session';
import type { DashboardPath } from '../lib/paths';

const { Header, Sider, Content } = Layout;

const authRoute = getRouteApi('/_authenticated');

const NAV: MenuProps['items'] = [
    { key: '/', icon: <AppstoreOutlined />, label: 'Overview' },
    {
        key: 'administration',
        icon: <TeamOutlined />,
        label: 'Administration',
        children: [
            { key: '/users', icon: <UserOutlined />, label: 'Users' },
            { key: '/account-delete', icon: <DeleteOutlined />, label: 'Account delete' },
            { key: '/audit', icon: <AuditOutlined />, label: 'Audit logs' },
        ],
    },
    { key: '/caches', icon: <DatabaseOutlined />, label: 'Cache management' },
    { key: '/system', icon: <CloudServerOutlined />, label: 'System' },
];

const LEAF_KEYS: ReadonlyArray<DashboardPath> = ['/', '/system', '/users', '/account-delete', '/audit', '/caches'];

function selectedNavKey(pathname: string): string {
    const rest = pathname.startsWith('/admin') ? pathname.slice('/admin'.length) || '/' : pathname;
    const normalized = rest.length > 1 && rest.endsWith('/') ? rest.slice(0, -1) : rest;
    if ((LEAF_KEYS as readonly string[]).includes(normalized)) return normalized;
    return '/';
}

export function AppShell() {
    const { user } = authRoute.useRouteContext();
    const pathname = useRouterState({ select: (s) => s.location.pathname });
    const navigate = useNavigate();
    const { token } = theme.useToken();

    const divider = `1px solid ${token.colorBorderSecondary}`;
    const selected = selectedNavKey(pathname);

    return (
        <Layout style={{ minHeight: '100vh' }}>
            <Sider width={232} breakpoint="lg" collapsedWidth={64} style={{ borderInlineEnd: divider }}>
                <div className="flex items-center gap-2.5 px-4 py-4">
                    <span
                        className="grid h-8 w-8 shrink-0 place-items-center text-xs font-bold text-white"
                        style={{ background: token.colorPrimary, borderRadius: token.borderRadiusLG }}
                    >
                        BA
                    </span>
                    <span className="min-w-0 leading-tight">
                        <Typography.Text strong className="block truncate">
                            base-app
                        </Typography.Text>
                        <Typography.Text
                            type="secondary"
                            className="block truncate text-[11px] tracking-wider uppercase"
                        >
                            admin console
                        </Typography.Text>
                    </span>
                </div>

                <Menu
                    theme="dark"
                    mode="inline"
                    items={NAV}
                    selectedKeys={[selected]}
                    defaultOpenKeys={['administration']}
                    onClick={({ key }) => {
                        if ((LEAF_KEYS as readonly string[]).includes(key)) {
                            void navigate({ to: key as DashboardPath });
                        }
                    }}
                />
            </Sider>

            <Layout>
                <Header
                    className="flex items-center justify-between gap-4"
                    style={{ borderBlockEnd: divider, paddingInline: token.paddingLG }}
                >
                    <Space size="small">
                        <Typography.Text strong>{user.name || user.email}</Typography.Text>
                        <Tag color="blue" bordered={false}>
                            {user.role}
                        </Tag>
                        {user.isSuperAdmin && (
                            <Tag color="gold" bordered={false}>
                                super-admin
                            </Tag>
                        )}
                    </Space>

                    <Space size="small">
                        <Button type="text" icon={<ApiOutlined />} href="/docs" target="_blank" rel="noreferrer">
                            API docs
                        </Button>
                        <Button icon={<LogoutOutlined />} onClick={() => void signOut()}>
                            Sign out
                        </Button>
                    </Space>
                </Header>

                <Content style={{ padding: token.paddingLG }}>
                    <Outlet />
                </Content>
            </Layout>
        </Layout>
    );
}
