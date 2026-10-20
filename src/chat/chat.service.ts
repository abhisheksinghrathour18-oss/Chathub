import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ChatType, MemberRole, Prisma } from '@prisma/client';
import { FieldPath } from 'firebase-admin/firestore';
import { PrismaService } from '../database/prisma.service';
import { FirebaseService } from '../firebase/firebase.service';
import { AddGroupMemberDto } from './dto/add-group-member.dto';
import { CreateChatDto } from './dto/create-chat.dto';
import { CreateGroupChatDto } from './dto/create-group-chat.dto';
import { EditMessageDto } from './dto/edit-message.dto';
import { GetMessagesQueryDto } from './dto/get-messages-query.dto';
import { LeaveGroupDto } from './dto/leave-group.dto';
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
  editedAt?: string | null;
  deletedAt?: string | null;
  isDeleted?: boolean;
}

export interface EditMessageResult {
  id: string;
  chatId: string;
  senderId: string;
  text: string;
  createdAt: string;
  editedAt: string;
  isDeleted: boolean;
}

export interface DeleteMessageResult {
  id: string;
  chatId: string;
  senderId: string;
  isDeleted: boolean;
  deletedAt: string;
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

export interface GroupMemberItem {
  userId: string;
  role: MemberRole;
  joinedAt?: string;
}

export interface CreateGroupChatResult {
  chatId: string;
  name: string;
  type: ChatType;
  creatorId: string;
  members: GroupMemberItem[];
  createdAt: string;
}

export interface GroupDetailsMember {
  userId: string;
  name: string;
  email: string;
  role: MemberRole;
  joinedAt: string;
}

export interface GroupDetailsResult {
  chatId: string;
  name: string | null;
  type: ChatType;
  creatorId: string | null;
  members: GroupDetailsMember[];
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AddGroupMemberResult {
  chatId: string;
  userId: string;
  role: MemberRole;
  joinedAt: string;
}

export interface RemoveGroupMemberResult {
  chatId: string;
  userId: string;
  removed: boolean;
}

export interface LeaveGroupResult {
  chatId: string;
  userId: string;
  left: boolean;
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

      const isDeleted = data?.['isDeleted'] === true;

      const editedAtDate =
        data &&
        data['editedAt'] &&
        typeof data['editedAt'].toDate === 'function'
          ? data['editedAt'].toDate()
          : null;

      const deletedAtDate =
        data &&
        data['deletedAt'] &&
        typeof data['deletedAt'].toDate === 'function'
          ? data['deletedAt'].toDate()
          : null;

      return {
        id: doc.id,
        senderId: (data['senderId'] as string) || '',
        text: isDeleted ? '' : (data['text'] as string) || '',
        createdAt: createdAtDate.toISOString(),
        editedAt: editedAtDate ? editedAtDate.toISOString() : null,
        deletedAt: deletedAtDate ? deletedAtDate.toISOString() : null,
        isDeleted,
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
      data && data['readAt'] && typeof data['readAt'].toDate === 'function'
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

  /**
   * Milestone 10: Create Group Chat
   * POST /api/chat/group/create
   */
  async createGroupChat(
    dto: CreateGroupChatDto,
  ): Promise<CreateGroupChatResult> {
    const trimmedName = dto.name?.trim();
    if (!trimmedName) {
      throw new BadRequestException('Group name cannot be blank');
    }

    const rawMemberIds = dto.memberIds || [];
    // Deduplicate and ensure creator is part of the group
    const memberSet = new Set([dto.creatorId, ...rawMemberIds]);
    const distinctMemberIds = Array.from(memberSet);

    // Enforce membership limits: minimum 2 distinct members, maximum 100
    if (distinctMemberIds.length < 2) {
      throw new BadRequestException(
        'Group must contain at least 2 distinct members',
      );
    }
    if (distinctMemberIds.length > 100) {
      throw new BadRequestException(
        'Group cannot exceed maximum of 100 members',
      );
    }

    // Verify all users exist in PostgreSQL
    const existingUsers = await this.prisma.user.findMany({
      where: { id: { in: distinctMemberIds } },
      select: { id: true },
    });

    if (existingUsers.length !== distinctMemberIds.length) {
      const existingSet = new Set(existingUsers.map((u) => u.id));
      const missingIds = distinctMemberIds.filter((id) => !existingSet.has(id));
      throw new NotFoundException(
        `The following users do not exist: ${missingIds.join(', ')}`,
      );
    }

    // Relational transaction: Create chat entity and bulk insert members
    const groupChat = await this.prisma.$transaction(async (tx) => {
      const chat = await tx.chat.create({
        data: {
          type: ChatType.GROUP,
          name: trimmedName,
          createdById: dto.creatorId,
        },
      });

      const memberRecords = distinctMemberIds.map((userId) => ({
        chatId: chat.id,
        userId,
        role: userId === dto.creatorId ? MemberRole.ADMIN : MemberRole.MEMBER,
      }));

      await tx.chatMember.createMany({
        data: memberRecords,
      });

      return { chat, memberRecords };
    });

    this.logger.log(
      `Created group chat '${groupChat.chat.id}' ("${trimmedName}") with ${distinctMemberIds.length} members by creator '${dto.creatorId}'`,
    );

    return {
      chatId: groupChat.chat.id,
      name: groupChat.chat.name!,
      type: groupChat.chat.type,
      creatorId: dto.creatorId,
      members: groupChat.memberRecords.map((m) => ({
        userId: m.userId,
        role: m.role,
      })),
      createdAt: groupChat.chat.createdAt.toISOString(),
    };
  }

  /**
   * Milestone 10: Get Group Details and Members
   * GET /api/chat/group/:chatId
   */
  async getGroupDetails(
    chatId: string,
    callerUserId?: string,
  ): Promise<GroupDetailsResult> {
    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
          orderBy: { joinedAt: 'asc' },
        },
      },
    });

