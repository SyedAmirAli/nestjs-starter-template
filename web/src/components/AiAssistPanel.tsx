import { useEffect, useMemo, useRef, useState } from 'react';
import { App, Button, Drawer, Empty, Input, Segmented, Space, Tag, Typography, theme } from 'antd';
import { RobotOutlined, SendOutlined, ThunderboltOutlined } from '@ant-design/icons';

/** One field the AI can fill or translate, described as data — never as instructions. */
export interface AiAssistField {
    key: string;
    label: string;
    type?: string;
    description?: string;
    example?: string;
    currentValue?: string;
}

/** A prior conversation turn — replay history each request if your backend is stateless. */
export interface AiAssistTurn {
    role: 'user' | 'assistant';
    content: string;
}

export interface AiAssistResult {
    /** Generated value per requested field key. */
    values: Record<string, string>;
    /** Short assistant chat reply, shown above the field cards. */
    reply: string;
    /** Field keys this reply actually targeted (usually `fields.map(f => f.key)`). */
    targetFieldKeys: Array<string>;
}

/** One rendered entry in the chat log. */
type LogItem =
    | { id: string; role: 'user'; text: string }
    | { id: string; role: 'assistant'; reply: string; values: Record<string, string>; keys: Array<string> };

let seq = 0;
const nextId = () => `aiassist-${++seq}`;

export interface AiAssistPanelProps {
    open: boolean;
    onClose: () => void;
    /** Drawer title. Defaults to "Fill with AI". Pass e.g. "Translate with AI" for a translation use case. */
    title?: string;
    /** Fillable/translatable fields of the form. */
    fields: Array<AiAssistField>;
    /**
     * You own the request — call your own endpoint here and resolve with the generated values.
     * `targetFieldKeys` is set when the user asked to regenerate a single field; omit/undefined
     * means "all fields".
     */
    onSend: (args: {
        instruction: string;
        targetFieldKeys?: Array<string>;
        history: Array<AiAssistTurn>;
        language?: string;
    }) => Promise<AiAssistResult>;
    /** Inject one generated value into the form. */
    onInject: (key: string, value: string) => void;
    /** Inject every generated value at once. Omit to hide the "Apply all" button. */
    onInjectAll?: (values: Record<string, string>) => void;
    /**
     * Optional language/target toggle — e.g. translation target language. Omit to hide the
     * control entirely (a plain "fill this form" panel doesn't need one).
     */
    languageOptions?: Array<{ label: string; value: string }>;
    defaultLanguage?: string;
    placeholder?: string;
    emptyHint?: string;
}

/**
 * A chat panel for AI-assisted form filling or translation: the admin describes what they want
 * (or picks a target language), the AI proposes a value per field, and each field gets its own
 * "Inject" button (latest value wins) plus an optional "apply all". Regenerating a single field
 * or refining conversationally is the same request with a different target set.
 *
 * Deliberately has no idea what backend it's talking to — wire `onSend` to whatever endpoint
 * your project exposes (a "fill this form" assistant, a translation suggester, …).
 */
