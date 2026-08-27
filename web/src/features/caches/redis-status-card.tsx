import {
  Alert,
  App,
  Badge,
  Button,
  Card,
  Col,
  Collapse,
  Descriptions,
  Row,
  Skeleton,
  Space,
  Statistic,
  Tag,
  Tooltip,
  Typography,
  theme,
} from 'antd'
import { PoweroffOutlined, ReloadOutlined, SyncOutlined } from '@ant-design/icons'
import { isApiError } from '../../lib/api'
import { formatBytes, formatDateTime, formatUptime, relativeTime } from '../../lib/format'
import { restartRedis, startRedis, type RedisState, type RedisStatus } from './api'

const STATE_UI: Record<RedisState, { badge: 'success' | 'processing' | 'error'; label: string; color: string }> = {
  up: { badge: 'success', label: 'Up', color: 'green' },
  connecting: { badge: 'processing', label: 'Connecting', color: 'gold' },
  down: { badge: 'error', label: 'Down', color: 'red' },
}

const dash = <Typography.Text type="secondary">—</Typography.Text>
const num = (value: number | null | undefined) => (value == null ? '—' : value.toLocaleString())

export function RedisStatusCard({
  status,
  loading,
  onChanged,
}: {
  status: RedisStatus | undefined
  loading: boolean
  onChanged: () => void
}) {
  const { token } = theme.useToken()
  const { message, modal } = App.useApp()

  const runControl = async (action: 'start' | 'restart') => {
    try {
      const result = await (action === 'start' ? startRedis() : restartRedis())
      message.success(result.data.detail || result.message)
      onChanged()
    } catch (error: unknown) {
      message.error(isApiError(error) ? error.message : 'Could not reach Redis control')
    }
  }

  if (!status) {
    return <Card size="small">{loading ? <Skeleton active paragraph={{ rows: 2 }} /> : null}</Card>
  }

  const ui = STATE_UI[status.state]
  const { control: capability } = status
  const healthy = status.state === 'up'

  const controlButton = (action: 'start' | 'restart') => {
    const isStart = action === 'start'
    const button = (
      <Button
        type={isStart ? 'primary' : 'default'}
        danger={!isStart}
        icon={isStart ? <PoweroffOutlined /> : <ReloadOutlined />}
        disabled={!capability.enabled}
        onClick={() => {
          if (isStart) {
            void runControl('start')
            return
          }
          modal.confirm({
            title: 'Restart Redis?',
            content:
              'Every cached value is lost and any queue job mid-processing is dropped. Use this only when Redis is up but misbehaving.',
            okText: 'Restart',
            okButtonProps: { danger: true },
            onOk: () => runControl('restart'),
          })
        }}
      >
        {isStart ? 'Enable Redis' : 'Restart'}
      </Button>
    )

    return capability.enabled ? (
      <Tooltip title={capability.reason}>{button}</Tooltip>
    ) : (
      <Tooltip title={capability.reason}>
        <span style={{ display: 'inline-block', cursor: 'not-allowed' }}>{button}</span>
      </Tooltip>
    )
  }

  return (
    <Card
      size="small"
      title={
        <Space wrap>
          <Badge status={ui.badge} />
          Redis
          <Tag color={ui.color}>{ui.label}</Tag>
          <Typography.Text type="secondary" style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 400 }}>
            {status.connection.host}:{status.connection.port} · db {status.connection.db}
          </Typography.Text>
        </Space>
      }
      extra={
        <Space>
          {status.state === 'connecting' && (
            <Tag icon={<SyncOutlined spin />} color="processing">
              Reconnecting
            </Tag>
          )}
          {healthy ? controlButton('restart') : controlButton('start')}
        </Space>
      }
      style={{ marginBottom: token.margin }}
    >
      {!healthy && (
        <Alert
          type={status.state === 'connecting' ? 'warning' : 'error'}
          showIcon
          style={{ marginBottom: token.margin }}
          title={
            status.state === 'connecting'
              ? `Reconnecting to Redis at ${status.connection.host}:${status.connection.port}`
              : `Redis is not reachable at ${status.connection.host}:${status.connection.port}`
          }
          description={
            <Space direction="vertical" size={4}>
              {status.error && (
                <Typography.Text code className="text-xs">
                  {status.error}
                </Typography.Text>
              )}
              <Typography.Text type="secondary">
                Cached values and background jobs are degraded until Redis comes back. Key listing below is
                unavailable.
              </Typography.Text>
              <Typography.Text type="secondary">{capability.reason}</Typography.Text>
            </Space>
          }
        />
      )}

      {healthy && (
        <>
          <Row gutter={[token.margin, token.marginSM]}>
            <Col xs={12} md={8} lg={4}>
              <Statistic
                title="Latency"
                value={status.latencyMs ?? 0}
                suffix="ms"
                valueStyle={{ color: (status.latencyMs ?? 0) > 50 ? token.colorWarning : undefined }}
              />
            </Col>
            <Col xs={12} md={8} lg={4}>
              <Tooltip
                title={`Keys in db ${status.keyspace?.db ?? 0}, of which ${num(status.keyspace?.expires)} have a TTL`}
              >
                <Statistic title="Keys" value={status.keyspace?.keys ?? 0} />
              </Tooltip>
            </Col>
            <Col xs={12} md={8} lg={4}>
              <Statistic title="Memory" value={formatBytes(status.memory?.usedBytes)} />
            </Col>
            <Col xs={12} md={8} lg={4}>
              <Statistic
                title="Hit rate"
                value={status.stats?.hitRate == null ? '—' : `${(status.stats.hitRate * 100).toFixed(1)}%`}
              />
            </Col>
            <Col xs={12} md={8} lg={4}>
              <Statistic title="Clients" value={status.clients?.connected ?? 0} />
            </Col>
            <Col xs={12} md={8} lg={4}>
              <Statistic title="Ops/sec" value={status.stats?.opsPerSec ?? 0} />
            </Col>
          </Row>

          <Collapse
            ghost
            size="small"
            style={{ marginTop: token.marginXS }}
            items={[
              {
                key: 'details',
                label: <Typography.Text type="secondary">Server details</Typography.Text>,
                children: (
                  <Descriptions column={{ xs: 1, md: 2, xl: 3 }} size="small" bordered>
                    <Descriptions.Item label="Version">
                      {status.server?.version ?? dash}
                      {status.server?.mode && <Tag style={{ marginInlineStart: 8 }}>{status.server.mode}</Tag>}
                    </Descriptions.Item>
                    <Descriptions.Item label="Uptime">{formatUptime(status.server?.uptimeSeconds)}</Descriptions.Item>
                    <Descriptions.Item label="OS">{status.server?.os ?? dash}</Descriptions.Item>
                    <Descriptions.Item label="Peak memory">{formatBytes(status.memory?.peakBytes)}</Descriptions.Item>
                    <Descriptions.Item label="Memory limit">
                      {status.memory?.maxBytes ? formatBytes(status.memory.maxBytes) : 'unlimited'}
                      {status.memory?.maxPolicy && (
                        <Tag style={{ marginInlineStart: 8 }}>{status.memory.maxPolicy}</Tag>
                      )}
                    </Descriptions.Item>
                    <Descriptions.Item label="Fragmentation">
                      {status.memory?.fragmentationRatio == null ? dash : `${status.memory.fragmentationRatio}×`}
                    </Descriptions.Item>
                    <Descriptions.Item label="Evicted keys">{num(status.stats?.evictedKeys)}</Descriptions.Item>
                    <Descriptions.Item label="Expired keys">{num(status.stats?.expiredKeys)}</Descriptions.Item>
                    <Descriptions.Item label="Persistence">
                      <Space size={4} wrap>
                        <Tag color={status.persistence?.aofEnabled ? 'green' : 'default'}>
                          AOF {status.persistence?.aofEnabled ? 'on' : 'off'}
                        </Tag>
                        {status.persistence?.lastSaveAt && (
                          <Tooltip title={formatDateTime(status.persistence.lastSaveAt)}>
                            <Typography.Text type="secondary">
                              saved {relativeTime(status.persistence.lastSaveAt)}
                            </Typography.Text>
                          </Tooltip>
                        )}
                      </Space>
                    </Descriptions.Item>
                    <Descriptions.Item label="Control">
                      <Tooltip title={capability.reason}>
                        <Tag color={capability.enabled ? 'blue' : 'default'}>{capability.driver}</Tag>
                      </Tooltip>
                    </Descriptions.Item>
                  </Descriptions>
                ),
              },
            ]}
          />
        </>
      )}
    </Card>
  )
}
