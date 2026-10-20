import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserChatsResult, UserService } from './user.service';

@ApiTags('User')
@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  /**
   * API 6: List User Chats
   * GET /api/user/:userId/chats
   */
  @Get(':userId/chats')
  @ApiOperation({
    summary: 'List all chats and member IDs for a user',
    description:
      'Queries PostgreSQL through relational chat_members relationship. Uses B-tree indexed userId column for performance. Returns list of user chats and their participant member IDs.',
  })
  @ApiParam({
    name: 'userId',
    description: 'Unique ID of the user in PostgreSQL',
    example: '78a15aac-0d92-4ca9-ab67-70a78b569581',
  })
  @ApiResponse({
    status: 200,
    description: 'List of chats the user is a member of.',
    schema: {
      example: {
        userId: '78a15aac-0d92-4ca9-ab67-70a78b569581',
        chats: [
          {
            chatId: '6b6eb37e-5b65-44eb-9ec9-585b6e80f01c',
            type: 'DIRECT',
            name: null,
            memberIds: [
              '78a15aac-0d92-4ca9-ab67-70a78b569581',
              '05044ae6-ed94-405c-9416-36340b4842a6',
            ],
            createdAt: '2026-10-20T13:45:00.000Z',
            updatedAt: '2026-10-20T13:45:00.000Z',
          },
        ],
        totalCount: 1,
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'User ID does not exist in PostgreSQL.',
  })
  async getUserChats(
    @Param('userId') userId: string,
  ): Promise<UserChatsResult> {
    return this.userService.getUserChats(userId);
  }
}