export function AiAssistPanel({
    open,
    onClose,
    title = 'Fill with AI',
    fields,
    onSend,
    onInject,
    onInjectAll,
    languageOptions,
    defaultLanguage,
    placeholder = 'Describe what you want…',
    emptyHint,
}: AiAssistPanelProps) {
    const { token } = theme.useToken();
    const { message: toast } = App.useApp();
    const [input, setInput] = useState('');
    const [language, setLanguage] = useState(defaultLanguage ?? languageOptions?.[0]?.value);
    const [log, setLog] = useState<Array<LogItem>>([]);
    const [history, setHistory] = useState<Array<AiAssistTurn>>([]);
    const [latest, setLatest] = useState<Record<string, string>>({});
    const [pending, setPending] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    const labelByKey = useMemo(() => new Map(fields.map((f) => [f.key, f.label])), [fields]);

    const resetConversation = () => {
        setLog([]);
        setHistory([]);
        setLatest({});
        setInput('');
    };

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }, [log]);

    const send = (instruction: string, targetFieldKeys?: Array<string>) => {
        const text = instruction.trim();
        if (!text || pending) return;
        setLog((l) => [...l, { id: nextId(), role: 'user', text }]);
        setInput('');
        setPending(true);
        onSend({ instruction: text, targetFieldKeys, history, language })
            .then((res) => {
                setLog((l) => [
                    ...l,
                    {
                        id: nextId(),
                        role: 'assistant',
                        reply: res.reply,
                        values: res.values,
                        keys: res.targetFieldKeys,
                    },
                ]);
                setHistory((h) => [
                    ...h,
                    { role: 'user', content: text },
                    { role: 'assistant', content: res.reply || JSON.stringify(res.values) },
                ]);
                setLatest((prev) => ({ ...prev, ...res.values }));
            })
            .catch((e: unknown) => {
                toast.error(e instanceof Error ? e.message : 'AI request failed');
            })
            .finally(() => setPending(false));
    };

    const injectAll = (values: Record<string, string>) => {
        onInjectAll?.(values);
        toast.success('All fields applied');
    };

    return (
        <Drawer
            title={
                <Space>
                    <RobotOutlined />
                    <span>{title}</span>
                </Space>
            }
            size={480}
            open={open}
            onClose={onClose}
            afterOpenChange={(opened) => opened && resetConversation()}
            styles={{ body: { display: 'flex', flexDirection: 'column', padding: 0, height: '100%' } }}
        >
            {/* message log */}
            <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
                {log.length === 0 && (
                    <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description={
                            <Typography.Text type="secondary">
                                {emptyHint ??
                                    `Describe what you want and I’ll draft the ${fields.length} field${fields.length === 1 ? '' : 's'} for you.`}
                            </Typography.Text>
                        }
                    />
                )}

                <Space direction="vertical" size={12} style={{ inlineSize: '100%' }}>
                    {log.map((item) =>
                        item.role === 'user' ? (
                            <div key={item.id} style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                <div
                                    style={{
                                        maxInlineSize: '85%',
                                        background: token.colorPrimary,
                                        color: token.colorWhite,
                                        padding: '8px 12px',
                                        borderRadius: 12,
                                        borderBottomRightRadius: 2,
                                    }}
                                >
                                    {item.text}
                                </div>
                            </div>
                        ) : (
                            <div key={item.id} style={{ display: 'flex', justifyContent: 'flex-start' }}>
                                <div
                                    style={{
                                        maxInlineSize: '92%',
                                        background: token.colorFillSecondary,
                                        padding: '10px 12px',
                                        borderRadius: 12,
                                        borderBottomLeftRadius: 2,
                                        inlineSize: '100%',
                                    }}
                                >
                                    {item.reply && (
                                        <div style={{ marginBottom: item.keys.length ? 10 : 0 }}>{item.reply}</div>
                                    )}

                                    <Space direction="vertical" size={8} style={{ inlineSize: '100%' }}>
                                        {item.keys.map((key) => (
                                            <div
                                                key={key}
                                                style={{
                                                    background: token.colorBgContainer,
                                                    border: `1px solid ${token.colorBorderSecondary}`,
                                                    borderRadius: 8,
                                                    padding: '8px 10px',
                                                }}
                                            >
                                                <div
                                                    style={{
                                                        display: 'flex',
                                                        justifyContent: 'space-between',
                                                        gap: 8,
                                                        alignItems: 'center',
                                                    }}
                                                >
                                                    <Typography.Text strong style={{ fontSize: 12 }}>
                                                        {labelByKey.get(key) ?? key}
                                                    </Typography.Text>
                                                    <Space size={4}>
                                                        <Button
                                                            size="small"
                                                            type="text"
                                                            onClick={() =>
                                                                send(
                                                                    `Regenerate the "${labelByKey.get(key) ?? key}" field.`,
                                                                    [key],
                                                                )
                                                            }
                                                            disabled={pending}
                                                        >
                                                            Regenerate
                                                        </Button>
                                                        <Button
                                                            size="small"
                                                            type="primary"
                                                            onClick={() => onInject(key, item.values[key] ?? '')}
                                                            disabled={!item.values[key]}
                                                        >
                                                            Inject
                                                        </Button>
                                                    </Space>
                                                </div>
                                                <Typography.Paragraph
                                                    type="secondary"
                                                    style={{ margin: '4px 0 0', fontSize: 13, whiteSpace: 'pre-wrap' }}
                                                    ellipsis={{ rows: 3, expandable: true, symbol: 'more' }}
                                                >
                                                    {item.values[key] || <Tag>empty</Tag>}
                                                </Typography.Paragraph>
                                            </div>
                                        ))}
                                    </Space>

                                    {onInjectAll && item.keys.length > 1 && (
                                        <Button
                                            block
                                            size="small"
                                            icon={<ThunderboltOutlined />}
                                            style={{ marginTop: 10 }}
                                            onClick={() => injectAll(item.values)}
                                        >
                                            Apply all {item.keys.length} fields
                                        </Button>
                                    )}
                                </div>
                            </div>
                        ),
                    )}
                </Space>
            </div>

            {/* composer */}
            <div style={{ borderBlockStart: `1px solid ${token.colorBorderSecondary}`, padding: 12 }}>
                <Space direction="vertical" size={8} style={{ inlineSize: '100%' }}>
                    <Space style={{ justifyContent: 'space-between', inlineSize: '100%' }}>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            Latest values: {Object.keys(latest).length}/{fields.length}
                        </Typography.Text>
                        {languageOptions && languageOptions.length > 0 && (
                            <Segmented
                                size="small"
                                value={language}
                                onChange={(v) => setLanguage(v as string)}
                                options={languageOptions}
                            />
                        )}
                    </Space>
                    <Space.Compact style={{ inlineSize: '100%' }}>
                        <Input.TextArea
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder={placeholder}
                            autoSize={{ minRows: 1, maxRows: 4 }}
                            onPressEnter={(e) => {
                                if (!e.shiftKey) {
                                    e.preventDefault();
                                    send(input);
                                }
                            }}
                        />
                        <Button type="primary" icon={<SendOutlined />} loading={pending} onClick={() => send(input)} />
                    </Space.Compact>
                </Space>
            </div>
        </Drawer>
    );
}
