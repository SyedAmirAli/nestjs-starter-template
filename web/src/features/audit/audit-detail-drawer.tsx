import { Descriptions, Drawer, Tabs, Typography } from 'antd'
import { JsonBlock } from '../../components/JsonBlock'
import { formatDateTime, relativeTime } from '../../lib/format'
import { AuditActionTag, ResourceTag } from './action-tag'
import type { AuditLog } from './api'

const show = (value: string | null | undefined) => value || '—'

export function AuditDetailDrawer({ row, onClose }: { row: AuditLog | null; onClose: () => void }) {
  return (
    <Drawer
      open={!!row}
      onClose={onClose}
      width={720}
      destroyOnHidden
      title={row ? <AuditActionTag action={row.action} /> : null}
    >
      {row && (
        <>
          <Descriptions column={1} size="small" bordered styles={{ label: { inlineSize: 140 } }}>
            <Descriptions.Item label="Summary">{show(row.summary)}</Descriptions.Item>
            <Descriptions.Item label="Resource">
              <ResourceTag resource={row.resource} />
            </Descriptions.Item>
            <Descriptions.Item label="Resource ID">
              <Typography.Text copyable={!!row.resourceId} style={{ fontFamily: 'monospace' }}>
                {show(row.resourceId)}
              </Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label="Actor">{row.actorEmail ?? row.actorId ?? 'System'}</Descriptions.Item>
            <Descriptions.Item label="When">
              {formatDateTime(row.createdAt)}{' '}
              <Typography.Text type="secondary">({relativeTime(row.createdAt)})</Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label="IP">{show(row.ip)}</Descriptions.Item>
            <Descriptions.Item label="User agent">
              <Typography.Text type="secondary" className="text-xs">
                {show(row.userAgent)}
              </Typography.Text>
            </Descriptions.Item>
          </Descriptions>

          <Tabs
            className="mt-4"
            items={[
              { key: 'before', label: 'Before', children: <JsonBlock value={row.beforeJson} /> },
              { key: 'after', label: 'After', children: <JsonBlock value={row.afterJson} /> },
              { key: 'meta', label: 'Meta', children: <JsonBlock value={row.metaJson} /> },
            ]}
          />
        </>
      )}
    </Drawer>
  )
}
