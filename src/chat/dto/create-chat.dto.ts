import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class CreateChatDto {
  @ApiProperty({
    description: 'Unique ID of the first user in PostgreSQL',
    example: '78a15aac-0d92-4ca9-ab67-70a78b569581',
  })
  @IsString()
  @IsNotEmpty({ message: 'userAId must not be empty' })
  userAId!: string;

  @ApiProperty({
    description: 'Unique ID of the second user in PostgreSQL',
    example: '05044ae6-ed94-405c-9416-36340b4842a6',
  })
  @IsString()
  @IsNotEmpty({ message: 'userBId must not be empty' })
  userBId!: string;
}
