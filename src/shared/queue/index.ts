export { QueueModule } from './queue.module';
export { QueueService, DEFAULT_JOB_OPTIONS } from './queue.service';
export type { DeadLetterRecord } from './queue.service';
export { BaseWorker } from './base.worker';
export { QueueName, ALL_QUEUE_NAMES, deadLetterName } from './queue-names';
export { createRedisConnection, bullRedisOptions } from './redis.connection';
