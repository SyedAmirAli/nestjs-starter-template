import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';
import { RedisProvider } from './redis.provider';
import { RedisStatusService } from './redis-status.service';
import { RedisControlService } from './control';

@Global()
@Module({
    providers: [RedisProvider, RedisService, RedisStatusService, RedisControlService],
    exports: [RedisProvider, RedisService, RedisStatusService, RedisControlService],
})
export class RedisModule {}
