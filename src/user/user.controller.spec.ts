import { Test, TestingModule } from '@nestjs/testing';
import { UserController } from './user.controller';
import { UserService } from './user.service';

describe('UserController', () => {
  let controller: UserController;
  let service: jest.Mocked<UserService>;

  beforeEach(async () => {
    const mockUserService = {
      getUserChats: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [
        {
          provide: UserService,
          useValue: mockUserService,
        },
      ],
    }).compile();

    controller = module.get<UserController>(UserController);
    service = module.get(UserService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should delegate getUserChats to service and return result', async () => {
    const mockResult = {
      userId: 'user-1',
      chats: [],
      totalCount: 0,
    };
    service.getUserChats.mockResolvedValue(mockResult);

    const result = await controller.getUserChats('user-1');

    expect(result).toEqual(mockResult);
    expect(service.getUserChats).toHaveBeenCalledWith('user-1');
  });
});

