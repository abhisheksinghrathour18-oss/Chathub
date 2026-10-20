import { Controller, Get, Param } from '@nestjs/common';
import { UserChatsResult, UserService } from './user.service';

@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  /**
   * API 6: List User Chats
   * GET /api/user/:userId/chats
   */
  @Get(':userId/chats')
  async getUserChats(
    @Param('userId') userId: string,
  ): Promise<UserChatsResult> {
    return this.userService.getUserChats(userId);
  }
}

