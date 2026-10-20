import {
  Body,
  Controller,
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
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  ChatService,
  CreateChatResult,
  GetMessagesResult,
  LastSeenResult,
  PersistedMessage,
  ReadReceiptResult,
} from './chat.service';
import { CreateChatDto } from './dto/create-chat.dto';
import { GetMessagesQueryDto } from './dto/get-messages-query.dto';
import { MarkReadDto } from './dto/mark-read.dto';
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
}
