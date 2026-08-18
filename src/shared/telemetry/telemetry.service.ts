import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@/generated/prisma/client';
import { ModelCallFeature, ModelCallOperation } from '@/generated/prisma/enums';
import { PrismaService } from '@/prisma/prisma.service';

export type ModelCallRecord = {
    operation: 'message' | 'structured' | 'stream' | 'embed' | 'rerank';
    model: string;
    latencyMs: number;
    ok: boolean;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    /** Provider cost in micro-dollars (1e-6 USD). Integer cents lose too much precision when
     *  a single call costs $0.0004; a float would accumulate drift across a month of sums. */
    costMicroUsd?: number;
    error?: string;
};

/**
 * Per-call attribution for the `model_calls` table.
 *
 * `userId` is required, unlike an audit actor: every AI call in this system originates from
 * an authenticated user action, and this table is load-bearing for the monthly spend cap,
 * not just a trail. A call with no owner cannot be billed to anyone, so there is no such call.
 */
export type ModelCallContext = {
    userId: string;
    feature: ModelCallFeature;
    /** The job or resource that occasioned the call — a resume id, an application id. */
    subjectId?: string | null;
    /** Free-form breadcrumb, e.g. { purpose: 'summary_rewrite' }. Stored as metaJson. */
    meta?: Record<string, unknown>;
};

/**
 * Central hook for model-call telemetry and the AI cost ledger.
 *
 * Every AI call logs to the app logger AND persists a row in `model_calls`. Spend for a
 * period is computed ON DEMAND by summing rows here — never denormalized onto a counter,
 * which drifts the first time a write is retried or a job is replayed.
 */
@Injectable()
export class TelemetryService {
    private readonly logger = new Logger('Telemetry');

    constructor(private readonly prisma: PrismaService) {}

    recordModelCall(record: ModelCallRecord): void {
        const tokens = record.totalTokens != null ? ` tokens=${record.totalTokens}` : '';
        const cost = record.costMicroUsd != null ? ` cost=$${(record.costMicroUsd / 1e6).toFixed(6)}` : '';
        const status = record.ok ? 'ok' : `ERR(${record.error ?? 'unknown'})`;
        this.logger.log(`model=${record.model} op=${record.operation} ${record.latencyMs}ms${tokens}${cost} ${status}`);
    }

    /**
     * Times an async model call and records the outcome.
     *
     * Failures get a row too (`ok: false`). A provider error still consumed input tokens and
     * still cost money, and a month where the cap was hit entirely by retried failures is
     * exactly the month you need the data for.
     */
    async measure<T>(
        operation: ModelCallRecord['operation'],
        model: string,
        fn: () => Promise<{
            result: T;
            usage?: { prompt?: number; completion?: number; total?: number; costMicroUsd?: number };
        }>,
        context: ModelCallContext,
    ): Promise<T> {
        const start = Date.now();

        try {
            const { result, usage } = await fn();
            const record: ModelCallRecord = {
                operation,
                model,
                latencyMs: Date.now() - start,
                ok: true,
                promptTokens: usage?.prompt,
                completionTokens: usage?.completion,
                totalTokens: usage?.total,
                costMicroUsd: usage?.costMicroUsd,
            };
            this.recordModelCall(record);
            void this.persistModelCall(record, context);
            return result;
        } catch (error) {
            const record: ModelCallRecord = {
                operation,
                model,
                latencyMs: Date.now() - start,
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            };
            this.recordModelCall(record);
            void this.persistModelCall(record, context);
            throw error;
        }
    }

    /**
     * Public because a streamed chat reply cannot go through `measure()` — token counts and
     * cost only arrive in the final SSE event, after the caller has already been handing
     * chunks to the client. That caller invokes this once the stream ends.
     *
     * Never throws: a telemetry write must not break the AI call it describes.
     */
    async persistModelCall(record: ModelCallRecord, context: ModelCallContext): Promise<void> {
        try {
            await this.prisma.modelCall.create({
                data: {
                    userId: context.userId,
                    feature: context.feature,
                    operation: record.operation.toUpperCase() as ModelCallOperation,
                    model: record.model,
                    subjectId: context.subjectId ?? null,
                    promptTokens: record.promptTokens ?? null,
                    completionTokens: record.completionTokens ?? null,
                    totalTokens: record.totalTokens ?? null,
                    costMicroUsd: record.costMicroUsd ?? null,
                    latencyMs: record.latencyMs,
                    ok: record.ok,
                    errorText: record.error ?? null,
                    metaJson: (context.meta as Prisma.InputJsonValue) ?? undefined,
                },
            });
        } catch (error) {
            this.logger.error(
                `Failed to write model_calls row (${record.operation} ${record.model}): ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
        }
    }

    /**
     * Total spend since `since`, in USD. Optionally scoped to one user.
     *
     * Backs both the global monthly cap (AI_MONTHLY_COST_CAP_USD) and per-user quota, so the
     * two can never disagree about what a call cost — they read the same rows.
     */
    async spendSince(since: Date, userId?: string): Promise<number> {
        const result = await this.prisma.modelCall.aggregate({
            where: { createdAt: { gte: since }, ...(userId ? { userId } : {}) },
            _sum: { costMicroUsd: true },
        });

        return (result._sum.costMicroUsd ?? 0) / 1e6;
    }
}
