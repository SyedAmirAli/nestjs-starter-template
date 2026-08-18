import { Body, Controller, Get, Post, Put, SetMetadata } from '@nestjs/common';
import { AllowAnonymous, Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { auth } from '@/auth/auth';
import { AuthService } from '@/auth/auth.service';
import { UserRegistryService } from '@/auth/user-registry.service';
import { AccountDeletionService } from '@/auth/account-deletion.service';
import { RegisterDto } from '@/auth/dto/register.dto';
import { UpsertUserMetaDto } from '@/auth/dto/upsert-user-meta.dto';
import { ConfirmAccountDeletionDto } from '@/auth/dto/confirm-account-deletion.dto';
import { ApiSuccessMeta } from '@/common/responses';

/**
 * Sign-in, sign-up and session management itself are handled by Better Auth's own mounted
 * router at /api/auth/*. This controller carries only what sits alongside it: the
 * convenience registration wrapper (so registration failures use this app's error envelope),
 * the "who am I" read, settings, and the OTP-gated self-service deletion flow.
 *
 * `@AllowAnonymous()` at class level with `@SetMetadata('PUBLIC', false)` per route is the
 * Better Auth adapter's opt-out shape — the class-level decorator would otherwise make every
 * route below public, and only `register` should be.
 */
@ApiTags('Auth')
@Controller('auth')
@AllowAnonymous()
export class AuthController {
    constructor(
        private readonly authService: AuthService,
        private readonly userRegistry: UserRegistryService,
        private readonly accountDeletion: AccountDeletionService,
    ) {}

    @Post('register')
    @ApiOperation({ summary: 'Create an account with email and password.' })
    @ApiSuccessMeta({ message: 'Registration successful', localeKey: 'created.auth.register' })
    register(@Body() dto: RegisterDto) {
        return this.authService.register(dto);
    }

    @Get('me')
    @SetMetadata('PUBLIC', false)
    @ApiOperation({ summary: 'The signed-in user and their settings, read fresh from the database.' })
    me(@Session() session: UserSession<typeof auth>) {
        return this.authService.getCurrentUser(session);
    }

    @Get('me/settings')
    @SetMetadata('PUBLIC', false)
    @ApiOperation({ summary: 'Account settings (theme, locale, timezone, email preferences).' })
    getMeta(@Session() session: UserSession<typeof auth>) {
        return this.userRegistry.getMeta(session.user.id);
    }

    @Put('me/settings')
    @SetMetadata('PUBLIC', false)
    @ApiOperation({
        summary: 'Update account settings',
        description: 'Partial: omitted fields are left unchanged, an explicit null clears the field.',
    })
    @ApiSuccessMeta({ message: 'Settings saved successfully', localeKey: 'updated.auth.settings' })
    upsertMeta(@Session() session: UserSession<typeof auth>, @Body() dto: UpsertUserMetaDto) {
        return this.userRegistry.upsertMeta(session.user.id, dto);
    }

    @Post('account/delete/request-otp')
    @SetMetadata('PUBLIC', false)
    @ApiOperation({ summary: 'Email a one-time code to confirm account deletion.' })
    requestAccountDeletionOtp(@Session() session: UserSession<typeof auth>) {
        return this.accountDeletion.requestOtp(session);
    }

    @Post('account/delete/confirm')
    @SetMetadata('PUBLIC', false)
    @ApiOperation({
        summary: 'Verify the code and permanently delete the account and all owned data.',
        description:
            'Irreversible. Snapshots the full user record to the audit log and sweeps every stored ' +
            'object under the user prefix before deleting the row.',
    })
    confirmAccountDeletion(@Session() session: UserSession<typeof auth>, @Body() dto: ConfirmAccountDeletionDto) {
        return this.accountDeletion.confirmAndDelete(session, dto.otp);
    }
}
