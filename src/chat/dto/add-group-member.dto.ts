import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MemberRole } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsOptional, IsUUID } from 'class-validator';

export class AddGroupMemberDto {
  @ApiProperty({
    example: '78a15aac-0d92-4ca9-ab67-70a78b569581',
    description:
      'UUID of the acting user performing the add (must be an ADMIN of the group)',
  })
  @IsUUID('4', { message: 'actingUserId must be a valid UUID' })
  @IsNotEmpty()
  actingUserId!: string;

  @ApiProperty({
    example: '05044ae6-ed94-405c-9416-36340b4842a6',
    description: 'UUID of the user to add to the group',
  })
  @IsUUID('4', { message: 'userId must be a valid UUID' })
  @IsNotEmpty()
  userId!: string;

  @ApiPropertyOptional({
    enum: MemberRole,
    default: MemberRole.MEMBER,
    description: 'Role assigned to the newly added member (defaults to MEMBER)',
  })
  @IsOptional()
  @IsEnum(MemberRole, { message: 'role must be either ADMIN or MEMBER' })
  role?: MemberRole;
}
