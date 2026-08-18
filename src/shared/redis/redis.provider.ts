import { REDIS_CLIENT, REDIS_DB, REDIS_HOST, REDIS_PASSWORD, REDIS_PORT, REDIS_USERNAME } from '@/config/dotenv';
import { Provider } from '@nestjs/common';
import Redis from 'ioredis';

export const RedisProvider: Provider = {
    provide: REDIS_CLIENT,
    useFactory() {
        return new Redis({
            host: REDIS_HOST,
            port: REDIS_PORT,
            password: REDIS_PASSWORD,
            username: REDIS_USERNAME,
            db: REDIS_DB,
            maxRetriesPerRequest: null,
            reconnectOnError: () => true,
        });
    },
};
