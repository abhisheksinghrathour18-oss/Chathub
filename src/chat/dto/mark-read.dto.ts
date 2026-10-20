import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class MarkReadDto {
  @ApiProperty({
    description:
      'Unique ID of user marking the message as read (must be a member)',
    example: '05044ae6-ed94-405c-9416-36340b4842a6',
  })
  @IsString()
  @IsNotEmpty({ message: 'userId must not be empty' })
  userId!: string;
}
