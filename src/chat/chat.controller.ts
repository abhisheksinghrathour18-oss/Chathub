import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  AddGroupMemberResult,
  ChatService,
  CreateChatResult,
  CreateGroupChatResult,
  GetMessagesResult,
  GroupDetailsResult,
  LastSeenResult,
  LeaveGroupResult,
  PersistedMessage,
  ReadReceiptResult,
  RemoveGroupMemberResult,
} from './chat.service';
import { AddGroupMemberDto } from './dto/add-group-member.dto';
import { CreateChatDto } from './dto/create-chat.dto';
import { CreateGroupChatDto } from './dto/create-group-chat.dto';
import { GetGroupQueryDto } from './dto/get-group-query.dto';
import { GetMessagesQueryDto } from './dto/get-messages-query.dto';
import { LeaveGroupDto } from './dto/leave-group.dto';
import { MarkReadDto } from './dto/mark-read.dto';
import { RemoveMemberQueryDto } from './dto/remove-group-member.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { UpdateLastSeenDto } from './dto/update-last-seen.dto';

@ApiTags('Chat')
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  /**
   * API 1: Create or Get 1:1 Chat
   * POST /api/chat/create
   */
  @Post('create')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Create or get a 1:1 chat between two users',
    description:
      'Verifies both users exist in PostgreSQL, rejects identical user IDs, and returns existing 1:1 chat if one already exists. Uses canonical lexicographical ordering and PostgreSQL transactions to prevent duplicates under concurrent requests.',
  })
  @ApiResponse({
    status: 200,
    description: 'Existing or newly created chat ID.',
    schema: {
      example: {
        chatId: '6b6eb37e-5b65-44eb-9ec9-585b6e80f01c',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Identical user IDs passed in request.',
  })
  @ApiResponse({
    status: 404,
    description: 'One or both user IDs do not exist in PostgreSQL.',
  })
  async createOrGetChat(@Body() dto: CreateChatDto): Promise<CreateChatResult> {
    return this.chatService.createOrGetChat(dto);
  }

  /**
   * API 2: Send Message in 1:1 Chat
   * POST /api/chat/:chatId/message/send
   */
  @Post(':chatId/message/send')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Send a message in a 1:1 chat',
    description:
      'Verifies chat exists and sender is a verified member in PostgreSQL chat_members table. Persists the message in Firestore with server-generated timestamp under chats/{chatId}/messages.',
  })
  @ApiParam({
    name: 'chatId',
    description: 'Unique ID of the chat',
    example: '6b6eb37e-5b65-44eb-9ec9-585b6e80f01c',
  })
  @ApiResponse({
    status: 201,
    description: 'Message successfully persisted in Firestore.',
    schema: {
      example: {
        id: '9B6c3G5zX7kL',
        senderId: '78a15aac-0d92-4ca9-ab67-70a78b569581',
        text: 'Hello! How are you doing?',
        createdAt: '2026-10-20T14:30:00.000Z',
      },
    },
  })
  @ApiResponse({
    status: 403,
    description: 'Sender is not an authorized member of the chat.',
  })
  @ApiResponse({
    status: 404,
    description: 'Chat ID does not exist in PostgreSQL.',
  })
  async sendMessage(
    @Param('chatId') chatId: string,
    @Body() dto: SendMessageDto,
  ): Promise<PersistedMessage> {
    return this.chatService.sendMessage(chatId, dto);
  }

  /**
   * API 3: Get Messages with Chronological Ordering & Pagination
   * GET /api/chat/:chatId/messages?limit=50
   */
  @Get(':chatId/messages')
  @ApiOperation({
    summary: 'Retrieve chronological messages from a chat',
    description:
      'Returns messages sorted in ascending chronological order with tie-breaking on document IDs for determinism. Supports cursor-based pagination.',
  })
  @ApiParam({
    name: 'chatId',
    description: 'Unique ID of the chat',
    example: '6b6eb37e-5b65-44eb-9ec9-585b6e80f01c',
  })
  @ApiHeader({
    name: 'x-user-id',
    required: false,
    description: 'Optional caller user ID for membership authorization check',
  })
  @ApiResponse({
    status: 200,
    description: 'List of messages and pagination metadata.',
    schema: {
      example: {
        chatId: '6b6eb37e-5b65-44eb-9ec9-585b6e80f01c',
        messages: [
          {
            id: 'msg-001',
            senderId: '78a15aac-0d92-4ca9-ab67-70a78b569581',
            text: 'Hello!',
            createdAt: '2026-10-20T14:30:00.000Z',
          },
        ],
        pagination: {
          limit: 50,
          nextCursor: 'msg-001',
        },
      },
    },
  })
  @ApiResponse({
    status: 403,
    description: 'Caller is not an authorized member of the chat.',
  })
  @ApiResponse({
    status: 404,
    description: 'Chat ID does not exist.',
  })
  async getMessages(
    @Param('chatId') chatId: string,
    @Query() query: GetMessagesQueryDto,
    @Headers('x-user-id') headerUserId?: string,
  ): Promise<GetMessagesResult> {
    return this.chatService.getMessages(chatId, query, headerUserId);
  }

  /**
   * API 4: Mark Message Read
   * POST /api/chat/:chatId/message/:messageId/read
   */
  @Post(':chatId/message/:messageId/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark a specific message as read',
    description:
      'Verifies chat membership in PostgreSQL and message existence in Firestore. Creates an idempotent read receipt under chats/{chatId}/messages/{messageId}/readReceipts/{userId}. Repeated requests safely return the existing read receipt without duplicating records or changing the initial readAt timestamp.',
  })
  @ApiParam({
    name: 'chatId',
    description: 'Unique ID of the chat',
    example: '6b6eb37e-5b65-44eb-9ec9-585b6e80f01c',
  })
  @ApiParam({
    name: 'messageId',
    description: 'Unique ID of the message to mark read',
    example: 'msg-001',
  })
  @ApiResponse({
    status: 200,
    description: 'Read receipt confirmed.',
    schema: {
      example: {
        chatId: '6b6eb37e-5b65-44eb-9ec9-585b6e80f01c',
        messageId: 'msg-001',
        userId: '05044ae6-ed94-405c-9416-36340b4842a6',
        readAt: '2026-10-20T14:31:00.000Z',
        isNew: true,
      },
    },
  })
  @ApiResponse({
    status: 403,
    description: 'User is not a member of the chat.',
  })
  @ApiResponse({
    status: 404,
    description: 'Chat or message does not exist.',
  })
  async markMessageRead(
    @Param('chatId') chatId: string,
    @Param('messageId') messageId: string,
    @Body() dto: MarkReadDto,
  ): Promise<ReadReceiptResult> {
    return this.chatService.markMessageRead(chatId, messageId, dto);
  }

  /**
   * API 5: Update Last Seen Message
   * POST /api/chat/:chatId/lastseen
   */
  @Post(':chatId/lastseen')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update last seen message pointer for a user in a chat',
    description:
      'Verifies membership and message ownership in the chat. Compares target message timestamp against current last-seen message inside a Firestore transaction, preventing last-seen pointer from moving backwards.',
  })
  @ApiParam({
    name: 'chatId',
    description: 'Unique ID of the chat',
    example: '6b6eb37e-5b65-44eb-9ec9-585b6e80f01c',
  })
  @ApiResponse({
    status: 200,
    description: 'Last seen message updated.',
    schema: {
      example: {
        chatId: '6b6eb37e-5b65-44eb-9ec9-585b6e80f01c',
        userId: '05044ae6-ed94-405c-9416-36340b4842a6',
        messageId: 'msg-002',
        updatedAt: '2026-10-20T14:32:00.000Z',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      'Target message is older than current last-seen message (moving backwards rejected).',
  })
  @ApiResponse({
    status: 403,
    description: 'User is not a member of the chat.',
  })
  @ApiResponse({
    status: 404,
    description: 'Chat or message does not exist.',
  })
  async updateLastSeen(
    @Param('chatId') chatId: string,
    @Body() dto: UpdateLastSeenDto,
  ): Promise<LastSeenResult> {
    return this.chatService.updateLastSeen(chatId, dto);
  }

  /**
   * Milestone 10: Create Group Chat
   * POST /api/chat/group/create
   */
  @Post('group/create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a new group chat',
    description:
      'Creates a new group conversation with a designated name, creator, and initial members. Validates member existence, enforces min (2) and max (100) member bounds, deduplicates user IDs, and assigns the creator the ADMIN role inside a relational transaction.',
  })
  @ApiResponse({
    status: 201,
    description: 'Group chat created successfully.',
    schema: {
      example: {
        chatId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
        name: 'Backend Engineering Team',
        type: 'GROUP',
        creatorId: '78a15aac-0d92-4ca9-ab67-70a78b569581',
        members: [
          {
            userId: '78a15aac-0d92-4ca9-ab67-70a78b569581',
            role: 'ADMIN',
          },
          {
            userId: '05044ae6-ed94-405c-9416-36340b4842a6',
            role: 'MEMBER',
          },
        ],
        createdAt: '2026-10-21T00:00:00.000Z',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid input, blank name, or member limits violated.',
  })
  @ApiResponse({
    status: 404,
    description: 'One or more requested user IDs do not exist.',
  })
  async createGroupChat(
    @Body() dto: CreateGroupChatDto,
  ): Promise<CreateGroupChatResult> {
    return this.chatService.createGroupChat(dto);
  }

  /**
   * Milestone 10: Get Group Details and Members
   * GET /api/chat/group/:chatId
   */
  @Get('group/:chatId')
  @ApiOperation({
    summary: 'Get group details and member list',
    description:
      'Retrieves metadata and members for a group chat. If userId is provided (via query or x-user-id header), caller authorization is verified against group membership.',
  })
  @ApiParam({
    name: 'chatId',
    description: 'Unique ID of the group chat',
    example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
  })
  @ApiHeader({
    name: 'x-user-id',
    description: 'Optional caller user ID for membership authorization check',
    required: false,
  })
  @ApiResponse({
    status: 200,
    description: 'Group details and members.',
    schema: {
      example: {
        chatId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
        name: 'Backend Engineering Team',
        type: 'GROUP',
        creatorId: '78a15aac-0d92-4ca9-ab67-70a78b569581',
        members: [
          {
            userId: '78a15aac-0d92-4ca9-ab67-70a78b569581',
            name: 'Alice',
            email: 'alice@example.com',
            role: 'ADMIN',
            joinedAt: '2026-10-21T00:00:00.000Z',
          },
          {
            userId: '05044ae6-ed94-405c-9416-36340b4842a6',
            name: 'Bob',
            email: 'bob@example.com',
            role: 'MEMBER',
            joinedAt: '2026-10-21T00:00:00.000Z',
          },
        ],
        memberCount: 2,
        createdAt: '2026-10-21T00:00:00.000Z',
        updatedAt: '2026-10-21T00:00:00.000Z',
      },
    },
  })
  @ApiResponse({
    status: 403,
    description: 'Caller is not authorized to view this group.',
  })
  @ApiResponse({
    status: 404,
    description: 'Group chat does not exist.',
  })
  async getGroupDetails(
    @Param('chatId') chatId: string,
    @Query() query: GetGroupQueryDto,
    @Headers('x-user-id') headerUserId?: string,
  ): Promise<GroupDetailsResult> {
    const callerId = query.userId || headerUserId;
    return this.chatService.getGroupDetails(chatId, callerId);
  }

  /**
   * Milestone 10: Add Member to Group
   * POST /api/chat/group/:chatId/members
   */
  @Post('group/:chatId/members')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Add a new member to a group chat',
    description:
      'Only group administrators can add new members. Rejects if acting user is not an admin, target user is already in the group, or group capacity (100) is exceeded.',
  })
  @ApiParam({
    name: 'chatId',
    description: 'Unique ID of the group chat',
    example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
  })
  @ApiResponse({
    status: 201,
    description: 'Member added successfully.',
    schema: {
      example: {
        chatId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
        userId: '05044ae6-ed94-405c-9416-36340b4842a6',
        role: 'MEMBER',
        joinedAt: '2026-10-21T00:00:00.000Z',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Group capacity exceeded or invalid request.',
  })
  @ApiResponse({
    status: 403,
    description: 'Acting user is not an administrator of the group.',
  })
  @ApiResponse({
    status: 404,
    description: 'Group chat or target user does not exist.',
  })
  @ApiResponse({
    status: 409,
    description: 'Target user is already a member of the group.',
  })
  async addGroupMember(
    @Param('chatId') chatId: string,
    @Body() dto: AddGroupMemberDto,
  ): Promise<AddGroupMemberResult> {
    return this.chatService.addGroupMember(chatId, dto);
  }

  /**
   * Milestone 10: Remove Member from Group
   * DELETE /api/chat/group/:chatId/members/:userId
   */
  @Delete('group/:chatId/members/:userId')
  @ApiOperation({
    summary: 'Remove a member from a group chat',
    description:
      'Only group administrators can remove members. Prevents removing the last administrator of the group. Acting user ID can be provided via query param actingUserId, request body, or x-user-id header.',
  })
  @ApiParam({
    name: 'chatId',
    description: 'Unique ID of the group chat',
    example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
  })
  @ApiParam({
    name: 'userId',
    description: 'Unique ID of the user to remove from the group',
    example: '05044ae6-ed94-405c-9416-36340b4842a6',
  })
  @ApiQuery({
    name: 'actingUserId',
    required: false,
    description: 'UUID of the acting admin performing removal',
    example: '78a15aac-0d92-4ca9-ab67-70a78b569581',
  })
  @ApiResponse({
    status: 200,
    description: 'Member removed successfully.',
    schema: {
      example: {
        chatId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
        userId: '05044ae6-ed94-405c-9416-36340b4842a6',
        removed: true,
      },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      'Cannot remove the last administrator of the group or missing actingUserId.',
  })
  @ApiResponse({
    status: 403,
    description: 'Acting user is not an administrator of the group.',
  })
  @ApiResponse({
    status: 404,
    description: 'Group chat or target member does not exist in the group.',
  })
  async removeGroupMember(
    @Param('chatId') chatId: string,
    @Param('userId') userId: string,
    @Query() query: RemoveMemberQueryDto,
    @Headers('x-user-id') headerUserId?: string,
  ): Promise<RemoveGroupMemberResult> {
    const actingUserId = query.actingUserId || headerUserId;
    if (!actingUserId) {
      throw new BadRequestException(
        'actingUserId must be provided via query param or x-user-id header',
      );
    }
    return this.chatService.removeGroupMember(chatId, userId, actingUserId);
  }

  /**
   * Milestone 10: Leave Group
   * POST /api/chat/group/:chatId/leave
   */
  @Post('group/:chatId/leave')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Voluntarily leave a group chat',
    description:
      'Allows a member to leave the group. Prevents leaving as the last administrator if other members remain.',
  })
  @ApiParam({
    name: 'chatId',
    description: 'Unique ID of the group chat',
    example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully left the group.',
    schema: {
      example: {
        chatId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
        userId: '05044ae6-ed94-405c-9416-36340b4842a6',
        left: true,
      },
    },
  })
  @ApiResponse({
    status: 400,
    description:
      'Cannot leave group as the last administrator while other members exist.',
  })
  @ApiResponse({
    status: 403,
    description: 'User is not a member of the group.',
  })
  @ApiResponse({
    status: 404,
    description: 'Group chat does not exist.',
  })
  async leaveGroup(
    @Param('chatId') chatId: string,
    @Body() dto: LeaveGroupDto,
  ): Promise<LeaveGroupResult> {
    return this.chatService.leaveGroup(chatId, dto);
  }
}
