import { useMemo, useState } from 'react';
import { Typography } from 'antd';
import { Markdown } from './Markdown';

/**
 * A page description written in Markdown. Collapsed by default to the first two lines with a
 * "Show more" toggle; expanded it renders the full Markdown guide.
 */
export function PageDescription({ source }: { source: string }) {
    const [expanded, setExpanded] = useState(false);

    // A plain-text preview for the collapsed state: antd's line clamp needs inline text, not the
    // block markdown (<p>/<ul>/<table>) the expanded view renders.
    const preview = useMemo(() => toPlainText(source), [source]);

    return (
        <div>
            {expanded ? (
                <Markdown source={source} />
            ) : (
                <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }} ellipsis={{ rows: 2 }}>
                    {preview}
                </Typography.Paragraph>
            )}
            <Typography.Link onClick={() => setExpanded((v) => !v)} style={{ fontSize: 13 }}>
                {expanded ? 'Show less' : 'Show more'}
            </Typography.Link>
        </div>
    );
}

/** Strip the common Markdown syntax so the collapsed preview reads as clean prose. */
function toPlainText(source: string): string {
    return source
        .replace(/```[\s\S]*?```/g, '') // fenced code blocks
        .replace(/`([^`]*)`/g, '$1') // inline code
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links -> text
        .replace(/^\s{0,3}#{1,6}\s+/gm, '') // heading markers
        .replace(/^\s{0,3}>\s?/gm, '') // blockquote markers
        .replace(/^\s*[-*+]\s+/gm, '') // list bullets
        .replace(/^\s*\d+\.\s+/gm, '') // ordered list markers
        .replace(/(\*\*|__|\*|_|~~)/g, '') // emphasis marks
        .replace(/\|/g, ' ') // table pipes
        .replace(/\s+/g, ' ')
        .trim();
}
