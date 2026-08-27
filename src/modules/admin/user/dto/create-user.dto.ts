import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { USER_ROLES, type UserRole } from '@/auth/user-role';

export class CreateUserDto {
    @ApiProperty({ description: 'Login email — unique, immutable once created.', example: 'user@example.com' })
    @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
    @IsEmail({}, { message: 'email must be a valid email address.' })
    email!: string;

    @ApiProperty({ description: 'Display name.', example: 'Ada Lovelace', minLength: 1, maxLength: 200 })
    @IsString({ message: 'name must be a string.' })
    @IsNotEmpty({ message: 'name is required.' })
    @MaxLength(200, { message: 'name must not exceed 200 characters.' })
    name!: string;

    @ApiProperty({ description: 'Initial password (min 8 characters).', example: 'ChangeMe123', minLength: 8 })
    @IsString({ message: 'password must be a string.' })
    @MinLength(8, { message: 'password must be at least 8 characters.' })
    @MaxLength(128, { message: 'password must not exceed 128 characters.' })
    password!: string;

    @ApiPropertyOptional({ description: 'Role to assign.', enum: USER_ROLES, example: 'USER' })
    @IsOptional()
    @IsIn(USER_ROLES, { message: `role must be one of: ${USER_ROLES.join(', ')}.` })
    role?: UserRole;
}
