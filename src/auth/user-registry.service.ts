import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '@/prisma/prisma.service';
import { Theme } from '@/generated/prisma/enums';
import type { UserMeta } from '@/generated/prisma/client';
import { UpsertUserMetaDto } from '@/auth/dto/upsert-user-meta.dto';

/** Fields the client may write. Server-managed columns are absent by construction, so a
 *  future addition to UserMeta is not writable until it is deliberately listed here. */
type UserMetaWritable = {
    theme?: Theme;
    locale?: string | null;
    timezone?: string | null;
    pageSize?: string | null;
    marketingEmails?: boolean;
    notificationEmails?: boolean;
};

@Injectable()
export class UserRegistryService {
    constructor(private readonly prisma: PrismaService) {}

    /**
     * Read the signed-in user's settings.
     *
     * The auth `user.create.after` hook seeds this row, so in practice it always exists;
     * the null case covers accounts created before that hook or by a direct DB insert.
     */
    async getMeta(userId: string): Promise<UserMeta | null> {
        return this.prisma.userMeta.findUnique({ where: { userId } });
    }

    /**
     * Create the row if missing, otherwise merge the provided fields.
     *
     * `upsert` rather than a read-then-branch: two settings writes racing from two devices
     * would otherwise both see "missing" and both attempt a create, and the loser would get
     * a unique-constraint error instead of an update.
     */
    async upsertMeta(userId: string, dto: UpsertUserMetaDto): Promise<UserMeta> {
        const data = this.toWritable(dto);

        return this.prisma.userMeta.upsert({
            where: { userId },
            create: { id: randomUUID(), userId, ...data },
            update: data,
        });
    }

    /**
     * Maps the DTO onto column values, distinguishing "absent" from "explicitly cleared".
     *
     * The `!== undefined` guard on every field is the whole point: spreading the DTO directly
     * would write `undefined` for absent keys, which Prisma treats as "no change" for updates
     * but silently drops on create — so a PATCH and the first-ever PATCH would behave
     * differently. Empty strings normalise to null so `''` and "unset" are one state.
     */
    private toWritable(dto: UpsertUserMetaDto): UserMetaWritable {
        const data: UserMetaWritable = {};

        if (dto.theme !== undefined) data.theme = dto.theme;
        if (dto.locale !== undefined) data.locale = dto.locale || null;
        if (dto.timezone !== undefined) data.timezone = dto.timezone || null;
        if (dto.pageSize !== undefined) data.pageSize = dto.pageSize || null;
        if (dto.marketingEmails !== undefined) data.marketingEmails = dto.marketingEmails;
        if (dto.notificationEmails !== undefined) data.notificationEmails = dto.notificationEmails;

        return data;
    }
}
