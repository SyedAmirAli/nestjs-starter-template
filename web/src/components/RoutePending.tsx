import { Spin } from 'antd'

/** Shown while a route `beforeLoad` is resolving the session. */
export function RoutePending() {
  return (
    <div className="grid min-h-full place-items-center">
      <Spin size="large" />
    </div>
  )
}
