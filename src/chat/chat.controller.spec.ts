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
      markMessageRead: jest.fn(),
      updateLastSeen: jest.fn(),
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

  it('should delegate markMessageRead to service and return result', async () => {
    const mockReceipt = {
      chatId: 'chat-1',
      messageId: 'msg-123',
      userId: 'user-2',
      readAt: '2026-10-20T13:00:00.000Z',
      isNew: true,
    };
    service.markMessageRead.mockResolvedValue(mockReceipt);

    const result = await controller.markMessageRead('chat-1', 'msg-123', {
      userId: 'user-2',
    });

    expect(result).toEqual(mockReceipt);
    expect(service.markMessageRead).toHaveBeenCalledWith('chat-1', 'msg-123', {
      userId: 'user-2',
    });
  });

  it('should delegate updateLastSeen to service and return result', async () => {
    const mockLastSeenResult = {
      chatId: 'chat-1',
      userId: 'user-2',
      messageId: 'msg-123',
      updatedAt: '2026-10-20T13:05:00.000Z',
    };
    service.updateLastSeen.mockResolvedValue(mockLastSeenResult);

    const result = await controller.updateLastSeen('chat-1', {
      userId: 'user-2',
      messageId: 'msg-123',
    });

    expect(result).toEqual(mockLastSeenResult);
    expect(service.updateLastSeen).toHaveBeenCalledWith('chat-1', {
      userId: 'user-2',
      messageId: 'msg-123',
    });
  });
});
