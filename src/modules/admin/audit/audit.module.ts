import { Global, Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

/**
 * Global so any feature module can inject AuditService without importing AuditModule.
 * Writes are best-effort (`log` never throws to callers).
 */
@Global()
@Module({
    controllers: [AuditController],
    providers: [AuditService],
    exports: [AuditService],
})
export class AuditModule {}
