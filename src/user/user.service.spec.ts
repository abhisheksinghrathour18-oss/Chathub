import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../database/prisma.service';
import { UserService } from './user.service';

describe('UserService', () => {
  let service: UserService;
  let prisma: jest.Mocked<PrismaService>;

  const mockUser = {
    id: 'user-aaa',
    email: 'alice@example.com',
    name: 'Alice Johnson',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const mockPrismaService = {
      user: {
        findUnique: jest.fn(),
      },
      chatMember: {
        findMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
    prisma = module.get(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should throw NotFoundException if user does not exist', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(service.getUserChats('missing-user')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('should return empty list when user has no chats', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
    (prisma.chatMember.findMany as jest.Mock).mockResolvedValue([]);

    const result = await service.getUserChats('user-aaa');

    expect(result).toEqual({
      userId: 'user-aaa',
      chats: [],
      totalCount: 0,
    });
  });

  it('should return user chats and member IDs', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
    (prisma.chatMember.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'mem-1',
        chatId: 'chat-100',
        userId: 'user-aaa',
        joinedAt: new Date(),
        chat: {
          id: 'chat-100',
          createdAt: new Date('2026-10-20T10:00:00Z'),
          updatedAt: new Date('2026-10-20T10:00:00Z'),
          members: [{ userId: 'user-aaa' }, { userId: 'user-bbb' }],
        },
      },
    ]);

    const result = await service.getUserChats('user-aaa');

    expect(result.userId).toBe('user-aaa');
    expect(result.totalCount).toBe(1);
    expect(result.chats).toHaveLength(1);
    expect(result.chats[0]).toEqual({
      chatId: 'chat-100',
      memberIds: ['user-aaa', 'user-bbb'],
      createdAt: new Date('2026-10-20T10:00:00Z').toISOString(),
      updatedAt: new Date('2026-10-20T10:00:00Z').toISOString(),
    });
  });
});
