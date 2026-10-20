import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

export interface UserChatItem {
  chatId: string;
  memberIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface UserChatsResult {
  userId: string;
  chats: UserChatItem[];
  totalCount: number;
}

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getUserChats(userId: string): Promise<UserChatsResult> {
    // 1. Verify user exists in PostgreSQL
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException(`User with ID '${userId}' does not exist`);
    }

    // 2. Query relational chat memberships using indexed userId foreign key
    const memberships = await this.prisma.chatMember.findMany({
      where: { userId },
      include: {
        chat: {
          include: {
            members: {
              select: {
                userId: true,
              },
            },
          },
        },
      },
      orderBy: {
        joinedAt: 'desc',
      },
    });

    // 3. Format response with chat and member IDs
    const chats: UserChatItem[] = memberships.map((membership) => {
      const chat = membership.chat;
      const memberIds = chat.members.map((m) => m.userId);

      return {
        chatId: chat.id,
        memberIds,
        createdAt: chat.createdAt.toISOString(),
        updatedAt: chat.updatedAt.toISOString(),
      };
    });

    this.logger.log(
      `Retrieved ${chats.length} chats for user '${userId}' from PostgreSQL`,
    );

    return {
      userId,
      chats,
      totalCount: chats.length,
    };
  }
}
