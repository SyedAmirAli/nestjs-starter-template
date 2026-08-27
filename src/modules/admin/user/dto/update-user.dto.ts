import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { USER_ROLES, type UserRole } from '@/auth/user-role';

/** Email is immutable; password goes through the dedicated reset endpoint. */
export class UpdateUserDto {
    @ApiPropertyOptional({ description: 'Display name.', example: 'Ada Lovelace', maxLength: 200 })
    @IsOptional()
    @IsString({ message: 'name must be a string.' })
    @IsNotEmpty({ message: 'name must not be empty.' })
    @MaxLength(200, { message: 'name must not exceed 200 characters.' })
    name?: string;

    @ApiPropertyOptional({ description: 'Role to assign.', enum: USER_ROLES, example: 'ADMIN' })
    @IsOptional()
    @IsIn(USER_ROLES, { message: `role must be one of: ${USER_ROLES.join(', ')}.` })
    role?: UserRole;
}
