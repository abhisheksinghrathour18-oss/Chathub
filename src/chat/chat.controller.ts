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
  ChatService,
  CreateChatResult,
  GetMessagesResult,
  PersistedMessage,
} from './chat.service';
import { CreateChatDto } from './dto/create-chat.dto';
import { GetMessagesQueryDto } from './dto/get-messages-query.dto';
import { SendMessageDto } from './dto/send-message.dto';

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  /**
   * API 1: Create or Get 1:1 Chat
   * POST /api/chat/create
   */
  @Post('create')
  @HttpCode(HttpStatus.OK)
  async createOrGetChat(@Body() dto: CreateChatDto): Promise<CreateChatResult> {
    return this.chatService.createOrGetChat(dto);
  }

  /**
   * API 2: Send Message in 1:1 Chat
   * POST /api/chat/:chatId/message/send
   */
  @Post(':chatId/message/send')
  @HttpCode(HttpStatus.CREATED)
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
  async getMessages(
    @Param('chatId') chatId: string,
    @Query() query: GetMessagesQueryDto,
    @Headers('x-user-id') headerUserId?: string,
  ): Promise<GetMessagesResult> {
    return this.chatService.getMessages(chatId, query, headerUserId);
  }
}
