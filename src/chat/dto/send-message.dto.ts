import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SendMessageDto {
  @IsString()
  @IsNotEmpty({ message: 'senderId must not be empty' })
  senderId!: string;

  @IsString()
  @IsNotEmpty({ message: 'text must not be empty' })
  @MaxLength(5000, { message: 'text must not exceed 5000 characters' })
  text!: string;
}

