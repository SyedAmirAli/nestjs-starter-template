import { Tag, Tooltip, Typography } from 'antd'
import { relativeTime } from '../../lib/format'
import type { RedisKeyType } from './api'

const TYPE_COLOR: Record<RedisKeyType, string> = {
  string: 'blue',
  hash: 'purple',
  list: 'cyan',
  set: 'geekblue',
  zset: 'magenta',
  stream: 'orange',
  none: 'default',
}

export function TypeTag({ type }: { type: RedisKeyType }) {
  return <Tag color={TYPE_COLOR[type] ?? 'default'}>{type}</Tag>
}

export function TtlText({
  duration,
  revalidatesAt,
}: {
  duration: number | null
  revalidatesAt: string | null
}) {
  if (duration == null) {
    return <Typography.Text type="secondary">no expiry</Typography.Text>
  }
  return (
    <Tooltip title={revalidatesAt ? `Expires ${new Date(revalidatesAt).toLocaleString()}` : undefined}>
      {revalidatesAt ? relativeTime(revalidatesAt) : `${duration}s`}
    </Tooltip>
  )
}
