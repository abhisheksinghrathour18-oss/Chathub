import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class GetMessagesQueryDto {
  @ApiPropertyOptional({
    description:
      'User ID of the caller for relational membership authorization',
    example: '78a15aac-0d92-4ca9-ab67-70a78b569581',
  })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({
    description: 'Maximum number of messages to return (1-100)',
    default: 50,
    minimum: 1,
    maximum: 100,
    example: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be an integer' })
  @Min(1, { message: 'limit must be at least 1' })
  @Max(100, { message: 'limit must not exceed 100' })
  limit: number = 50;

  @ApiPropertyOptional({
    description:
      'Message ID cursor for pagination (fetches messages after this cursor)',
    example: 'msg-abc-123',
  })
  @IsOptional()
  @IsString()
  cursor?: string;
}
