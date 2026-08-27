import { useEffect, useState } from 'react'
import { Alert, Descriptions, Drawer, Skeleton, Typography } from 'antd'
import { JsonBlock } from '../../components/JsonBlock'
import { formatBytes } from '../../lib/format'
import { isApiError } from '../../lib/api'
import { getCacheEntry, type CacheEntry } from './api'
import { TtlText, TypeTag } from './cache-tags'

export function CacheValueDrawer({ cacheKey, onClose }: { cacheKey: string | null; onClose: () => void }) {
  const [entry, setEntry] = useState<CacheEntry | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!cacheKey) {
      setEntry(null)
      setError(null)
      return
    }

    const ac = new AbortController()
    setLoading(true)
    setError(null)
    getCacheEntry(cacheKey, ac.signal)
      .then((next) => {
        if (ac.signal.aborted) return
        setEntry(next)
      })
      .catch((cause: unknown) => {
        if (ac.signal.aborted) return
        setEntry(null)
        setError(isApiError(cause) ? cause.message : 'Could not read this key')
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false)
      })

    return () => ac.abort()
  }, [cacheKey])

  return (
    <Drawer
      open={!!cacheKey}
      onClose={onClose}
      width={720}
      destroyOnHidden
      title={
        <Typography.Text copyable style={{ fontFamily: 'monospace', fontSize: 13 }}>
          {cacheKey}
        </Typography.Text>
      }
    >
      {loading && <Skeleton active />}

      {error && (
        <Alert
          type="error"
          showIcon
          title={error}
          description="It may have expired between listing and opening."
        />
      )}

      {entry && (
        <>
          <Descriptions column={2} size="small" bordered className="mb-4">
            <Descriptions.Item label="Type">
              <TypeTag type={entry.type} />
            </Descriptions.Item>
            <Descriptions.Item label="Size">{formatBytes(entry.size)}</Descriptions.Item>
            <Descriptions.Item label="TTL">
              <TtlText duration={entry.duration} revalidatesAt={entry.revalidatesAt} />
            </Descriptions.Item>
            <Descriptions.Item label="Idle">
              {entry.idleSeconds == null ? '—' : `${entry.idleSeconds}s since last access`}
            </Descriptions.Item>
          </Descriptions>

          {entry.type !== 'string' && (
            <Alert
              type="info"
              showIcon
              className="mb-3"
              title={`Read as a Redis ${entry.type}.`}
              description="Rendered as JSON for inspection. Only string keys can be written from this panel."
            />
          )}

          <JsonBlock value={entry.value} empty="Empty" />
        </>
      )}
    </Drawer>
  )
}
