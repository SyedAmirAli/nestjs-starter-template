import { App, Alert, AutoComplete, Button, Drawer, Form, Input, Select, Space } from 'antd'
import { isApiError } from '../../lib/api'
import { AUDIT_ACTIONS, AUDIT_RESOURCES, createAuditLog, type AuditAction } from './api'

interface NoteForm {
  action: AuditAction
  resource: string
  resourceId?: string
  summary?: string
}

export function AuditNoteDrawer({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: () => void
}) {
  const [form] = Form.useForm<NoteForm>()
  const { message } = App.useApp()

  const submit = async (values: NoteForm) => {
    try {
      await createAuditLog({
        action: values.action,
        resource: values.resource,
        resourceId: values.resourceId || null,
        summary: values.summary || null,
      })
      message.success('Audit note created')
      form.resetFields()
      onCreated()
      onClose()
    } catch (error: unknown) {
      message.error(isApiError(error) ? error.message : 'Could not create the note')
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={520}
      title="Add audit note"
      destroyOnHidden
      extra={
        <Space>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="primary" onClick={() => form.submit()}>
            Create
          </Button>
        </Space>
      }
    >
      <Alert
        type="info"
        showIcon
        className="mb-4"
        title="For backfill and manual notes only."
        description="Actions taken through the panel already write their own audit entries automatically."
      />
      <Form form={form} layout="vertical" onFinish={(v) => void submit(v)} initialValues={{ action: 'OTHER' }}>
        <Form.Item name="action" label="Action" rules={[{ required: true }]}>
          <Select options={AUDIT_ACTIONS.map((action) => ({ value: action, label: action }))} />
        </Form.Item>
        <Form.Item name="resource" label="Resource" rules={[{ required: true, message: 'Resource is required.' }]}>
          <AutoComplete
            placeholder="e.g. user"
            options={AUDIT_RESOURCES.map((resource) => ({ value: resource }))}
            filterOption={(input, option) =>
              String(option?.value ?? '')
                .toLowerCase()
                .includes(input.toLowerCase())
            }
          />
        </Form.Item>
        <Form.Item name="resourceId" label="Resource ID">
          <Input placeholder="Optional" />
        </Form.Item>
        <Form.Item name="summary" label="Summary">
          <Input.TextArea rows={2} placeholder="What happened, in one line" />
        </Form.Item>
      </Form>
    </Drawer>
  )
}
