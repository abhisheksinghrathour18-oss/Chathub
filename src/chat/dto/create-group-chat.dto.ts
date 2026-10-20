import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  IsArray,
  IsNotEmpty,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateGroupChatDto {
  @ApiProperty({
    example: 'Backend Engineering Team',
    description: 'Name of the group conversation (1 to 100 characters)',
    maxLength: 100,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiProperty({
    example: '78a15aac-0d92-4ca9-ab67-70a78b569581',
    description: 'UUID of the acting user creating the group (becomes ADMIN)',
  })
  @IsUUID('4', { message: 'creatorId must be a valid UUID' })
  @IsNotEmpty()
  creatorId!: string;

  @ApiProperty({
    example: [
      '05044ae6-ed94-405c-9416-36340b4842a6',
      '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    ],
    description:
      'Array of member UUIDs to add to the group (minimum 1 additional member)',
    type: [String],
  })
  @IsArray()
  @ArrayNotEmpty({ message: 'memberIds must contain at least one member' })
  @IsUUID('4', { each: true, message: 'Each memberId must be a valid UUID' })
  memberIds!: string[];
}
