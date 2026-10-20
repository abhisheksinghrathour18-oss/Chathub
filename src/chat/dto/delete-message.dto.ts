import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class DeleteMessageQueryDto {
  @ApiPropertyOptional({
    example: '78a15aac-0d92-4ca9-ab67-70a78b569581',
    description:
      'UUID of the user requesting deletion (must be original message author)',
  })
  @IsOptional()
  @IsUUID('4', { message: 'senderId must be a valid UUID' })
  senderId?: string;
}

export class DeleteMessageDto {
  @ApiPropertyOptional({
    example: '78a15aac-0d92-4ca9-ab67-70a78b569581',
    description:
      'UUID of the user requesting deletion (must be original message author)',
  })
  @IsOptional()
  @IsUUID('4', { message: 'senderId must be a valid UUID' })
  senderId?: string;
}

