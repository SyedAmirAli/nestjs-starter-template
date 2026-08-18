import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { DATABASE_URL } from '@/config/dotenv';
import PrismaQueryBuilder from '@/common/prisma-query-builder.service';

const adapter = new PrismaPg({ connectionString: DATABASE_URL });

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
    constructor() {
        super({ adapter });
    }

    async onModuleInit() {
        await this.$connect();
    }

    async onModuleDestroy() {
        await this.$disconnect();
    }

    public static queryBuilder = PrismaQueryBuilder;
}
