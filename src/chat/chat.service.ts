import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { CreateChatDto } from './dto/create-chat.dto';

export interface CreateChatResult {
  chatId: string;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createOrGetChat(dto: CreateChatDto): Promise<CreateChatResult> {
    const { userAId, userBId } = dto;

    // 1. Reject identical user IDs
    if (userAId === userBId) {
      throw new BadRequestException(
        'Cannot create a 1:1 chat between identical user IDs',
      );
    }

    // 2. Verify that both users exist
    const [userA, userB] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userAId } }),
      this.prisma.user.findUnique({ where: { id: userBId } }),
    ]);

    if (!userA) {
      throw new NotFoundException(`User with ID '${userAId}' does not exist`);
    }
    if (!userB) {
      throw new NotFoundException(`User with ID '${userBId}' does not exist`);
    }

    // 3. Establish canonical ordering (lexicographical)
    const [user1Id, user2Id] =
      userAId < userBId ? [userAId, userBId] : [userBId, userAId];

    // 4. Return existing chat if present
    const existingChat = await this.prisma.chat.findUnique({
      where: {
        user1Id_user2Id: { user1Id, user2Id },
      },
    });

    if (existingChat) {
      this.logger.log(
        `Returning existing 1:1 chat '${existingChat.id}' for users '${userAId}' and '${userBId}'`,
      );
      return { chatId: existingChat.id };
    }

    // 5. Create chat and memberships atomically inside a PostgreSQL transaction
    try {
      const chat = await this.prisma.$transaction(async (tx) => {
        // Double check within transaction in case of rapid concurrent request
        const concurrentExisting = await tx.chat.findUnique({
          where: {
            user1Id_user2Id: { user1Id, user2Id },
          },
        });
        if (concurrentExisting) {
          return concurrentExisting;
        }

        const newChat = await tx.chat.create({
          data: {
            user1Id,
            user2Id,
          },
        });

        await tx.chatMember.createMany({
          data: [
            { chatId: newChat.id, userId: userAId },
            { chatId: newChat.id, userId: userBId },
          ],
        });

        return newChat;
      });

      this.logger.log(
        `Created new 1:1 chat '${chat.id}' with members '${userAId}' and '${userBId}'`,
      );
      return { chatId: chat.id };
    } catch (error: unknown) {
      // 6. Handle race condition: If concurrent transaction committed first,
      // catch PostgreSQL unique constraint violation (Prisma code P2002)
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        this.logger.warn(
          `Concurrent creation detected for pair (${user1Id}, ${user2Id}). Fetching committed chat.`,
        );
        const committedChat = await this.prisma.chat.findUnique({
          where: {
            user1Id_user2Id: { user1Id, user2Id },
          },
        });

        if (committedChat) {
          return { chatId: committedChat.id };
        }
      }
      throw error;
    }
  }
}

