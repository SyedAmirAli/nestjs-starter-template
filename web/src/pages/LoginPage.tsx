import { useState, type ReactNode } from 'react';
import { Button, Form, Input, Typography, theme } from 'antd';
import type { GlobalToken } from 'antd/es/theme/interface';
import { getRouteApi, useNavigate, useRouter } from '@tanstack/react-router';
import { fetchCurrentUser, signIn, signOut } from '../lib/session';
import { dashboardPathFromRedirect } from '../lib/paths';

const loginRoute = getRouteApi('/login');

export function LoginPage() {
    const { user } = loginRoute.useRouteContext();
    const { redirect } = loginRoute.useSearch();
    const navigate = useNavigate();
    const router = useRouter();
    const { token } = theme.useToken();
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    if (user) {
        return (
            <AuthCard token={token}>
                <Typography.Text type="secondary" className="block text-[13px] tracking-[0.12em] uppercase">
                    base-app
                </Typography.Text>
                <Typography.Title level={3} className="mt-1.5! mb-1!">
                    Not an admin account
                </Typography.Title>
                <Typography.Paragraph type="secondary">
                    This console is restricted to administrators.
                </Typography.Paragraph>
                <div
                    className="mb-5 px-3 py-2 text-[13px] break-all"
                    style={{
                        background: token.colorBgElevated,
                        border: `1px solid ${token.colorBorderSecondary}`,
                        borderRadius: token.borderRadius,
                        color: token.colorTextTertiary,
                    }}
                >
                    Signed in as {user.email}
                </div>
                <Button
                    block
                    onClick={() => {
                        void signOut();
                    }}
                >
                    Sign out
                </Button>
            </AuthCard>
        );
    }

    return (
        <AuthCard token={token}>
            <Typography.Text type="secondary" className="block text-[13px] tracking-[0.12em] uppercase">
                base-app
            </Typography.Text>
            <Typography.Title level={3} className="mt-1.5! mb-1!">
                Admin console
            </Typography.Title>
            <Typography.Paragraph type="secondary">Sign in with an administrator account.</Typography.Paragraph>

            <Form
                layout="vertical"
                requiredMark={false}
                onFinish={({ email, password }: { email: string; password: string }) => {
                    setError(null);
                    setSubmitting(true);
                    void signIn(email.trim(), password)
                        .then(async () => {
                            const signedIn = await fetchCurrentUser();
                            if (signedIn?.role === 'ADMIN') {
                                await navigate({ to: dashboardPathFromRedirect(redirect), replace: true });
                                return;
                            }
                            // Non-admin session: re-run /login's beforeLoad so this page
                            // swaps to the "not an admin" state instead of bouncing through
                            // the dashboard gate.
                            await router.invalidate();
                        })
                        .catch((cause: unknown) => {
                            setError(
                                (cause as Error).message || 'Sign-in failed. Check your connection and try again.',
                            );
                            setSubmitting(false);
                        });
                }}
            >
                {error ? (
                    <div
                        role="alert"
                        className="mb-4 px-3 py-2"
                        style={{
                            background: token.colorErrorBg,
                            border: `1px solid ${token.colorErrorBorder}`,
                            borderRadius: token.borderRadius,
                        }}
                    >
                        {error}
                    </div>
                ) : null}

                <Form.Item
                    label="Email"
                    name="email"
                    rules={[{ required: true, type: 'email', message: 'Enter your email' }]}
                >
                    <Input autoComplete="username" autoFocus />
                </Form.Item>
                <Form.Item
                    label="Password"
                    name="password"
                    rules={[{ required: true, message: 'Enter your password' }]}
                >
                    <Input.Password autoComplete="current-password" />
                </Form.Item>
                <Form.Item className="mb-0!">
                    <Button type="primary" htmlType="submit" block loading={submitting}>
                        Sign in
                    </Button>
                </Form.Item>
            </Form>
        </AuthCard>
    );
}

function AuthCard({ children, token }: { children: ReactNode; token: GlobalToken }) {
    return (
        <div className="grid min-h-full place-items-center p-6 h-screen">
            <main
                className="w-full max-w-95 p-8"
                style={{
                    background: token.colorBgContainer,
                    border: `1px solid ${token.colorBorderSecondary}`,
                    borderRadius: token.borderRadiusLG,
                }}
            >
                {children}
            </main>
        </div>
    );
}
