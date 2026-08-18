import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { TelemetryService } from './telemetry.service';

/**
 * Global because every AI call site needs it and none of them should have to import a module
 * to record that a call happened — telemetry that is easy to skip does not get written.
 */
@Global()
@Module({
    imports: [PrismaModule],
    providers: [TelemetryService],
    exports: [TelemetryService],
})
export class TelemetryModule {}
