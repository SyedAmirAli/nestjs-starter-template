import { Module } from '@nestjs/common';
import { CacheManagementController } from './cache-management.controller';
import { CacheManagementService } from './cache-management.service';

@Module({
    controllers: [CacheManagementController],
    providers: [CacheManagementService],
})
export class CacheManagementModule {}
