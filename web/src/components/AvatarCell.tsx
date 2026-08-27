import type { ReactNode } from 'react'
import { Avatar, Flex, Typography, theme } from 'antd'

const PALETTE = ['#6366f1', '#1677ff', '#722ed1', '#c41d7f', '#d46b08', '#08979c', '#531dab']

const colourFor = (seed: string) => {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  return PALETTE[hash % PALETTE.length]
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('') || '?'

/** Name column: photo when `image` is a URL, otherwise a stable colour monogram. */
export function AvatarCell({
  name,
  image,
  secondary,
}: {
  name: string
  image?: string | null
  secondary?: ReactNode
}) {
  const { token } = theme.useToken()
  const src = image && /^(https?:|blob:|data:|\/)/i.test(image) ? image : undefined

  return (
    <Flex align="center" gap="small" style={{ minWidth: 0 }}>
      <Avatar size="small" src={src} style={{ background: src ? undefined : colourFor(name), flex: 'none' }}>
        {initials(name)}
      </Avatar>
      <Flex vertical style={{ minWidth: 0 }}>
        <Typography.Text strong ellipsis={{ tooltip: name }}>
          {name}
        </Typography.Text>
        {secondary != null && (
          <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }} ellipsis>
            {secondary}
          </Typography.Text>
        )}
      </Flex>
    </Flex>
  )
}
