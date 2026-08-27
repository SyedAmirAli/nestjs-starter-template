import { App, Alert, DatePicker, Form, InputNumber, Modal } from 'antd'
import { isApiError } from '../../lib/api'
import { purgeAuditLogs } from './api'

const DEFAULT_LIMIT = 5000

interface PurgeForm {
  before: { toISOString: () => string } | null
  limit?: number
}

export function PurgeModal({
  open,
  onClose,
  onPurged,
}: {
  open: boolean
  onClose: () => void
  onPurged: () => void
}) {
  const [form] = Form.useForm<PurgeForm>()
  const { message } = App.useApp()

  const submit = async (values: PurgeForm) => {
    if (!values.before) return
    try {
      const result = await purgeAuditLogs({ before: values.before.toISOString(), limit: values.limit })
      const cap = values.limit ?? DEFAULT_LIMIT
      message.success(
        result.data.deleted >= cap
          ? `Purged ${result.data.deleted} entries (hit the cap — run again to continue).`
          : `Purged ${result.data.deleted} entries.`,
      )
      form.resetFields()
      onPurged()
      onClose()
    } catch (error: unknown) {
      message.error(isApiError(error) ? error.message : 'Purge failed')
    }
  }

  return (
    <Modal
      open={open}
      title="Purge audit logs"
      okText="Purge"
      okButtonProps={{ danger: true }}
      onCancel={() => {
        form.resetFields()
        onClose()
      }}
      onOk={() => form.submit()}
      destroyOnHidden
    >
      <Alert
        type="warning"
        showIcon
        className="mb-4"
        title="This permanently deletes audit history."
        description={`Rows created strictly before the chosen date are deleted, up to the cap (default ${DEFAULT_LIMIT}). This cannot be undone.`}
      />
      <Form form={form} layout="vertical" onFinish={(v) => void submit(v)} requiredMark={false}>
        <Form.Item
          name="before"
          label="Delete entries created before"
          rules={[{ required: true, message: 'Pick a cut-off date.' }]}
        >
          <DatePicker showTime placeholder="Cut-off" style={{ inlineSize: '100%' }} />
        </Form.Item>
        <Form.Item
          name="limit"
          label="Safety cap"
          tooltip={`Max rows deleted in one call. Server default is ${DEFAULT_LIMIT}.`}
        >
          <InputNumber min={1} placeholder={String(DEFAULT_LIMIT)} style={{ inlineSize: '100%' }} />
        </Form.Item>
      </Form>
    </Modal>
  )
}
