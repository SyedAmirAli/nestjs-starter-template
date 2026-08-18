import { Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Worker, type Job, type WorkerOptions } from 'bullmq';
import { RUN_WORKERS_IN_PROCESS } from '@/config/dotenv';
import { bullConnection } from './redis.connection';
import type { QueueName } from './queue-names';
import type { QueueService } from './queue.service';

/**
 * Base class for BullMQ consumers. Subclasses declare their {@link queueName} and
 * implement {@link process}; the base handles connection lifecycle, structured error
 * logging, and dead-lettering of exhausted jobs.
 *
 * In development workers run in-process; in production they run as a dedicated Cloud Run
 * worker pool, so registration is gated on {@link RUN_WORKERS_IN_PROCESS}.
 */
export abstract class BaseWorker<TData = unknown, TResult = unknown> implements OnModuleInit, OnModuleDestroy {
    protected abstract readonly queueName: QueueName;
    protected readonly concurrency: number = 1;
    protected readonly logger = new Logger(this.constructor.name);
    private worker?: Worker<TData, TResult>;

    constructor(protected readonly queueService: QueueService) {}

    /** Implement the actual job handling here. Throwing triggers BullMQ retry/backoff. */
    abstract process(job: Job<TData, TResult>): Promise<TResult>;

    onModuleInit(): void {
        if (!RUN_WORKERS_IN_PROCESS) {
            this.logger.log(`Worker for ${this.queueName} not started (out-of-process mode)`);
            return;
        }

        const options: WorkerOptions = { connection: bullConnection, concurrency: this.concurrency };
        this.worker = new Worker<TData, TResult>(this.queueName, (job) => this.process(job), options);

        this.worker.on('failed', (job, err) => {
            this.logger.error(`Job ${job?.id} on ${this.queueName} failed: ${err?.message}`);
            const exhausted = job && job.attemptsMade >= (job.opts.attempts ?? 1);
            if (job && exhausted) {
                void this.queueService.moveToDeadLetter(this.queueName, job.data, err?.message ?? 'unknown error');
            }
        });

        this.worker.on('error', (err) => this.logger.error(`Worker error on ${this.queueName}: ${err.message}`));
        this.logger.log(`Worker started for ${this.queueName} (concurrency=${this.concurrency})`);
    }

    async onModuleDestroy(): Promise<void> {
        await this.worker?.close();
    }
}
