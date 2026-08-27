import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
    @ApiProperty({ description: 'New password (min 8 characters).', example: 'NewSecret123', minLength: 8 })
    @IsString({ message: 'password must be a string.' })
    @MinLength(8, { message: 'password must be at least 8 characters.' })
    @MaxLength(128, { message: 'password must not exceed 128 characters.' })
    password!: string;
}
