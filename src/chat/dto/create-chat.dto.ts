import { IsNotEmpty, IsString } from 'class-validator';

export class CreateChatDto {
  @IsString()
  @IsNotEmpty({ message: 'userAId must not be empty' })
  userAId!: string;

  @IsString()
  @IsNotEmpty({ message: 'userBId must not be empty' })
  userBId!: string;
}