    if (!chat || chat.type !== ChatType.GROUP) {
      throw new NotFoundException(
        `Group chat with ID '${chatId}' does not exist`,
      );
    }

    if (callerUserId) {
      const isMember = chat.members.some((m) => m.userId === callerUserId);
      if (!isMember) {
        throw new ForbiddenException(
          `User '${callerUserId}' is not authorized to view group '${chatId}'`,
        );
      }
    }

    return {
      chatId: chat.id,
      name: chat.name,
      type: chat.type,
      creatorId: chat.createdById,
      members: chat.members.map((m) => ({
        userId: m.userId,
        name: m.user.name,
        email: m.user.email,
        role: m.role,
        joinedAt: m.joinedAt.toISOString(),
      })),
      memberCount: chat.members.length,
      createdAt: chat.createdAt.toISOString(),
      updatedAt: chat.updatedAt.toISOString(),
    };
  }

  /**
   * Milestone 10: Add Member to Group
   * POST /api/chat/group/:chatId/members
   */
  async addGroupMember(
    chatId: string,
    dto: AddGroupMemberDto,
  ): Promise<AddGroupMemberResult> {
    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
      include: { members: true },
    });

    if (!chat || chat.type !== ChatType.GROUP) {
      throw new NotFoundException(
        `Group chat with ID '${chatId}' does not exist`,
      );
    }

    // Verify acting user is a member and has ADMIN role
    const actingMember = chat.members.find(
      (m) => m.userId === dto.actingUserId,
    );
    if (!actingMember) {
      throw new ForbiddenException(
        `User '${dto.actingUserId}' is not a member of group '${chatId}'`,
      );
    }
    if (actingMember.role !== MemberRole.ADMIN) {
      throw new ForbiddenException(
        `Only group administrators can add members to group '${chatId}'`,
      );
    }

    // Verify target user is not already a member
    const isAlreadyMember = chat.members.some((m) => m.userId === dto.userId);
    if (isAlreadyMember) {
      throw new ConflictException(
        `User '${dto.userId}' is already a member of group '${chatId}'`,
      );
    }

    // Verify group capacity
    if (chat.members.length >= 100) {
      throw new BadRequestException(
        'Group has reached maximum capacity of 100 members',
      );
    }

    // Verify target user exists in database
    const targetUser = await this.prisma.user.findUnique({
      where: { id: dto.userId },
    });
    if (!targetUser) {
      throw new NotFoundException(
        `User with ID '${dto.userId}' does not exist`,
      );
    }

    const newMember = await this.prisma.chatMember.create({
      data: {
        chatId,
        userId: dto.userId,
        role: dto.role || MemberRole.MEMBER,
      },
    });

    this.logger.log(
      `User '${dto.userId}' added to group '${chatId}' by admin '${dto.actingUserId}' with role '${newMember.role}'`,
    );

    return {
      chatId,
      userId: newMember.userId,
      role: newMember.role,
      joinedAt: newMember.joinedAt.toISOString(),
    };
  }

  /**
   * Milestone 10: Remove Member from Group
   * DELETE /api/chat/group/:chatId/members/:userId
   */
  async removeGroupMember(
    chatId: string,
    targetUserId: string,
    actingUserId: string,
  ): Promise<RemoveGroupMemberResult> {
    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
      include: { members: true },
    });

    if (!chat || chat.type !== ChatType.GROUP) {
      throw new NotFoundException(
        `Group chat with ID '${chatId}' does not exist`,
      );
    }

    // Verify acting user is a member and has ADMIN role
    const actingMember = chat.members.find((m) => m.userId === actingUserId);
    if (!actingMember) {
      throw new ForbiddenException(
        `User '${actingUserId}' is not a member of group '${chatId}'`,
      );
    }
    if (actingMember.role !== MemberRole.ADMIN) {
      throw new ForbiddenException(
        `Only group administrators can remove members from group '${chatId}'`,
      );
    }

    // Verify target user is in the group
    const targetMember = chat.members.find((m) => m.userId === targetUserId);
    if (!targetMember) {
      throw new NotFoundException(
        `User '${targetUserId}' is not a member of group '${chatId}'`,
      );
    }

    // Guard: Prevent removing the last administrator
    if (targetMember.role === MemberRole.ADMIN) {
      const totalAdmins = chat.members.filter(
        (m) => m.role === MemberRole.ADMIN,
      ).length;
      if (totalAdmins <= 1) {
        throw new BadRequestException(
          'Cannot remove the last administrator of the group. Assign another administrator first.',
        );
      }
    }

    await this.prisma.chatMember.delete({
      where: {
        chatId_userId: { chatId, userId: targetUserId },
      },
    });

    this.logger.log(
      `User '${targetUserId}' removed from group '${chatId}' by admin '${actingUserId}'`,
    );

    return {
      chatId,
      userId: targetUserId,
      removed: true,
    };
  }

  /**
   * Milestone 10: Leave Group
   * POST /api/chat/group/:chatId/leave
   */
  async leaveGroup(
    chatId: string,
    dto: LeaveGroupDto,
  ): Promise<LeaveGroupResult> {
    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
      include: { members: true },
    });

    if (!chat || chat.type !== ChatType.GROUP) {
      throw new NotFoundException(
        `Group chat with ID '${chatId}' does not exist`,
      );
    }

    const leavingMember = chat.members.find((m) => m.userId === dto.userId);
    if (!leavingMember) {
      throw new ForbiddenException(
        `User '${dto.userId}' is not a member of group '${chatId}'`,
      );
    }

    // Guard: Prevent leaving as the last administrator if other members exist
    if (leavingMember.role === MemberRole.ADMIN) {
      const totalAdmins = chat.members.filter(
        (m) => m.role === MemberRole.ADMIN,
      ).length;
      const remainingMembersCount = chat.members.length - 1;
      if (totalAdmins <= 1 && remainingMembersCount > 0) {
        throw new BadRequestException(
          'Cannot leave group as the last administrator while other members exist. Promote another member to admin before leaving.',
        );
      }
    }

    await this.prisma.chatMember.delete({
      where: {
        chatId_userId: { chatId, userId: dto.userId },
      },
    });

    this.logger.log(`User '${dto.userId}' left group '${chatId}'`);

    return {
      chatId,
      userId: dto.userId,
      left: true,
    };
  }

  /**
   * Milestone 11: Edit Message
   * PATCH /api/chat/:chatId/message/:messageId
   */
  async editMessage(
    chatId: string,
    messageId: string,
    dto: EditMessageDto,
  ): Promise<EditMessageResult> {
    const { senderId, text } = dto;
    const trimmedText = text?.trim();
    if (!trimmedText) {
      throw new BadRequestException('Message text cannot be blank');
    }

    // 1. Verify chat exists in PostgreSQL
    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
    });
    if (!chat) {
      throw new NotFoundException(`Chat with ID '${chatId}' does not exist`);
    }

    // 2. Verify acting user is a member of the chat
    const membership = await this.prisma.chatMember.findUnique({
      where: {
        chatId_userId: { chatId, userId: senderId },
      },
    });
    if (!membership) {
      throw new ForbiddenException(
        `User '${senderId}' is not authorized in chat '${chatId}'`,
      );
    }

    // 3. Firestore transaction for atomic check & update
    const messageDocRef = this.firebase.getMessageDocument(chatId, messageId);

    const result = await this.firebase.runTransaction(async (transaction) => {
      const docSnap = await transaction.get(messageDocRef);
      if (!docSnap.exists) {
        throw new NotFoundException(
          `Message with ID '${messageId}' does not exist in chat '${chatId}'`,
        );
      }

      const data = docSnap.data();
      if (!data) {
        throw new NotFoundException(
          `Message with ID '${messageId}' data is empty`,
        );
      }

      // Check ownership: Only the original sender may edit their message
      if (data['senderId'] !== senderId) {
        throw new ForbiddenException(
          `User '${senderId}' is not the author of message '${messageId}'`,
        );
      }

      // Reject editing if message is deleted
      if (data['isDeleted'] === true) {
        throw new BadRequestException('Cannot edit a deleted message');
      }

      const createdAtDate =
        data['createdAt'] && typeof data['createdAt'].toDate === 'function'
          ? data['createdAt'].toDate()
          : new Date();

      transaction.update(messageDocRef, {
        text: trimmedText,
        editedAt: this.firebase.getServerTimestamp(),
      });

      return {
        createdAtDate,
      };
    });

    this.logger.log(
      `Message '${messageId}' edited in chat '${chatId}' by sender '${senderId}'`,
    );

    const updatedSnap = await messageDocRef.get();
    const updatedData = updatedSnap.data();
    const editedAtDate =
      updatedData &&
      updatedData['editedAt'] &&
      typeof updatedData['editedAt'].toDate === 'function'
        ? updatedData['editedAt'].toDate()
        : new Date();

    return {
      id: messageId,
      chatId,
      senderId,
      text: trimmedText,
      createdAt: result.createdAtDate.toISOString(),
      editedAt: editedAtDate.toISOString(),
      isDeleted: false,
    };
  }

  /**
   * Milestone 11: Delete Message
   * DELETE /api/chat/:chatId/message/:messageId
   */
  async deleteMessage(
    chatId: string,
    messageId: string,
    actingSenderId: string,
  ): Promise<DeleteMessageResult> {
    // 1. Verify chat exists in PostgreSQL
    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
    });
    if (!chat) {
      throw new NotFoundException(`Chat with ID '${chatId}' does not exist`);
    }

    // 2. Verify acting user is a member of the chat
    const membership = await this.prisma.chatMember.findUnique({
      where: {
        chatId_userId: { chatId, userId: actingSenderId },
      },
    });
    if (!membership) {
      throw new ForbiddenException(
        `User '${actingSenderId}' is not authorized in chat '${chatId}'`,
      );
    }

    // 3. Firestore transaction for atomic check & soft delete
    const messageDocRef = this.firebase.getMessageDocument(chatId, messageId);

    const deleteState = await this.firebase.runTransaction(
      async (transaction) => {
        const docSnap = await transaction.get(messageDocRef);
        if (!docSnap.exists) {
          throw new NotFoundException(
            `Message with ID '${messageId}' does not exist in chat '${chatId}'`,
          );
        }

        const data = docSnap.data();
        if (!data) {
          throw new NotFoundException(
            `Message with ID '${messageId}' data is empty`,
          );
        }

        // Check ownership: Only the original sender may delete their message
        if (data['senderId'] !== actingSenderId) {
          throw new ForbiddenException(
            `User '${actingSenderId}' is not the author of message '${messageId}'`,
          );
        }

        // Handle repeated deletion requests consistently
        if (data['isDeleted'] === true) {
          const deletedAtDate =
            data['deletedAt'] && typeof data['deletedAt'].toDate === 'function'
              ? data['deletedAt'].toDate()
              : new Date();
          return {
            alreadyDeleted: true,
            deletedAtDate,
          };
        }

        // Soft-delete strategy:
        // Clear text content so it is never exposed in message retrieval
        // Retain message ID, senderId, and createdAt for timeline continuity
        transaction.update(messageDocRef, {
          isDeleted: true,
          text: '',
          deletedAt: this.firebase.getServerTimestamp(),
        });

        return {
          alreadyDeleted: false,
          deletedAtDate: null,
        };
      },
    );

    this.logger.log(
      `Message '${messageId}' soft-deleted in chat '${chatId}' by sender '${actingSenderId}'`,
    );

    let finalDeletedAtDate: Date;
    if (deleteState.alreadyDeleted && deleteState.deletedAtDate) {
      finalDeletedAtDate = deleteState.deletedAtDate;
    } else {
      const updatedSnap = await messageDocRef.get();
      const updatedData = updatedSnap.data();
      finalDeletedAtDate =
        updatedData &&
        updatedData['deletedAt'] &&
        typeof updatedData['deletedAt'].toDate === 'function'
          ? updatedData['deletedAt'].toDate()
          : new Date();
    }

    return {
      id: messageId,
      chatId,
      senderId: actingSenderId,
      isDeleted: true,
      deletedAt: finalDeletedAtDate.toISOString(),
    };
  }
}
