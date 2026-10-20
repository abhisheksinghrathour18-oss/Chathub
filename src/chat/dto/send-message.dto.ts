import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SendMessageDto {
  @ApiProperty({
    description:
      'Unique ID of sender (must belong to chat_members in PostgreSQL)',
    example: '78a15aac-0d92-4ca9-ab67-70a78b569581',
  })
  @IsString()
  @IsNotEmpty({ message: 'senderId must not be empty' })
  senderId!: string;

  @ApiProperty({
    description: 'Text content of the message',
    example: 'Hello! How are you doing?',
    maxLength: 5000,
  })
  @IsString()
  @IsNotEmpty({ message: 'text must not be empty' })
  @MaxLength(5000, { message: 'text must not exceed 5000 characters' })
  text!: string;
}
