import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

/** Body for toggling or explicitly setting an entity's `isActive` flag. */
export class UpdateActiveStatusDto {
    @ApiPropertyOptional({
        description: 'Set the active flag explicitly. Omit to toggle the current value.',
        example: true,
    })
    @IsOptional()
    @IsBoolean({ message: 'isActive must be a boolean.' })
    isActive?: boolean;
}
