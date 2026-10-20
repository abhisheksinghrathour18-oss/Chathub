import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { ChatService } from './chat.service';

describe('ChatService', () => {
  let service: ChatService;
  let prisma: jest.Mocked<PrismaService>;

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
        createMany: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<ChatService>(ChatService);
    prisma = module.get(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

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

  it('should throw NotFoundException if userB does not exist', async () => {
    (prisma.user.findUnique as jest.Mock).mockImplementation(({ where }) => {
      if (where.id === 'user-aaa') return Promise.resolve(mockUserA);
      return Promise.resolve(null);
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
    expect(prisma.chat.findUnique).toHaveBeenCalledWith({
      where: {
        user1Id_user2Id: { user1Id: 'user-aaa', user2Id: 'user-bbb' },
      },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
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

    // Initial check outside transaction returns null
    (prisma.chat.findUnique as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(mockChat);

    // Transaction fails with P2002 (concurrent insert already committed)
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

