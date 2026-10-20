import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ChatType, MemberRole, Prisma } from '@prisma/client';
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

  const mockLastSeenDoc = {
    exists: false,
    set: jest.fn().mockResolvedValue({}),
    get: jest.fn().mockResolvedValue({
      exists: true,
      data: () => ({
        messageId: 'msg-1',
        updatedAt: { toDate: () => new Date('2026-10-20T13:00:00Z') },
      }),
    }),
    data: jest.fn().mockReturnValue({
      messageId: 'msg-1',
      updatedAt: { toDate: () => new Date('2026-10-20T13:00:00Z') },
    }),
  };

  beforeEach(async () => {
    const mockPrismaService = {
      user: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      chat: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      chatMember: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        createMany: jest.fn(),
        delete: jest.fn(),
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
          createdAt: {
            toDate: () => new Date('2026-10-20T12:00:00Z'),
            toMillis: () => 1700000000000,
          },
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

    const mockFirestore = {
      runTransaction: jest
        .fn()
        .mockImplementation(
          async (callback: (tx: unknown) => Promise<unknown>) => {
            const txMock = {
              get: jest.fn().mockResolvedValue({
                exists: true,
                data: () => ({
                  messageId: 'msg-1',
                  createdAt: { toMillis: () => 1700000000000 },
                }),
              }),
              set: jest.fn(),
            };
            return callback(txMock);
          },
        ),
    };

    const mockFirebaseService = {
      firestore: mockFirestore,
      getServerTimestamp: jest.fn().mockReturnValue('SERVER_TIMESTAMP'),
      getMessagesCollection: jest.fn().mockReturnValue({
        doc: jest.fn().mockReturnValue(mockMessageDoc),
        ...mockMessagesQuery,
      }),
      getMessageDocument: jest.fn().mockReturnValue(mockMessageDoc),
      getReadReceiptDocument: jest.fn().mockReturnValue(mockReceiptDoc),
      getLastSeenDocument: jest.fn().mockReturnValue(mockLastSeenDoc),
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

  describe('updateLastSeen', () => {
    it('should throw NotFoundException if chat does not exist', async () => {
      (prisma.chat.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.updateLastSeen('non-existent-chat', {
          userId: 'user-aaa',
          messageId: 'msg-1',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if user is not a member', async () => {
      (prisma.chat.findUnique as jest.Mock).mockResolvedValue(mockChat);
      (prisma.chatMember.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.updateLastSeen('chat-111', {
          userId: 'stranger-user',
          messageId: 'msg-1',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException if target message does not exist', async () => {
      (prisma.chat.findUnique as jest.Mock).mockResolvedValue(mockChat);
      (prisma.chatMember.findUnique as jest.Mock).mockResolvedValue(
        mockMembership,
      );
      (firebase.getMessageDocument as jest.Mock).mockReturnValue({
        get: jest.fn().mockResolvedValue({ exists: false }),
      });

      await expect(
        service.updateLastSeen('chat-111', {
          userId: 'user-aaa',
          messageId: 'missing-msg',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should reject moving last-seen backwards in time with BadRequestException', async () => {
      (prisma.chat.findUnique as jest.Mock).mockResolvedValue(mockChat);
      (prisma.chatMember.findUnique as jest.Mock).mockResolvedValue(
        mockMembership,
      );

      // Target message has older timestamp (1000)
      (firebase.getMessageDocument as jest.Mock).mockReturnValue({
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({
            createdAt: { toMillis: () => 1000 },
          }),
        }),
      });

      // Transaction reads current last seen message with newer timestamp (2000)
      (firebase.firestore.runTransaction as jest.Mock).mockImplementation(
        async (callback: (tx: unknown) => Promise<unknown>) => {
          const txMock = {
            get: jest.fn().mockImplementation((ref) => {
              if (ref === mockLastSeenDoc) {
                return Promise.resolve({
                  exists: true,
                  data: () => ({ messageId: 'newer-msg' }),
                });
              }
              // Current message document
              return Promise.resolve({
                exists: true,
                data: () => ({
                  createdAt: { toMillis: () => 2000 },
                }),
              });
            }),
            set: jest.fn(),
          };
          return callback(txMock);
        },
      );

      await expect(
        service.updateLastSeen('chat-111', {
          userId: 'user-aaa',
          messageId: 'older-msg',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should update last-seen successfully when moving forward', async () => {
      (prisma.chat.findUnique as jest.Mock).mockResolvedValue(mockChat);
      (prisma.chatMember.findUnique as jest.Mock).mockResolvedValue(
        mockMembership,
      );

      (firebase.getMessageDocument as jest.Mock).mockReturnValue({
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => ({
            createdAt: { toMillis: () => 3000 },
          }),
        }),
      });

      (firebase.firestore.runTransaction as jest.Mock).mockImplementation(
        async (callback: (tx: unknown) => Promise<unknown>) => {
          const txMock = {
            get: jest.fn().mockImplementation((ref) => {
              if (ref === mockLastSeenDoc) {
                return Promise.resolve({
                  exists: true,
                  data: () => ({ messageId: 'older-msg' }),
                });
              }
              return Promise.resolve({
                exists: true,
                data: () => ({
                  createdAt: { toMillis: () => 2000 },
                }),
              });
            }),
            set: jest.fn(),
          };
          return callback(txMock);
        },
      );

      const result = await service.updateLastSeen('chat-111', {
        userId: 'user-aaa',
        messageId: 'msg-newer',
      });

      expect(result.chatId).toBe('chat-111');
      expect(result.userId).toBe('user-aaa');
      expect(result.messageId).toBe('msg-newer');
      expect(result).toHaveProperty('updatedAt');
    });
  });

  describe('Milestone 10: Group Chat Management', () => {
    const mockGroupChat = {
      id: 'group-chat-1',
      type: ChatType.GROUP,
      name: 'Dev Team',
      createdById: 'user-aaa',
      user1Id: null,
      user2Id: null,
      createdAt: new Date('2026-10-21T00:00:00Z'),
      updatedAt: new Date('2026-10-21T00:00:00Z'),
      members: [
        {
          id: 'mem-1',
          chatId: 'group-chat-1',
          userId: 'user-aaa',
          role: MemberRole.ADMIN,
          joinedAt: new Date('2026-10-21T00:00:00Z'),
          user: {
            id: 'user-aaa',
            name: 'User A',
            email: 'usera@example.com',
          },
        },
        {
          id: 'mem-2',
          chatId: 'group-chat-1',
          userId: 'user-bbb',
          role: MemberRole.MEMBER,
          joinedAt: new Date('2026-10-21T00:00:00Z'),
          user: {
            id: 'user-bbb',
            name: 'User B',
            email: 'userb@example.com',
          },
        },
      ],
    };

    describe('createGroupChat', () => {
      it('should throw BadRequestException if group name is blank', async () => {
        await expect(
          service.createGroupChat({
            name: '   ',
            creatorId: 'user-aaa',
            memberIds: ['user-bbb'],
          }),
        ).rejects.toThrow(BadRequestException);
      });

      it('should throw BadRequestException if member count is less than 2 distinct members', async () => {
        await expect(
          service.createGroupChat({
            name: 'Solo Group',
            creatorId: 'user-aaa',
            memberIds: ['user-aaa'], // Only 1 distinct user
          }),
        ).rejects.toThrow(BadRequestException);
      });

      it('should throw NotFoundException if any requested user does not exist', async () => {
        (prisma.user.findMany as jest.Mock).mockResolvedValueOnce([
          { id: 'user-aaa' },
        ]); // user-bbb missing

        await expect(
          service.createGroupChat({
            name: 'Dev Team',
            creatorId: 'user-aaa',
            memberIds: ['user-bbb'],
          }),
        ).rejects.toThrow(NotFoundException);
      });

      it('should successfully create group chat in transaction and assign creator ADMIN role', async () => {
        (prisma.user.findMany as jest.Mock).mockResolvedValueOnce([
          { id: 'user-aaa' },
          { id: 'user-bbb' },
        ]);

        (prisma.$transaction as jest.Mock).mockImplementationOnce(
          async (callback: (tx: unknown) => Promise<unknown>) => {
            const txPrisma = {
              chat: {
                create: jest.fn().mockResolvedValue({
                  id: 'group-chat-1',
                  type: ChatType.GROUP,
                  name: 'Dev Team',
                  createdById: 'user-aaa',
                  createdAt: new Date('2026-10-21T00:00:00Z'),
                }),
              },
              chatMember: {
                createMany: jest.fn().mockResolvedValue({ count: 2 }),
              },
            };
            return callback(txPrisma);
          },
        );

        const result = await service.createGroupChat({
          name: 'Dev Team',
          creatorId: 'user-aaa',
          memberIds: ['user-bbb', 'user-aaa'], // duplicate creatorId should deduplicate cleanly
        });

        expect(result.chatId).toBe('group-chat-1');
        expect(result.name).toBe('Dev Team');
        expect(result.type).toBe(ChatType.GROUP);
        expect(result.creatorId).toBe('user-aaa');
        expect(result.members).toHaveLength(2);
        expect(result.members[0].role).toBe(MemberRole.ADMIN);
      });
    });

    describe('getGroupDetails', () => {
      it('should throw NotFoundException if group does not exist', async () => {
        (prisma.chat.findUnique as jest.Mock).mockResolvedValueOnce(null);

        await expect(
          service.getGroupDetails('invalid-chat-id'),
        ).rejects.toThrow(NotFoundException);
      });

      it('should throw ForbiddenException if caller is not a member of the group', async () => {
        (prisma.chat.findUnique as jest.Mock).mockResolvedValueOnce(
          mockGroupChat,
        );

        await expect(
          service.getGroupDetails('group-chat-1', 'user-outsider'),
        ).rejects.toThrow(ForbiddenException);
      });

      it('should return group details when caller is an authorized member', async () => {
        (prisma.chat.findUnique as jest.Mock).mockResolvedValueOnce(
          mockGroupChat,
        );

        const result = await service.getGroupDetails(
          'group-chat-1',
          'user-aaa',
        );

        expect(result.chatId).toBe('group-chat-1');
        expect(result.name).toBe('Dev Team');
        expect(result.members).toHaveLength(2);
        expect(result.memberCount).toBe(2);
        expect(result.members[0].name).toBe('User A');
      });
    });

    describe('addGroupMember', () => {
      it('should throw NotFoundException if group does not exist', async () => {
        (prisma.chat.findUnique as jest.Mock).mockResolvedValueOnce(null);

        await expect(
          service.addGroupMember('invalid-group', {
            actingUserId: 'user-aaa',
            userId: 'user-ccc',
          }),
        ).rejects.toThrow(NotFoundException);
      });

      it('should throw ForbiddenException if acting user is not an ADMIN', async () => {
        (prisma.chat.findUnique as jest.Mock).mockResolvedValueOnce(
          mockGroupChat,
        );

        await expect(
          service.addGroupMember('group-chat-1', {
            actingUserId: 'user-bbb', // user-bbb is MEMBER, not ADMIN
            userId: 'user-ccc',
          }),
        ).rejects.toThrow(ForbiddenException);
      });

      it('should throw ConflictException if target user is already a member', async () => {
        (prisma.chat.findUnique as jest.Mock).mockResolvedValueOnce(
          mockGroupChat,
        );

        await expect(
          service.addGroupMember('group-chat-1', {
            actingUserId: 'user-aaa',
            userId: 'user-bbb', // already a member
          }),
        ).rejects.toThrow(ConflictException);
      });

      it('should throw NotFoundException if target user does not exist', async () => {
        (prisma.chat.findUnique as jest.Mock).mockResolvedValueOnce(
          mockGroupChat,
        );
        (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce(null);

        await expect(
          service.addGroupMember('group-chat-1', {
            actingUserId: 'user-aaa',
            userId: 'non-existent-user',
          }),
        ).rejects.toThrow(NotFoundException);
      });

      it('should successfully add new member to the group', async () => {
        (prisma.chat.findUnique as jest.Mock).mockResolvedValueOnce(
          mockGroupChat,
        );
        (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce({
          id: 'user-ccc',
        });
        (prisma.chatMember.create as jest.Mock).mockResolvedValueOnce({
          id: 'mem-3',
          chatId: 'group-chat-1',
          userId: 'user-ccc',
          role: MemberRole.MEMBER,
          joinedAt: new Date('2026-10-21T01:00:00Z'),
        });

        const result = await service.addGroupMember('group-chat-1', {
          actingUserId: 'user-aaa',
          userId: 'user-ccc',
        });

        expect(result.chatId).toBe('group-chat-1');
        expect(result.userId).toBe('user-ccc');
        expect(result.role).toBe(MemberRole.MEMBER);
      });
    });

    describe('removeGroupMember', () => {
      it('should throw ForbiddenException if acting user is not an admin', async () => {
        (prisma.chat.findUnique as jest.Mock).mockResolvedValueOnce(
          mockGroupChat,
        );

        await expect(
          service.removeGroupMember('group-chat-1', 'user-aaa', 'user-bbb'),
        ).rejects.toThrow(ForbiddenException);
      });

      it('should throw NotFoundException if target user is not in the group', async () => {
        (prisma.chat.findUnique as jest.Mock).mockResolvedValueOnce(
          mockGroupChat,
        );

        await expect(
          service.removeGroupMember(
            'group-chat-1',
            'user-outsider',
            'user-aaa',
          ),
        ).rejects.toThrow(NotFoundException);
      });

      it('should throw BadRequestException when trying to remove the last admin', async () => {
        (prisma.chat.findUnique as jest.Mock).mockResolvedValueOnce(
          mockGroupChat,
        );

        await expect(
          service.removeGroupMember('group-chat-1', 'user-aaa', 'user-aaa'),
        ).rejects.toThrow(BadRequestException);
      });

      it('should successfully remove member when acting user is admin', async () => {
        (prisma.chat.findUnique as jest.Mock).mockResolvedValueOnce(
          mockGroupChat,
        );
        (prisma.chatMember.delete as jest.Mock).mockResolvedValueOnce({});

        const result = await service.removeGroupMember(
          'group-chat-1',
          'user-bbb',
          'user-aaa',
        );

        expect(result.chatId).toBe('group-chat-1');
        expect(result.userId).toBe('user-bbb');
        expect(result.removed).toBe(true);
      });
    });

    describe('leaveGroup', () => {
      it('should throw ForbiddenException if user is not in group', async () => {
        (prisma.chat.findUnique as jest.Mock).mockResolvedValueOnce(
          mockGroupChat,
        );

        await expect(
          service.leaveGroup('group-chat-1', { userId: 'user-outsider' }),
        ).rejects.toThrow(ForbiddenException);
      });

      it('should throw BadRequestException if last admin leaves while other members remain', async () => {
        (prisma.chat.findUnique as jest.Mock).mockResolvedValueOnce(
          mockGroupChat,
        );

        await expect(
          service.leaveGroup('group-chat-1', { userId: 'user-aaa' }),
        ).rejects.toThrow(BadRequestException);
      });

      it('should successfully allow non-admin member to leave group', async () => {
        (prisma.chat.findUnique as jest.Mock).mockResolvedValueOnce(
          mockGroupChat,
        );
        (prisma.chatMember.delete as jest.Mock).mockResolvedValueOnce({});

        const result = await service.leaveGroup('group-chat-1', {
          userId: 'user-bbb',
        });

        expect(result.chatId).toBe('group-chat-1');
        expect(result.userId).toBe('user-bbb');
        expect(result.left).toBe(true);
      });
    });
  });
});
