import { Test, TestingModule } from '@nestjs/testing';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

describe('ChatController', () => {
  let controller: ChatController;
  let service: jest.Mocked<ChatService>;

  beforeEach(async () => {
    const mockChatService = {
      createOrGetChat: jest.fn(),
      sendMessage: jest.fn(),
      getMessages: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [
        {
          provide: ChatService,
          useValue: mockChatService,
        },
      ],
    }).compile();

    controller = module.get<ChatController>(ChatController);
    service = module.get(ChatService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should delegate createOrGetChat to service and return result', async () => {
    service.createOrGetChat.mockResolvedValue({ chatId: 'chat-xyz-123' });

    const result = await controller.createOrGetChat({
      userAId: 'user-1',
      userBId: 'user-2',
    });

    expect(result).toEqual({ chatId: 'chat-xyz-123' });
    expect(service.createOrGetChat).toHaveBeenCalledWith({
      userAId: 'user-1',
      userBId: 'user-2',
    });
  });

  it('should delegate sendMessage to service and return result', async () => {
    const mockMessage = {
      id: 'msg-123',
      senderId: 'user-1',
      text: 'Hello',
      createdAt: '2026-10-20T12:00:00.000Z',
    };
    service.sendMessage.mockResolvedValue(mockMessage);

    const result = await controller.sendMessage('chat-1', {
      senderId: 'user-1',
      text: 'Hello',
    });

    expect(result).toEqual(mockMessage);
    expect(service.sendMessage).toHaveBeenCalledWith('chat-1', {
      senderId: 'user-1',
      text: 'Hello',
    });
  });

  it('should delegate getMessages to service and return result', async () => {
    const mockMessagesResult = {
      chatId: 'chat-1',
      messages: [],
      pagination: { limit: 50, nextCursor: null },
    };
    service.getMessages.mockResolvedValue(mockMessagesResult);

    const result = await controller.getMessages(
      'chat-1',
      { limit: 50 },
      'user-1',
    );

    expect(result).toEqual(mockMessagesResult);
    expect(service.getMessages).toHaveBeenCalledWith(
      'chat-1',
      { limit: 50 },
      'user-1',
    );
  });
});
