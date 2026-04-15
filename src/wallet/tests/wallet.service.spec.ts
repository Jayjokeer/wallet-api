import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { WalletService } from '../wallet.service';
import { WalletRepository } from '../wallet.repository';
import { UserRole } from '../../users/entities/user.entity';

const mockWalletRepository = {
  create: jest.fn(),
  findByUserId: jest.fn(),
  findById: jest.fn(),
  findAll: jest.fn(),
};

const userA = { id: 'user-a', email: 'a@test.com', role: UserRole.USER, createdAt: new Date() };
const userB = { id: 'user-b', email: 'b@test.com', role: UserRole.USER, createdAt: new Date() };
const adminUser = { id: 'admin-1', email: 'admin@test.com', role: UserRole.ADMIN, createdAt: new Date() };

const walletA = { id: 'wallet-a', userId: 'user-a', balance: '500.00', currency: 'NGN' };

describe('WalletService', () => {
  let service: WalletService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletService,
        { provide: WalletRepository, useValue: mockWalletRepository },
      ],
    }).compile();

    service = module.get<WalletService>(WalletService);
    jest.clearAllMocks();
  });

  describe('getWallet — BOLA protection', () => {
    it('should return own wallet when user requests their own', async () => {
      mockWalletRepository.findByUserId.mockResolvedValue(walletA);
      const result = await service.getWallet(userA as any);
      expect(result.id).toBe(walletA.id);
    });

    it('should throw ForbiddenException when user requests another users wallet', async () => {
      await expect(
        service.getWallet(userB as any, userA.id),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow admin to access any users wallet', async () => {
      mockWalletRepository.findByUserId.mockResolvedValue(walletA);
      const result = await service.getWallet(adminUser as any, userA.id);
      expect(result.id).toBe(walletA.id);
    });

    it('should throw NotFoundException when wallet does not exist', async () => {
      mockWalletRepository.findByUserId.mockResolvedValue(null);
      await expect(service.getWallet(userA as any)).rejects.toThrow(NotFoundException);
    });
  });

  describe('createWallet', () => {
    it('should create a wallet with default NGN currency', async () => {
      mockWalletRepository.create.mockResolvedValue(walletA);
      const result = await service.createWallet(userA.id);
      expect(mockWalletRepository.create).toHaveBeenCalledWith(userA.id, 'NGN');
      expect(result).toEqual(walletA);
    });
  });
});
