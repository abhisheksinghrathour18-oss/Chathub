import { Test, TestingModule } from '@nestjs/testing';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

describe('ChatController', () => {
  let controller: ChatController;
  let service: jest.Mocked<ChatService>;

  beforeEach(async () => {
    const mockChatService = {
      createOrGetChat: jest.fn(),
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
});

