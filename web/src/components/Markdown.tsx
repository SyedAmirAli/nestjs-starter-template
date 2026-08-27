import { useMemo, type CSSProperties } from 'react';
import { theme } from 'antd';
import DOMPurify, { type Config } from 'dompurify';
import { Marked } from 'marked';
import './Markdown.css';

/**
 * Renders markdown from source text that may not be fully trusted (a page description written
 * by another admin, a chunk of imported content, …). Two rules make that safe, and both live
 * here so no call site can skip them:
 *
 *  1. `marked` is configured to escape raw HTML rather than pass it through, so a `<script>`
 *     in the source renders as visible text.
 *  2. DOMPurify sanitizes the result anyway — belt and braces, since (1) is a parser setting
 *     one refactor away from being flipped.
 *
 * This is the only place in the console that uses dangerouslySetInnerHTML. Keep it that way.
 */

/** A private instance, not the global `marked` — nothing else in the app should share config. */
const md = new Marked({
    async: false,
    breaks: true,
    gfm: true,
});

/** Links are the one tag worth allowing; force them safe rather than dropping them. */
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer nofollow');
    }
});

const SANITIZE_CONFIG: Config = {
    // An allowlist, not a blocklist: anything not named here is stripped.
    ALLOWED_TAGS: [
        'p',
        'br',
        'hr',
        'strong',
        'em',
        'del',
        'code',
        'pre',
        'blockquote',
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'ul',
        'ol',
        'li',
        'a',
        'table',
        'thead',
        'tbody',
        'tr',
        'th',
        'td',
    ],
    ALLOWED_ATTR: ['href', 'title', 'target', 'rel', 'align'],
    // No <img>: an outbound request to a URL the source text chose is a tracking pixel with
    // extra steps.
    FORBID_TAGS: ['img', 'script', 'style', 'iframe', 'form', 'input'],
    ALLOW_DATA_ATTR: false,
};

export function Markdown({ source }: { source: string }) {
    const { token } = theme.useToken();

    const html = useMemo(() => {
        // `async: false` above guarantees a string, but the type is string | Promise.
        const parsed = md.parse(source) as string;
        return DOMPurify.sanitize(parsed, SANITIZE_CONFIG);
    }, [source]);

    return (
        <div
            className="bt-md"
            style={
                {
                    '--bt-md-border': token.colorBorder,
                    '--bt-md-fill': token.colorFillQuaternary,
                    '--bt-md-primary': token.colorPrimary,
                    '--bt-md-text-secondary': token.colorTextSecondary,
                    '--bt-md-font-code': token.fontFamilyCode,
                } as CSSProperties
            }
            dangerouslySetInnerHTML={{ __html: html }}
        />
    );
}
