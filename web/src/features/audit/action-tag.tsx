import { Tag, Tooltip } from 'antd'
import {
  DeleteOutlined,
  EditOutlined,
  ExportOutlined,
  LoginOutlined,
  LogoutOutlined,
  PlusOutlined,
  QuestionOutlined,
  SwapOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import type { ReactNode } from 'react'
import type { AuditAction } from './api'

const ACTION_STYLE: Record<AuditAction, { color: string; icon: ReactNode }> = {
  CREATE: { color: 'green', icon: <PlusOutlined /> },
  UPDATE: { color: 'blue', icon: <EditOutlined /> },
  DELETE: { color: 'error', icon: <DeleteOutlined /> },
  STATUS_CHANGE: { color: 'orange', icon: <SwapOutlined /> },
  LOGIN: { color: 'default', icon: <LoginOutlined /> },
  LOGOUT: { color: 'default', icon: <LogoutOutlined /> },
  EXPORT: { color: 'purple', icon: <ExportOutlined /> },
  PURGE: { color: 'error', icon: <ThunderboltOutlined /> },
  OTHER: { color: 'default', icon: <QuestionOutlined /> },
}

export function AuditActionTag({ action }: { action: AuditAction }) {
  const style = ACTION_STYLE[action] ?? ACTION_STYLE.OTHER
  return (
    <Tag color={style.color} icon={style.icon}>
      {action}
    </Tag>
  )
}

export function ResourceTag({ resource }: { resource: string }) {
  const [ns, sub] = resource.split(':')
  if (!sub) return <Tag>{resource}</Tag>
  return (
    <Tooltip title={resource}>
      <Tag>
        {ns} / <b>{sub}</b>
      </Tag>
    </Tooltip>
  )
}
