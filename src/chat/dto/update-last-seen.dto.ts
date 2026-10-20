import { IsNotEmpty, IsString } from 'class-validator';

export class UpdateLastSeenDto {
  @IsString()
  @IsNotEmpty({ message: 'userId must not be empty' })
  userId!: string;

  @IsString()
  @IsNotEmpty({ message: 'messageId must not be empty' })
  messageId!: string;
}
