import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class UpdateLastSeenDto {
  @ApiProperty({
    description: 'Unique ID of user updating last seen (must be a member)',
    example: '05044ae6-ed94-405c-9416-36340b4842a6',
  })
  @IsString()
  @IsNotEmpty({ message: 'userId must not be empty' })
  userId!: string;

  @ApiProperty({
    description: 'Message ID in Firestore representing the last message seen',
    example: 'msg-abc-123',
  })
  @IsString()
  @IsNotEmpty({ message: 'messageId must not be empty' })
  messageId!: string;
}
