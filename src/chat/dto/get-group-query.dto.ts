import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class GetGroupQueryDto {
  @ApiPropertyOptional({
    example: '78a15aac-0d92-4ca9-ab67-70a78b569581',
    description: 'UUID of the calling user (verified against group membership)',
  })
  @IsOptional()
  @IsUUID('4', { message: 'userId must be a valid UUID' })
  userId?: string;
}
