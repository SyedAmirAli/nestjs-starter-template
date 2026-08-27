import { Empty, Typography, theme } from 'antd'

export function JsonBlock({ value, empty = 'Not recorded' }: { value: unknown; empty?: string }) {
  const { token } = theme.useToken()

  if (value == null) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={empty} />
  }

  return (
    <Typography.Paragraph>
      <pre
        className="m-0 max-h-80 overflow-auto rounded p-3 text-xs leading-relaxed"
        style={{ background: token.colorFillTertiary, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
      >
        {JSON.stringify(value, null, 2)}
      </pre>
    </Typography.Paragraph>
  )
}
