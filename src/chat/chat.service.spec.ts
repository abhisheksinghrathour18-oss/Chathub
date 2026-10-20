import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { FirebaseService } from '../firebase/firebase.service';
import { ChatService } from './chat.service';

describe('ChatService', () => {
  let service: ChatService;
  let prisma: jest.Mocked<PrismaService>;
  let firebase: jest.Mocked<FirebaseService>;

  const mockUserA = {
    id: 'user-aaa',
    email: 'usera@example.com',
    name: 'User A',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockUserB = {
    id: 'user-bbb',
    email: 'userb@example.com',
    name: 'User B',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockChat = {
    id: 'chat-111',
    user1Id: 'user-aaa',
    user2Id: 'user-bbb',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockMembership = {
    id: 'mem-111',
    chatId: 'chat-111',
    userId: 'user-aaa',
    joinedAt: new Date(),
  };

  const mockReceiptDoc = {
    exists: false,
    set: jest.fn().mockResolvedValue({}),
    get: jest.fn(),
    data: jest.fn().mockReturnValue({
      userId: 'user-aaa',
      readAt: { toDate: () => new Date('2026-10-20T13:00:00Z') },
    }),
  };

  beforeEach(async () => {
    const mockPrismaService = {
      user: {
        findUnique: jest.fn(),
      },
      chat: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      chatMember: {
        findUnique: jest.fn(),
        createMany: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    const mockMessageDoc = {
      id: 'msg-999',
      exists: true,
      set: jest.fn().mockResolvedValue({}),
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          senderId: 'user-aaa',
          text: 'Hello World',
          createdAt: { toDate: () => new Date('2026-10-20T12:00:00Z') },
        }),
      }),
    };

    const mockMessagesQuery: {
      orderBy: jest.Mock;
      limit: jest.Mock;
      startAfter: jest.Mock;
      get: jest.Mock;
    } = {
      orderBy: jest.fn(),
      limit: jest.fn(),
      startAfter: jest.fn(),
      get: jest.fn().mockResolvedValue({
        docs: [
          {
            id: 'msg-1',
            data: () => ({
              senderId: 'user-aaa',
              text: 'First msg',
              createdAt: { toDate: () => new Date('2026-10-20T12:00:00Z') },
            }),
          },
          {
            id: 'msg-2',
            data: () => ({
              senderId: 'user-bbb',
              text: 'Second msg',
              createdAt: { toDate: () => new Date('2026-10-20T12:01:00Z') },
            }),
          },
        ],
      }),
    };
    mockMessagesQuery.orderBy.mockReturnValue(mockMessagesQuery);
    mockMessagesQuery.limit.mockReturnValue(mockMessagesQuery);
    mockMessagesQuery.startAfter.mockReturnValue(mockMessagesQuery);

    const mockFirebaseService = {
      getServerTimestamp: jest.fn().mockReturnValue('SERVER_TIMESTAMP'),
      getMessagesCollection: jest.fn().mockReturnValue({
        doc: jest.fn().mockReturnValue(mockMessageDoc),
        ...mockMessagesQuery,
      }),
      getMessageDocument: jest.fn().mockReturnValue(mockMessageDoc),
      getReadReceiptDocument: jest.fn().mockReturnValue(mockReceiptDoc),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: FirebaseService,
          useValue: mockFirebaseService,
        },
      ],
    }).compile();

    service = module.get<ChatService>(ChatService);
    prisma = module.get(PrismaService);
    firebase = module.get(FirebaseService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createOrGetChat', () => {
    it('should reject identical user IDs with BadRequestException', async () => {
      await expect(
        service.createOrGetChat({ userAId: 'user-1', userBId: 'user-1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if userA does not exist', async () => {
      (prisma.user.findUnique as jest.Mock).mockImplementation(({ where }) => {
        if (where.id === 'user-aaa') return Promise.resolve(null);
        return Promise.resolve(mockUserB);
      });

      await expect(
        service.createOrGetChat({ userAId: 'user-aaa', userBId: 'user-bbb' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should return existing chat if already present', async () => {
      (prisma.user.findUnique as jest.Mock).mockImplementation(({ where }) => {
        if (where.id === 'user-aaa') return Promise.resolve(mockUserA);
        if (where.id === 'user-bbb') return Promise.resolve(mockUserB);
        return Promise.resolve(null);
      });

      (prisma.chat.findUnique as jest.Mock).mockResolvedValue(mockChat);

      const result = await service.createOrGetChat({
        userAId: 'user-bbb',
        userBId: 'user-aaa',
      });

      expect(result).toEqual({ chatId: 'chat-111' });
    });

    it('should create new chat and members atomically if not found', async () => {
      (prisma.user.findUnique as jest.Mock).mockImplementation(({ where }) => {
        if (where.id === 'user-aaa') return Promise.resolve(mockUserA);
        if (where.id === 'user-bbb') return Promise.resolve(mockUserB);
        return Promise.resolve(null);
      });

      (prisma.chat.findUnique as jest.Mock).mockResolvedValue(null);

      (prisma.$transaction as jest.Mock).mockImplementation(
        async (callback: (tx: unknown) => Promise<unknown>) => {
          const txMock = {
            chat: {
              findUnique: jest.fn().mockResolvedValue(null),
              create: jest.fn().mockResolvedValue(mockChat),
            },
            chatMember: {
              createMany: jest.fn().mockResolvedValue({ count: 2 }),
            },
          };
          return callback(txMock);
        },
      );

      const result = await service.createOrGetChat({
        userAId: 'user-aaa',
        userBId: 'user-bbb',
      });

      expect(result).toEqual({ chatId: 'chat-111' });
    });

    it('should safely handle P2002 unique constraint race condition', async () => {
      (prisma.user.findUnique as jest.Mock).mockImplementation(({ where }) => {
        if (where.id === 'user-aaa') return Promise.resolve(mockUserA);
        if (where.id === 'user-bbb') return Promise.resolve(mockUserB);
        return Promise.resolve(null);
      });

      (prisma.chat.findUnique as jest.Mock)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockChat);

      const p2002Error = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint violation',
        {
          code: 'P2002',
          clientVersion: '6.4.1',
        },
      );
      (prisma.$transaction as jest.Mock).mockRejectedValue(p2002Error);

      const result = await service.createOrGetChat({
        userAId: 'user-aaa',
        userBId: 'user-bbb',
      });

      expect(result).toEqual({ chatId: 'chat-111' });
    });
  });

  describe('sendMessage', () => {
    it('should throw NotFoundException if chat does not exist', async () => {
      (prisma.chat.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.sendMessage('non-existent-chat', {
          senderId: 'user-aaa',
          text: 'Hello',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if sender is not a member of the chat', async () => {
      (prisma.chat.findUnique as jest.Mock).mockResolvedValue(mockChat);
      (prisma.chatMember.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.sendMessage('chat-111', {
          senderId: 'stranger-user',
          text: 'Hello',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should store message in Firestore and return persisted message', async () => {
      (prisma.chat.findUnique as jest.Mock).mockResolvedValue(mockChat);
      (prisma.chatMember.findUnique as jest.Mock).mockResolvedValue(
        mockMembership,
      );

      const result = await service.sendMessage('chat-111', {
        senderId: 'user-aaa',
        text: 'Hello World',
      });

      expect(result).toEqual({
        id: 'msg-999',
        senderId: 'user-aaa',
        text: 'Hello World',
        createdAt: new Date('2026-10-20T12:00:00Z').toISOString(),
      });
      expect(firebase.getMessagesCollection).toHaveBeenCalledWith('chat-111');
    });
  });

  describe('getMessages', () => {
    it('should throw NotFoundException if chat does not exist', async () => {
      (prisma.chat.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.getMessages('non-existent-chat', { limit: 50 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if caller is not a member', async () => {
      (prisma.chat.findUnique as jest.Mock).mockResolvedValue(mockChat);
      (prisma.chatMember.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.getMessages('chat-111', {
          userId: 'stranger-user',
          limit: 50,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should return chronological messages with pagination', async () => {
      (prisma.chat.findUnique as jest.Mock).mockResolvedValue(mockChat);
      (prisma.chatMember.findUnique as jest.Mock).mockResolvedValue(
        mockMembership,
      );

      const result = await service.getMessages('chat-111', {
        userId: 'user-aaa',
        limit: 50,
      });

      expect(result.chatId).toBe('chat-111');
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0]?.id).toBe('msg-1');
      expect(result.messages[1]?.id).toBe('msg-2');
      expect(result.pagination.limit).toBe(50);
      expect(result.pagination.nextCursor).toBeNull();
    });
  });

  describe('markMessageRead', () => {
    it('should throw NotFoundException if chat does not exist', async () => {
      (prisma.chat.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.markMessageRead('non-existent-chat', 'msg-1', {
          userId: 'user-aaa',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if user is not a member', async () => {
      (prisma.chat.findUnique as jest.Mock).mockResolvedValue(mockChat);
      (prisma.chatMember.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.markMessageRead('chat-111', 'msg-1', {
          userId: 'stranger-user',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException if message does not exist in Firestore', async () => {
      (prisma.chat.findUnique as jest.Mock).mockResolvedValue(mockChat);
      (prisma.chatMember.findUnique as jest.Mock).mockResolvedValue(
        mockMembership,
      );
      (firebase.getMessageDocument as jest.Mock).mockReturnValue({
        get: jest.fn().mockResolvedValue({ exists: false }),
      });

      await expect(
        service.markMessageRead('chat-111', 'msg-missing', {
          userId: 'user-aaa',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should write new read receipt when not previously read', async () => {
      (prisma.chat.findUnique as jest.Mock).mockResolvedValue(mockChat);
      (prisma.chatMember.findUnique as jest.Mock).mockResolvedValue(
        mockMembership,
      );
      (firebase.getMessageDocument as jest.Mock).mockReturnValue({
        get: jest.fn().mockResolvedValue({ exists: true }),
      });

      const receiptRef = {
        get: jest
          .fn()
          .mockResolvedValueOnce({ exists: false })
          .mockResolvedValueOnce({
            exists: true,
            data: () => ({
              userId: 'user-aaa',
              readAt: { toDate: () => new Date('2026-10-20T13:00:00Z') },
            }),
          }),
        set: jest.fn().mockResolvedValue({}),
      };
      (firebase.getReadReceiptDocument as jest.Mock).mockReturnValue(
        receiptRef,
      );

      const result = await service.markMessageRead('chat-111', 'msg-1', {
        userId: 'user-aaa',
      });

      expect(result.chatId).toBe('chat-111');
      expect(result.messageId).toBe('msg-1');
      expect(result.userId).toBe('user-aaa');
      expect(result.isNew).toBe(true);
      expect(receiptRef.set).toHaveBeenCalled();
    });

    it('should return existing read receipt idempotently if already read', async () => {
      (prisma.chat.findUnique as jest.Mock).mockResolvedValue(mockChat);
      (prisma.chatMember.findUnique as jest.Mock).mockResolvedValue(
        mockMembership,
      );
      (firebase.getMessageDocument as jest.Mock).mockReturnValue({
        get: jest.fn().mockResolvedValue({ exists: true }),
      });

      const receiptRef = {
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({
            userId: 'user-aaa',
            readAt: { toDate: () => new Date('2026-10-20T12:30:00Z') },
          }),
        }),
        set: jest.fn(),
      };
      (firebase.getReadReceiptDocument as jest.Mock).mockReturnValue(
        receiptRef,
      );

      const result = await service.markMessageRead('chat-111', 'msg-1', {
        userId: 'user-aaa',
      });

      expect(result.chatId).toBe('chat-111');
      expect(result.isNew).toBe(false);
      expect(result.readAt).toBe(
        new Date('2026-10-20T12:30:00Z').toISOString(),
      );
      expect(receiptRef.set).not.toHaveBeenCalled();
    });
  });
});
