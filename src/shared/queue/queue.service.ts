import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue, type JobsOptions } from 'bullmq';
import { bullConnection } from './redis.connection';
import { deadLetterName, QueueName } from './queue-names';

/** Sensible defaults for every job: bounded retries with exponential backoff, tidy history. */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: false,
};

export type DeadLetterRecord<T = unknown> = {
    payload: T;
    reason: string;
    failedAt: string;
};

/**
 * Producer-side queue access. Owns a shared Redis connection and lazily creates
 * BullMQ Queue instances. Workers live in {@link BaseWorker} with their own connections.
 */
@Injectable()
export class QueueService implements OnModuleDestroy {
    private readonly logger = new Logger(QueueService.name);
    private readonly queues = new Map<string, Queue>();

    /** Returns a cached Queue for the given name (creates one on first use). */
    getQueue(name: QueueName | string): Queue {
        const existing = this.queues.get(name);
        if (existing) return existing;

        const queue = new Queue(name, { connection: bullConnection });
        this.queues.set(name, queue);
        return queue;
    }

    /** Enqueues a job with the standard default options (overridable). */
    async enqueue<T>(name: QueueName, jobName: string, payload: T, opts: JobsOptions = {}) {
        return this.getQueue(name).add(jobName, payload, { ...DEFAULT_JOB_OPTIONS, ...opts });
    }

    /** Parks an exhausted/poison job in the queue's dead-letter queue for inspection. */
    async moveToDeadLetter<T>(name: QueueName, payload: T, reason: string): Promise<void> {
        const record: DeadLetterRecord<T> = { payload, reason, failedAt: new Date().toISOString() };
        await this.getQueue(deadLetterName(name)).add('dead', record, {
            attempts: 1,
            removeOnComplete: false,
            removeOnFail: false,
        });
        this.logger.warn(`Job moved to dead-letter for ${name}: ${reason}`);
    }

    async onModuleDestroy(): Promise<void> {
        await Promise.all([...this.queues.values()].map((q) => q.close()));
    }
}
