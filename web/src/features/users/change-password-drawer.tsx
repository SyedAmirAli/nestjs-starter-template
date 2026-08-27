import { Alert, App, Button, Drawer, Form, Input, Space, Typography } from 'antd'
import { isApiError } from '../../lib/api'
import { resetUserPassword, type AdminUser } from './api'

interface FormValues {
  password: string
  confirm: string
}

export function ChangePasswordDrawer({
  open,
  user,
  onClose,
}: {
  open: boolean
  user: AdminUser | null
  onClose: () => void
}) {
  const [form] = Form.useForm<FormValues>()
  const { message } = App.useApp()

  const submit = async (values: FormValues) => {
    if (!user) return
    try {
      await resetUserPassword(user.id, values.password)
      message.success('Password reset — the user must sign in again')
      form.resetFields()
      onClose()
    } catch (error: unknown) {
      message.error(isApiError(error) ? error.message : 'Could not reset password')
    }
  }

  return (
    <Drawer
      title={user ? `Reset password — ${user.name}` : 'Reset password'}
      width={440}
      open={open}
      onClose={onClose}
      destroyOnHidden
      extra={
        <Space>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="primary" danger onClick={() => form.submit()}>
            Reset password
          </Button>
        </Space>
      }
    >
      <Alert
        type="warning"
        showIcon
        className="mb-4"
        title="This signs the user out everywhere"
        description="Setting a new password invalidates all of the user's active sessions. Restricted to protected system administrators."
      />

      {user && (
        <Typography.Paragraph type="secondary">
          Account: <Typography.Text code>{user.email}</Typography.Text>
        </Typography.Paragraph>
      )}

      <Form<FormValues> form={form} layout="vertical" requiredMark="optional" onFinish={(v) => void submit(v)}>
        <Form.Item
          name="password"
          label="New password"
          rules={[
            { required: true, message: 'Password is required' },
            { min: 8, message: 'At least 8 characters' },
          ]}
        >
          <Input.Password placeholder="At least 8 characters" autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          name="confirm"
          label="Confirm password"
          dependencies={['password']}
          rules={[
            { required: true, message: 'Please confirm the password' },
            ({ getFieldValue }) => ({
              validator: (_, value: string) =>
                !value || getFieldValue('password') === value
                  ? Promise.resolve()
                  : Promise.reject(new Error('Passwords do not match')),
            }),
          ]}
        >
          <Input.Password placeholder="Re-enter the new password" autoComplete="new-password" />
        </Form.Item>
      </Form>
    </Drawer>
  )
}
