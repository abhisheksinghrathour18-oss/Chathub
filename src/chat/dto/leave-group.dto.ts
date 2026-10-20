import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsUUID } from 'class-validator';

export class LeaveGroupDto {
  @ApiProperty({
    example: '05044ae6-ed94-405c-9416-36340b4842a6',
    description: 'UUID of the user voluntarily leaving the group',
  })
  @IsUUID('4', { message: 'userId must be a valid UUID' })
  @IsNotEmpty()
  userId!: string;
}
