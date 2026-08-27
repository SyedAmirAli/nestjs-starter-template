import { Button, Result } from 'antd';
import { useNavigate } from '@tanstack/react-router';

/**
 * Reached by client-side routing only. The server answers every unmatched `/admin` path with
 * the SPA shell (history fallback), so a mistyped URL lands here rather than on a server 404
 * — which is the point of the fallback, but does mean this page is the one that has to say so.
 */
export function NotFoundPage() {
    const navigate = useNavigate();

    return (
        <Result
            status="404"
            title="Page not found"
            subTitle="No console route matches this URL."
            extra={
                <Button type="primary" onClick={() => void navigate({ to: '/' })}>
                    Back to overview
                </Button>
            }
        />
    );
}
