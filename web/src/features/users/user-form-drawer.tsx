import { useEffect } from 'react'
import { App, Button, Drawer, Form, Input, Select, Space } from 'antd'
import { isApiError } from '../../lib/api'
import { USER_ROLES, createUser, updateUser, type AdminUser, type UserRole } from './api'

interface FormValues {
  email: string
  name: string
  password?: string
  role: UserRole
}

export function UserFormDrawer({
  open,
  mode,
  user,
  onClose,
  onSaved,
}: {
  open: boolean
  mode: 'create' | 'edit'
  user?: AdminUser
  onClose: () => void
  onSaved: () => void
}) {
  const [form] = Form.useForm<FormValues>()
  const { message } = App.useApp()

  useEffect(() => {
    if (!open) return
    if (mode === 'edit' && user) {
      form.setFieldsValue({ name: user.name, email: user.email, role: user.role })
    } else {
      form.resetFields()
      form.setFieldsValue({ role: 'USER' })
    }
  }, [open, mode, user, form])

  const submit = async (values: FormValues) => {
    try {
      if (mode === 'create') {
        const result = await createUser({
          email: values.email,
          name: values.name,
          password: values.password ?? '',
          role: values.role,
        })
        message.success(result.message)
      } else if (user) {
        const result = await updateUser(user.id, { name: values.name, role: values.role })
        message.success(result.message)
      }
      onSaved()
      onClose()
    } catch (error: unknown) {
      message.error(isApiError(error) ? error.message : 'Could not save the user')
    }
  }

  return (
    <Drawer
      title={mode === 'create' ? 'Create user' : `Edit — ${user?.name ?? ''}`}
      width={440}
      open={open}
      onClose={onClose}
      destroyOnHidden
      extra={
        <Space>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="primary" onClick={() => form.submit()}>
            {mode === 'create' ? 'Create' : 'Save'}
          </Button>
        </Space>
      }
    >
      <Form<FormValues> form={form} layout="vertical" requiredMark="optional" onFinish={(v) => void submit(v)}>
        <Form.Item
          name="email"
          label="Email"
          rules={[
            { required: true, message: 'Email is required' },
            { type: 'email', message: 'Enter a valid email' },
          ]}
        >
          <Input placeholder="user@example.com" autoComplete="off" disabled={mode === 'edit'} />
        </Form.Item>
        <Form.Item name="name" label="Name" rules={[{ required: true, message: 'Name is required' }]}>
          <Input placeholder="Ada Lovelace" />
        </Form.Item>
        {mode === 'create' && (
          <Form.Item
            name="password"
            label="Password"
            rules={[
              { required: true, message: 'Password is required' },
              { min: 8, message: 'At least 8 characters' },
            ]}
          >
            <Input.Password placeholder="At least 8 characters" autoComplete="new-password" />
          </Form.Item>
        )}
        <Form.Item name="role" label="Role" rules={[{ required: true }]}>
          <Select options={USER_ROLES.map((role) => ({ value: role, label: role }))} />
        </Form.Item>
      </Form>
    </Drawer>
  )
}
