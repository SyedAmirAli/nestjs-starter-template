import { ApiOutlined, AppstoreOutlined, CloudServerOutlined, LogoutOutlined } from '@ant-design/icons'
import { Button, Layout, Menu, Skeleton, Space, Tag, theme, Typography } from 'antd'
import { Outlet, useLocation, useNavigate } from 'react-router'
import { signOut, useSession } from '../lib/session'

const { Header, Sider, Content } = Layout

/**
 * Client-side routes. Every one is served the SPA shell by the API's history fallback, so
 * adding an entry here needs no server change — see src/web/static-spa.ts.
 */
const NAV = [
  { key: '/', icon: <AppstoreOutlined />, label: 'Overview' },
  { key: '/system', icon: <CloudServerOutlined />, label: 'System' },
]

export function AppShell() {
  const { user, loading } = useSession()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { token } = theme.useToken()

  const divider = `1px solid ${token.colorBorderSecondary}`

  // Sizing and colour go through antd's own API rather than Tailwind classes. Tailwind's
  // utilities sit in a cascade layer, so they lose to antd's component styles — a
  // `min-h-screen` here is silently beaten by `.ant-layout { min-height: 0 }`. That
  // ordering is intentional (see src/index.css); the rule of thumb is to style antd
  // components with antd props and tokens, and save utilities for plain elements.
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider width={232} breakpoint="lg" collapsedWidth={64} style={{ borderInlineEnd: divider }}>
        <div className="flex items-center gap-2.5 px-4 py-4">
          <span
            className="grid h-8 w-8 shrink-0 place-items-center text-xs font-bold text-white"
            style={{ background: token.colorPrimary, borderRadius: token.borderRadiusLG }}
          >
            GQ
          </span>
          <span className="min-w-0 leading-tight">
            <Typography.Text strong className="block truncate">
              glowquest
            </Typography.Text>
            <Typography.Text type="secondary" className="block truncate text-[11px] tracking-wider uppercase">
              admin console
            </Typography.Text>
          </span>
        </div>

        <Menu
          theme="dark"
          mode="inline"
          items={NAV}
          selectedKeys={[pathname]}
          onClick={({ key }) => void navigate(key)}
        />
      </Sider>

      <Layout>
        <Header
          className="flex items-center justify-between gap-4"
          style={{ borderBlockEnd: divider, paddingInline: token.paddingLG }}
        >
          {loading ? (
            <Skeleton.Input active size="small" />
          ) : user ? (
            <Space size="small">
              <Typography.Text strong>{user.name || user.email}</Typography.Text>
              <Tag color="blue" bordered={false}>
                {user.role}
              </Tag>
            </Space>
          ) : (
            <Typography.Text type="secondary">Unknown session</Typography.Text>
          )}

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
  )
}
