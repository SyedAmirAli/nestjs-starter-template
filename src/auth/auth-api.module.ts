import { Module } from '@nestjs/common';
import { AuthController } from '@/auth/auth.controller';
import { AuthService } from '@/auth/auth.service';
import { UserRegistryService } from '@/auth/user-registry.service';
import { AccountDeletionService } from '@/auth/account-deletion.service';

@Module({
    controllers: [AuthController],
    providers: [AuthService, UserRegistryService, AccountDeletionService],
    exports: [UserRegistryService],
})
export class AuthApiModule {}
