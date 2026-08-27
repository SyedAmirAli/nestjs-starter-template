import { useEffect } from 'react'
import { App, Alert, Button, Drawer, Form, Input, InputNumber, Space } from 'antd'
import type { Rule } from 'antd/es/form'
import { isApiError } from '../../lib/api'
import { setCacheEntry } from './api'

interface SetForm {
  key: string
  value: string
  ttl?: number
}

const DEFAULT_TTL = 3600

const jsonValueRule: Rule = {
  validator: (_rule, value: string | undefined) => {
    if (!value?.trim()) return Promise.reject(new Error('Value is required (use null for JSON null).'))
    try {
      JSON.parse(value)
      return Promise.resolve()
    } catch (error) {
      return Promise.reject(new Error(error instanceof Error ? error.message : 'Invalid JSON.'))
    }
  },
}

export function SetCacheDrawer({
  open,
  initialKey,
  onClose,
  onSaved,
}: {
  open: boolean
  initialKey?: string
  onClose: () => void
  onSaved: () => void
}) {
  const [form] = Form.useForm<SetForm>()
  const { message } = App.useApp()

  useEffect(() => {
    if (!open) return
    form.setFieldsValue({ key: initialKey ?? '', value: '', ttl: DEFAULT_TTL })
  }, [open, initialKey, form])

  const submit = async (values: SetForm) => {
    try {
      await setCacheEntry({ key: values.key.trim(), value: JSON.parse(values.value) as unknown, ttl: values.ttl })
      message.success('Key set')
      form.resetFields()
      onSaved()
      onClose()
    } catch (error: unknown) {
      message.error(isApiError(error) ? error.message : 'Could not set the key')
    }
  }

  return (
    <Drawer
      open={open}
      onClose={() => {
        form.resetFields()
        onClose()
      }}
      width={640}
      title={initialKey ? 'Overwrite cache key' : 'Set cache key'}
      destroyOnHidden
      extra={
        <Space>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="primary" onClick={() => form.submit()}>
            Save
          </Button>
        </Space>
      }
    >
      <Alert
        type="warning"
        showIcon
        className="mb-4"
        title="Overwrites the whole value."
        description="Only string keys can be written from this panel. Existing hash/list/set keys must be deleted first."
      />
      <Form form={form} layout="vertical" onFinish={(v) => void submit(v)}>
        <Form.Item name="key" label="Key" rules={[{ required: true, message: 'Key is required' }]}>
          <Input placeholder="session:preview" disabled={!!initialKey} style={{ fontFamily: 'monospace' }} />
        </Form.Item>
        <Form.Item name="value" label="Value (JSON)" rules={[jsonValueRule]}>
          <Input.TextArea rows={10} placeholder='{"hello":"world"}' style={{ fontFamily: 'monospace' }} />
        </Form.Item>
        <Form.Item name="ttl" label="TTL (seconds)" tooltip={`Defaults to ${DEFAULT_TTL} when omitted.`}>
          <InputNumber min={1} style={{ inlineSize: '100%' }} />
        </Form.Item>
      </Form>
    </Drawer>
  )
}
