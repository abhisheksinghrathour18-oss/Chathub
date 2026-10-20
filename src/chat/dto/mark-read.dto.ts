import { IsNotEmpty, IsString } from 'class-validator';

export class MarkReadDto {
  @IsString()
  @IsNotEmpty({ message: 'userId must not be empty' })
  userId!: string;
}

