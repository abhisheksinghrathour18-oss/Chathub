import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

export class EditMessageDto {
  @ApiProperty({
    example: '78a15aac-0d92-4ca9-ab67-70a78b569581',
    description:
      'UUID of the acting sender attempting to edit the message (must be original author)',
  })
  @IsUUID('4', { message: 'senderId must be a valid UUID' })
  @IsNotEmpty()
  senderId!: string;

  @ApiProperty({
    example: 'Updated message content',
    description:
      'New text content for the message (1 to 5000 characters, non-blank)',
    maxLength: 5000,
  })
  @IsString()
  @IsNotEmpty({ message: 'text must not be empty' })
  @MaxLength(5000, { message: 'text must not exceed 5000 characters' })
  text!: string;
}

