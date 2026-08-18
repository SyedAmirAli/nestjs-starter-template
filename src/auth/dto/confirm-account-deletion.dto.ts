import { IsString, Length } from 'class-validator';

export class ConfirmAccountDeletionDto {
    @IsString({ message: 'Code must be a string.' })
    @Length(6, 6, { message: 'Code must be exactly 6 digits.' })
    otp!: string;
}
