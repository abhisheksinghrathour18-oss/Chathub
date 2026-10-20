import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ChatService, CreateChatResult } from './chat.service';
import { CreateChatDto } from './dto/create-chat.dto';

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post('create')
  @HttpCode(HttpStatus.OK)
  async createOrGetChat(@Body() dto: CreateChatDto): Promise<CreateChatResult> {
    return this.chatService.createOrGetChat(dto);
  }
}
