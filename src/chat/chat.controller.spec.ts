import { Test, TestingModule } from '@nestjs/testing';
import { ChatType, MemberRole } from '@prisma/client';
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
      createGroupChat: jest.fn(),
      getGroupDetails: jest.fn(),
      addGroupMember: jest.fn(),
      removeGroupMember: jest.fn(),
      leaveGroup: jest.fn(),
      editMessage: jest.fn(),
      deleteMessage: jest.fn(),
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

  describe('Milestone 10: Group Chat Endpoints', () => {
    it('should delegate createGroupChat to service and return result', async () => {
      const mockResult = {
        chatId: 'group-1',
        name: 'Dev Team',
        type: ChatType.GROUP,
        creatorId: 'user-1',
        members: [
          { userId: 'user-1', role: MemberRole.ADMIN },
          { userId: 'user-2', role: MemberRole.MEMBER },
        ],
        createdAt: '2026-10-21T00:00:00.000Z',
      };
      service.createGroupChat.mockResolvedValue(mockResult);

      const dto = {
        name: 'Dev Team',
        creatorId: 'user-1',
        memberIds: ['user-2'],
      };
      const result = await controller.createGroupChat(dto);

      expect(result).toEqual(mockResult);
      expect(service.createGroupChat).toHaveBeenCalledWith(dto);
    });

    it('should delegate getGroupDetails to service with query userId', async () => {
      const mockResult = {
        chatId: 'group-1',
        name: 'Dev Team',
        type: ChatType.GROUP,
        creatorId: 'user-1',
        members: [
          {
            userId: 'user-1',
            name: 'User 1',
            email: 'u1@example.com',
            role: MemberRole.ADMIN,
            joinedAt: '2026-10-21T00:00:00.000Z',
          },
        ],
        memberCount: 1,
        createdAt: '2026-10-21T00:00:00.000Z',
        updatedAt: '2026-10-21T00:00:00.000Z',
      };
      service.getGroupDetails.mockResolvedValue(mockResult);

      const result = await controller.getGroupDetails('group-1', {
        userId: 'user-1',
      });

      expect(result).toEqual(mockResult);
      expect(service.getGroupDetails).toHaveBeenCalledWith('group-1', 'user-1');
    });

    it('should delegate addGroupMember to service and return result', async () => {
      const mockResult = {
        chatId: 'group-1',
        userId: 'user-3',
        role: MemberRole.MEMBER,
        joinedAt: '2026-10-21T00:00:00.000Z',
      };
      service.addGroupMember.mockResolvedValue(mockResult);

      const dto = { actingUserId: 'user-1', userId: 'user-3' };
      const result = await controller.addGroupMember('group-1', dto);

      expect(result).toEqual(mockResult);
      expect(service.addGroupMember).toHaveBeenCalledWith('group-1', dto);
    });

    it('should delegate removeGroupMember to service and return result', async () => {
      const mockResult = {
        chatId: 'group-1',
        userId: 'user-3',
        removed: true,
      };
      service.removeGroupMember.mockResolvedValue(mockResult);

      const result = await controller.removeGroupMember('group-1', 'user-3', {
        actingUserId: 'user-1',
      });

      expect(result).toEqual(mockResult);
      expect(service.removeGroupMember).toHaveBeenCalledWith(
        'group-1',
        'user-3',
        'user-1',
      );
    });

    it('should delegate leaveGroup to service and return result', async () => {
      const mockResult = {
        chatId: 'group-1',
        userId: 'user-2',
        left: true,
      };
      service.leaveGroup.mockResolvedValue(mockResult);

      const dto = { userId: 'user-2' };
      const result = await controller.leaveGroup('group-1', dto);

      expect(result).toEqual(mockResult);
      expect(service.leaveGroup).toHaveBeenCalledWith('group-1', dto);
    });
  });

  describe('Milestone 11: Message Edit and Delete Endpoints', () => {
    it('should delegate editMessage to service and return result', async () => {
      const mockResult = {
        id: 'msg-1',
        chatId: 'chat-1',
        senderId: 'user-1',
        text: 'Edited text',
        createdAt: '2026-10-21T00:00:00.000Z',
        editedAt: '2026-10-21T00:05:00.000Z',
        isDeleted: false,
      };
      service.editMessage.mockResolvedValue(mockResult);

      const dto = { senderId: 'user-1', text: 'Edited text' };
      const result = await controller.editMessage('chat-1', 'msg-1', dto);

      expect(result).toEqual(mockResult);
      expect(service.editMessage).toHaveBeenCalledWith('chat-1', 'msg-1', dto);
    });

    it('should delegate deleteMessage to service and return result', async () => {
      const mockResult = {
        id: 'msg-1',
        chatId: 'chat-1',
        senderId: 'user-1',
        isDeleted: true,
        deletedAt: '2026-10-21T00:10:00.000Z',
      };
      service.deleteMessage.mockResolvedValue(mockResult);

      const result = await controller.deleteMessage('chat-1', 'msg-1', {
        senderId: 'user-1',
      });

      expect(result).toEqual(mockResult);
      expect(service.deleteMessage).toHaveBeenCalledWith(
        'chat-1',
        'msg-1',
        'user-1',
      );
    });
  });
});
