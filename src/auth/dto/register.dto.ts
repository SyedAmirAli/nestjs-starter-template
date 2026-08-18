import { IsEmail, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
    @IsEmail({}, { message: 'Please provide a valid email address.' })
    @IsNotEmpty({ message: 'Email is required.' })
    email!: string;

    @IsString({ message: 'Password must be a string.' })
    @IsNotEmpty({ message: 'Password is required.' })
    @MinLength(8, { message: 'Password must be at least 8 characters long.' })
    @MaxLength(128, { message: 'Password must not exceed 128 characters.' })
    password!: string;

    @IsString({ message: 'Name must be a string.' })
    @IsNotEmpty({ message: 'Name is required.' })
    @MinLength(2, { message: 'Name must be at least 2 characters long.' })
    @MaxLength(100, { message: 'Name must not exceed 100 characters.' })
    name!: string;
}
