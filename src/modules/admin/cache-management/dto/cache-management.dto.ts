import { Allow, IsArray, IsInt, IsNotEmpty, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SetCacheDto {
    @ApiProperty({ example: 'session:preview', description: 'Full Redis key (including any prefix).' })
    @IsString()
    @IsNotEmpty()
    @MinLength(1)
    key!: string;

    @ApiProperty({
        description: 'Any JSON-serializable value (object, array, string, number, boolean, null).',
        example: { hello: 'world' },
    })
    @Allow()
    value!: unknown;

    @ApiPropertyOptional({
        description: 'TTL in seconds. Defaults to RedisService default (3600) when omitted.',
        example: 3600,
        minimum: 1,
    })
    @IsOptional()
    @IsInt()
    @Min(1)
    ttl?: number;
}

export class BulkDeleteCacheDto {
    @ApiProperty({
        type: [String],
        example: ['session:preview'],
        description: 'Full Redis keys to delete.',
    })
    @IsArray()
    @IsString({ each: true })
    @MinLength(1, { each: true })
    keys!: string[];
}
