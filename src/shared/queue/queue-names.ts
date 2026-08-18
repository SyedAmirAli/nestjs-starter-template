/**
 * Canonical BullMQ queue topology.
 *
 * One queue per kind of work rather than one shared queue, so concurrency, retries and
 * dead-letter handling can be tuned independently. That separation is load-bearing here:
 * a PDF render is CPU-bound and takes seconds, an LLM call is IO-bound and takes tens of
 * seconds, and a 40-second tailoring job sharing a queue with field-level rewrites would
 * make the "fast lane" anything but.
 *
 * The rule for what belongs on a queue at all: anything that calls an LLM or renders a PDF.
 * Everything else is synchronous. Chat is the single exception — it streams over SSE,
 * because the design shows token-by-token output and a queue cannot deliver that.
 */
export enum QueueName {
    // Ingestion — a document in, structured profile data out.
    ResumeParse = 'resume.parse',
    JobDescriptionParse = 'jobpost.parse',

    // Analysis
    ResumeAnalyze = 'resume.analyze',
    MatchAnalyze = 'match.analyze',

    // Generation
    ResumeTailor = 'resume.tailor',
    CoverLetterGenerate = 'letter.generate',
    EmailGenerate = 'email.generate',
    /** Field-level AI rewrites (a bullet, a summary). Its own queue so a 40s tailoring job
     *  can never sit in front of a 3s rewrite the user is watching. */
    FieldRewrite = 'ai.field-rewrite',

    // Rendering
    RenderPdf = 'render.pdf',

    // Account data lifecycle
    BackupBuild = 'backup.build',
    BackupRestore = 'backup.restore',
    DataExport = 'account.export',
    AccountDelete = 'account.delete',

    // Integrations
    GmailDraft = 'integration.gmail-draft',

    // Housekeeping — cron-driven, see the purge/reconcile jobs.
    NotificationDispatch = 'notification.dispatch',
    PurgeExpiredFiles = 'maintenance.purge-files',
    StorageReconcile = 'maintenance.storage-reconcile',
}

export const ALL_QUEUE_NAMES: QueueName[] = Object.values(QueueName);

/** Dead-letter queue name for a given queue. */
export function deadLetterName(name: QueueName | string): string {
    return `${name}.dead`;
}
