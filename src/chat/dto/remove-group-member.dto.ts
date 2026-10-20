import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class RemoveMemberQueryDto {
  @ApiPropertyOptional({
    example: '78a15aac-0d92-4ca9-ab67-70a78b569581',
    description:
      'UUID of the acting user performing the removal (must be an ADMIN of the group)',
  })
  @IsOptional()
  @IsUUID('4', { message: 'actingUserId must be a valid UUID' })
  actingUserId?: string;
}

