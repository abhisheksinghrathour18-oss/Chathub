import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FieldPath } from 'firebase-admin/firestore';
import { PrismaService } from '../database/prisma.service';
import { FirebaseService } from '../firebase/firebase.service';
import { CreateChatDto } from './dto/create-chat.dto';
import { GetMessagesQueryDto } from './dto/get-messages-query.dto';
import { SendMessageDto } from './dto/send-message.dto';

export interface CreateChatResult {
  chatId: string;
}

export interface PersistedMessage {
  id: string;
  senderId: string;
  text: string;
  createdAt: string;
}

export interface GetMessagesResult {
  chatId: string;
  messages: PersistedMessage[];
  pagination: {
    limit: number;
    nextCursor: string | null;
  };
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly firebase: FirebaseService,
  ) {}

  /**
   * API 1: Create or Get 1:1 Chat
   */
  async createOrGetChat(dto: CreateChatDto): Promise<CreateChatResult> {
    const { userAId, userBId } = dto;

    if (userAId === userBId) {
      throw new BadRequestException(
        'Cannot create a 1:1 chat between identical user IDs',
      );
    }

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

    const [user1Id, user2Id] =
      userAId < userBId ? [userAId, userBId] : [userBId, userAId];

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

    try {
      const chat = await this.prisma.$transaction(async (tx) => {
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

  /**
   * API 2: Send Message in 1:1 Chat
   */
  async sendMessage(
    chatId: string,
    dto: SendMessageDto,
  ): Promise<PersistedMessage> {
    const { senderId, text } = dto;

    // 1. Verify chat exists in PostgreSQL
    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
    });

    if (!chat) {
      throw new NotFoundException(`Chat with ID '${chatId}' does not exist`);
    }

    // 2. Verify sender is a member of the chat in PostgreSQL
    const membership = await this.prisma.chatMember.findUnique({
      where: {
        chatId_userId: { chatId, userId: senderId },
      },
    });

    if (!membership) {
      throw new ForbiddenException(
        `User '${senderId}' is not authorized to send messages in chat '${chatId}'`,
      );
    }

    // 3. Store message in Firestore under chats/{chatId}/messages/{messageId}
    const messageDocRef = this.firebase.getMessagesCollection(chatId).doc();
    const messageId = messageDocRef.id;

    await messageDocRef.set({
      senderId,
      text,
      createdAt: this.firebase.getServerTimestamp(),
    });

    this.logger.log(
      `Persisted message '${messageId}' in chat '${chatId}' by sender '${senderId}'`,
    );

    // 4. Fetch the persisted snapshot to return exact server timestamp
    const snapshot = await messageDocRef.get();
    const data = snapshot.data();
    const createdAtDate =
      data &&
      data['createdAt'] &&
      typeof data['createdAt'].toDate === 'function'
        ? data['createdAt'].toDate()
        : new Date();

    return {
      id: messageId,
      senderId,
      text,
      createdAt: createdAtDate.toISOString(),
    };
  }

  /**
   * API 3: Get Messages with Ordering & Pagination
   */
  async getMessages(
    chatId: string,
    query: GetMessagesQueryDto,
    headerUserId?: string,
  ): Promise<GetMessagesResult> {
    // 1. Verify chat exists in PostgreSQL
    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
    });

    if (!chat) {
      throw new NotFoundException(`Chat with ID '${chatId}' does not exist`);
    }

    // 2. Verify membership authorization if caller identity provided
    const callerId = query.userId || headerUserId;
    if (callerId) {
      const membership = await this.prisma.chatMember.findUnique({
        where: {
          chatId_userId: { chatId, userId: callerId },
        },
      });

      if (!membership) {
        throw new ForbiddenException(
          `User '${callerId}' is not authorized to read messages in chat '${chatId}'`,
        );
      }
    }

    // 3. Query messages in Firestore with deterministic sorting
    const limit = query.limit || 50;
    let firestoreQuery = this.firebase
      .getMessagesCollection(chatId)
      .orderBy('createdAt', 'asc')
      .orderBy(FieldPath.documentId(), 'asc')
      .limit(limit);

    // 4. Cursor-based pagination
    if (query.cursor) {
      const cursorDoc = await this.firebase
        .getMessageDocument(chatId, query.cursor)
        .get();

      if (cursorDoc.exists) {
        firestoreQuery = firestoreQuery.startAfter(cursorDoc);
      }
    }

    const snapshot = await firestoreQuery.get();
    const messages: PersistedMessage[] = snapshot.docs.map((doc) => {
      const data = doc.data();
      const createdAtDate =
        data &&
        data['createdAt'] &&
        typeof data['createdAt'].toDate === 'function'
          ? data['createdAt'].toDate()
          : new Date();

      return {
        id: doc.id,
        senderId: (data['senderId'] as string) || '',
        text: (data['text'] as string) || '',
        createdAt: createdAtDate.toISOString(),
      };
    });

    const nextCursor =
      messages.length === limit
        ? (messages[messages.length - 1]?.id ?? null)
        : null;

    return {
      chatId,
      messages,
      pagination: {
        limit,
        nextCursor,
      },
    };
  }
}
