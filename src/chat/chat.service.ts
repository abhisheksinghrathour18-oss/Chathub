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
import { MarkReadDto } from './dto/mark-read.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { UpdateLastSeenDto } from './dto/update-last-seen.dto';

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

export interface ReadReceiptResult {
  chatId: string;
  messageId: string;
  userId: string;
  readAt: string;
  isNew?: boolean;
}

export interface LastSeenResult {
  chatId: string;
  userId: string;
  messageId: string;
  updatedAt: string;
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

    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
    });

    if (!chat) {
      throw new NotFoundException(`Chat with ID '${chatId}' does not exist`);
    }

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

    const snapshot = await messageDocRef.get();
    const data = snapshot.data();
    const createdAtDate =
      data && data['createdAt'] && typeof data['createdAt'].toDate === 'function'
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
    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
    });

    if (!chat) {
      throw new NotFoundException(`Chat with ID '${chatId}' does not exist`);
    }

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

    const limit = query.limit || 50;
    let firestoreQuery = this.firebase
      .getMessagesCollection(chatId)
      .orderBy('createdAt', 'asc')
      .orderBy(FieldPath.documentId(), 'asc')
      .limit(limit);

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
      messages.length === limit ? messages[messages.length - 1]?.id ?? null : null;

    return {
      chatId,
      messages,
      pagination: {
        limit,
        nextCursor,
      },
    };
  }

  /**
   * API 4: Mark Message Read
   */
  async markMessageRead(
    chatId: string,
    messageId: string,
    dto: MarkReadDto,
  ): Promise<ReadReceiptResult> {
    const { userId } = dto;

    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
    });

    if (!chat) {
      throw new NotFoundException(`Chat with ID '${chatId}' does not exist`);
    }

    const membership = await this.prisma.chatMember.findUnique({
      where: {
        chatId_userId: { chatId, userId },
      },
    });

    if (!membership) {
      throw new ForbiddenException(
        `User '${userId}' is not authorized as a member of chat '${chatId}'`,
      );
    }

    const messageDocRef = this.firebase.getMessageDocument(chatId, messageId);
    const messageDoc = await messageDocRef.get();

    if (!messageDoc.exists) {
      throw new NotFoundException(
        `Message with ID '${messageId}' does not exist in chat '${chatId}'`,
      );
    }

    const receiptDocRef = this.firebase.getReadReceiptDocument(
      chatId,
      messageId,
      userId,
    );

    const existingReceipt = await receiptDocRef.get();
    if (existingReceipt.exists) {
      const existingData = existingReceipt.data();
      const existingReadAt =
        existingData &&
        existingData['readAt'] &&
        typeof existingData['readAt'].toDate === 'function'
          ? existingData['readAt'].toDate()
          : new Date();

      this.logger.log(
        `Read receipt already exists for user '${userId}' on message '${messageId}' in chat '${chatId}'`,
      );

      return {
        chatId,
        messageId,
        userId,
        readAt: existingReadAt.toISOString(),
        isNew: false,
      };
    }

    await receiptDocRef.set({
      userId,
      readAt: this.firebase.getServerTimestamp(),
    });

    this.logger.log(
      `Created read receipt for user '${userId}' on message '${messageId}' in chat '${chatId}'`,
    );

    const savedReceipt = await receiptDocRef.get();
    const data = savedReceipt.data();
    const readAtDate =
      data &&
      data['readAt'] &&
      typeof data['readAt'].toDate === 'function'
        ? data['readAt'].toDate()
        : new Date();

    return {
      chatId,
      messageId,
      userId,
      readAt: readAtDate.toISOString(),
      isNew: true,
    };
  }

  /**
   * API 5: Update Last Seen Message
   */
  async updateLastSeen(
    chatId: string,
    dto: UpdateLastSeenDto,
  ): Promise<LastSeenResult> {
    const { userId, messageId } = dto;

    // 1. Verify chat exists in PostgreSQL
    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
    });

    if (!chat) {
      throw new NotFoundException(`Chat with ID '${chatId}' does not exist`);
    }

    // 2. Verify user is a member of the chat in PostgreSQL
    const membership = await this.prisma.chatMember.findUnique({
      where: {
        chatId_userId: { chatId, userId },
      },
    });

    if (!membership) {
      throw new ForbiddenException(
        `User '${userId}' is not authorized as a member of chat '${chatId}'`,
      );
    }

    // 3. Verify message exists and belongs to this chat in Firestore
    const targetMessageRef = this.firebase.getMessageDocument(
      chatId,
      messageId,
    );
    const targetMessageSnap = await targetMessageRef.get();

    if (!targetMessageSnap.exists) {
      throw new NotFoundException(
        `Message '${messageId}' does not exist in chat '${chatId}'`,
      );
    }

    const targetData = targetMessageSnap.data();
    const targetTimestampMs =
      targetData &&
      targetData['createdAt'] &&
      typeof targetData['createdAt'].toMillis === 'function'
        ? targetData['createdAt'].toMillis()
        : 0;

    // 4. Safely update last-seen in Firestore with backwards-movement prevention
    const lastSeenRef = this.firebase.getLastSeenDocument(chatId, userId);

    await this.firebase.firestore.runTransaction(async (transaction) => {
      const currentLastSeenSnap = await transaction.get(lastSeenRef);

      if (currentLastSeenSnap.exists) {
        const currentData = currentLastSeenSnap.data();
        const currentMessageId = currentData?.['messageId'] as string;

        if (currentMessageId === messageId) {
          return;
        }

        if (currentMessageId) {
          const currentMessageRef = this.firebase.getMessageDocument(
            chatId,
            currentMessageId,
          );
          const currentMessageSnap = await transaction.get(currentMessageRef);

          if (currentMessageSnap.exists) {
            const currentMsgData = currentMessageSnap.data();
            const currentTimestampMs =
              currentMsgData &&
              currentMsgData['createdAt'] &&
              typeof currentMsgData['createdAt'].toMillis === 'function'
                ? currentMsgData['createdAt'].toMillis()
                : 0;

            if (
              targetTimestampMs < currentTimestampMs ||
              (targetTimestampMs === currentTimestampMs &&
                messageId < currentMessageId)
            ) {
              throw new BadRequestException(
                'Cannot move last-seen message backwards in time',
              );
            }
          }
        }
      }

      transaction.set(lastSeenRef, {
        messageId,
        updatedAt: this.firebase.getServerTimestamp(),
      });
    });

    this.logger.log(
      `Updated last-seen message to '${messageId}' for user '${userId}' in chat '${chatId}'`,
    );

    const updatedSnap = await lastSeenRef.get();
    const updatedData = updatedSnap.data();
    const updatedAtDate =
      updatedData &&
      updatedData['updatedAt'] &&
      typeof updatedData['updatedAt'].toDate === 'function'
        ? updatedData['updatedAt'].toDate()
        : new Date();

    return {
      chatId,
      userId,
      messageId,
      updatedAt: updatedAtDate.toISOString(),
    };
  }
}

