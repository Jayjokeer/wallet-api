import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TransactionsService } from '../transactions.service';
import { TransactionsRepository } from '../transactions.repository';
import { WalletService } from '../../wallet/wallet.service';
import { WalletRepository } from '../../wallet/wallet.repository';
import { TransactionType, TransactionStatus } from '../entities/transaction.entity';
import { UserRole } from '../../users/entities/user.entity';

// ── Shared fixtures ───────────────────────────────────────────────────────────
const mockUser = {
  id: 'user-uuid-1',
  email: 'test@example.com',
  role: UserRole.USER,
  createdAt: new Date(),
};

const mockWallet = {
  id: 'wallet-uuid-1',
  userId: 'user-uuid-1',
  balance: '150.00',
  currency: 'NGN',
};

const buildMockTransaction = (overrides = {}) => ({
  id: 'tx-uuid-1',
  reference: 'TXN-mock-ref',
  walletId: 'wallet-uuid-1',
  type: TransactionType.DEBIT,
  amount: '100.00',
  status: TransactionStatus.PENDING,
  idempotencyKey: 'key-1',
  createdAt: new Date(),
  ...overrides,
});

// ── QueryRunner factory ───────────────────────────────────────────────────────
/**
 * Creates a fresh mock QueryRunner for each test.
 * All methods are individually spied so tests can assert call order and args.
 */
const buildMockQueryRunner = () => ({
  connect: jest.fn().mockResolvedValue(undefined),
  startTransaction: jest.fn().mockResolvedValue(undefined),
  commitTransaction: jest.fn().mockResolvedValue(undefined),
  rollbackTransaction: jest.fn().mockResolvedValue(undefined),
  release: jest.fn().mockResolvedValue(undefined),
  manager: {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
  },
});

const mockDataSource = {
  createQueryRunner: jest.fn(),
};

const mockTransactionsRepository = {
  findByIdempotencyKey: jest.fn(),
  createPending: jest.fn(),
  updateStatus: jest.fn(),
  findByWalletId: jest.fn(),
  findAllPaginated: jest.fn(),
};

const mockWalletService = {
  getWalletByUserId: jest.fn(),
};

const mockWalletRepository = {
  findByIdWithLock: jest.fn(),
};

// ── Test suite ────────────────────────────────────────────────────────────────
describe('TransactionsService', () => {
  let service: TransactionsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionsService,
        { provide: getDataSourceToken(), useValue: mockDataSource },
        { provide: TransactionsRepository, useValue: mockTransactionsRepository },
        { provide: WalletService, useValue: mockWalletService },
        { provide: WalletRepository, useValue: mockWalletRepository },
      ],
    }).compile();

    service = module.get<TransactionsService>(TransactionsService);
    jest.clearAllMocks();
  });

  // ── 1. Negative balance prevention ───────────────────────────────────────
  describe('Negative Balance Prevention', () => {
    it('should return FAILED status when debit exceeds balance', async () => {
      const qr = buildMockQueryRunner();
      mockDataSource.createQueryRunner.mockReturnValue(qr);
      mockWalletService.getWalletByUserId.mockResolvedValue(mockWallet);
      mockTransactionsRepository.findByIdempotencyKey.mockResolvedValue(null);
      mockWalletRepository.findByIdWithLock.mockResolvedValue({
        ...mockWallet,
        balance: '50.00', // only 50 available
      });
      const pendingTx = buildMockTransaction({ amount: '200.00' });
      mockTransactionsRepository.createPending.mockResolvedValue(pendingTx);
      mockTransactionsRepository.updateStatus.mockResolvedValue(undefined);

      const result = await service.processTransaction(mockUser as any, {
        amount: 200.00, // trying to debit 200 from 50
        type: TransactionType.DEBIT,
        idempotencyKey: 'key-insufficient',
      });

      expect(result.status).toBe(TransactionStatus.FAILED);
      // Balance must NOT have been updated
      expect(qr.manager.update).not.toHaveBeenCalled();
      // Should commit (to persist the FAILED record for idempotency)
      expect(qr.commitTransaction).toHaveBeenCalledTimes(1);
    });

    it('should never allow balance to go negative — exact boundary (balance === amount)', async () => {
      const qr = buildMockQueryRunner();
      mockDataSource.createQueryRunner.mockReturnValue(qr);
      mockWalletService.getWalletByUserId.mockResolvedValue(mockWallet);
      mockTransactionsRepository.findByIdempotencyKey.mockResolvedValue(null);
      mockWalletRepository.findByIdWithLock.mockResolvedValue({
        ...mockWallet,
        balance: '100.00', // exactly equal to debit amount
      });
      const pendingTx = buildMockTransaction({ amount: '100.00' });
      mockTransactionsRepository.createPending.mockResolvedValue(pendingTx);
      mockTransactionsRepository.updateStatus.mockResolvedValue(undefined);

      const result = await service.processTransaction(mockUser as any, {
        amount: 100.00,
        type: TransactionType.DEBIT,
        idempotencyKey: 'key-exact',
      });

      // Exact amount should SUCCEED (balance → 0.00, not negative)
      expect(result.status).toBe(TransactionStatus.SUCCESS);
      expect(qr.manager.update).toHaveBeenCalledWith(
        'wallets',
        { id: mockWallet.id },
        { balance: '0.00' },
      );
    });

    it('should succeed credit regardless of current balance', async () => {
      const qr = buildMockQueryRunner();
      mockDataSource.createQueryRunner.mockReturnValue(qr);
      mockWalletService.getWalletByUserId.mockResolvedValue(mockWallet);
      mockTransactionsRepository.findByIdempotencyKey.mockResolvedValue(null);
      mockWalletRepository.findByIdWithLock.mockResolvedValue({
        ...mockWallet,
        balance: '0.00',
      });
      const pendingTx = buildMockTransaction({
        type: TransactionType.CREDIT,
        amount: '500.00',
      });
      mockTransactionsRepository.createPending.mockResolvedValue(pendingTx);
      mockTransactionsRepository.updateStatus.mockResolvedValue(undefined);

      const result = await service.processTransaction(mockUser as any, {
        amount: 500.00,
        type: TransactionType.CREDIT,
        idempotencyKey: 'key-credit',
      });

      expect(result.status).toBe(TransactionStatus.SUCCESS);
      expect(qr.manager.update).toHaveBeenCalledWith(
        'wallets',
        { id: mockWallet.id },
        { balance: '500.00' },
      );
    });
  });

  // ── 2. Idempotency ────────────────────────────────────────────────────────
  describe('Idempotency', () => {
    it('should return the original transaction when idempotencyKey is duplicated', async () => {
      const qr = buildMockQueryRunner();
      mockDataSource.createQueryRunner.mockReturnValue(qr);
      mockWalletService.getWalletByUserId.mockResolvedValue(mockWallet);

      const existingTx = buildMockTransaction({
        status: TransactionStatus.SUCCESS,
        idempotencyKey: 'duplicate-key',
      });
      mockTransactionsRepository.findByIdempotencyKey.mockResolvedValue(existingTx);

      const result = await service.processTransaction(mockUser as any, {
        amount: 100.00,
        type: TransactionType.DEBIT,
        idempotencyKey: 'duplicate-key',
      });

      // Must return original, not reprocess
      expect(result.id).toBe(existingTx.id);
      expect(result.status).toBe(TransactionStatus.SUCCESS);

      // Wallet must NOT have been touched
      expect(mockWalletRepository.findByIdWithLock).not.toHaveBeenCalled();
      expect(qr.manager.update).not.toHaveBeenCalled();

      // QueryRunner must be rolled back (not committed) for duplicate
      expect(qr.rollbackTransaction).toHaveBeenCalledTimes(1);
      expect(qr.commitTransaction).not.toHaveBeenCalled();
    });

    it('should NOT process a failed transaction twice with the same key', async () => {
      const qr = buildMockQueryRunner();
      mockDataSource.createQueryRunner.mockReturnValue(qr);
      mockWalletService.getWalletByUserId.mockResolvedValue(mockWallet);

      const existingFailedTx = buildMockTransaction({
        status: TransactionStatus.FAILED,
        idempotencyKey: 'failed-key',
      });
      mockTransactionsRepository.findByIdempotencyKey.mockResolvedValue(existingFailedTx);

      const result = await service.processTransaction(mockUser as any, {
        amount: 100.00,
        type: TransactionType.DEBIT,
        idempotencyKey: 'failed-key',
      });

      // Returns the original FAILED result — does not retry
      expect(result.status).toBe(TransactionStatus.FAILED);
      expect(mockWalletRepository.findByIdWithLock).not.toHaveBeenCalled();
    });
  });

  // ── 3. Concurrency simulation ─────────────────────────────────────────────
  describe('Concurrency — Two Parallel Debits', () => {
    /**
     * This test simulates the race condition scenario from Section 3:
     * - Wallet balance: 150
     * - Two concurrent debit requests of 100 each
     * - Expected: one succeeds (balance → 50), one fails
     *
     * The SELECT FOR UPDATE lock is mocked at the repository layer.
     * The real guarantee is that in production MySQL, the second
     * request blocks until the first commits, then sees balance=50 < 100.
     */
    it('should correctly handle two sequential debits — first succeeds, second fails', async () => {
      let currentBalance = 150.00;

      // Simulate two separate QueryRunners (two DB connections)
      const buildQR = () => {
        const qr = buildMockQueryRunner();
        // Each QR sees the balance at lock time
        mockWalletRepository.findByIdWithLock.mockImplementation(async () => ({
          ...mockWallet,
          balance: currentBalance.toFixed(2),
        }));
        return qr;
      };

      // --- Request 1 ---
      const qr1 = buildQR();
      mockDataSource.createQueryRunner
        .mockReturnValueOnce(qr1);
      mockTransactionsRepository.findByIdempotencyKey.mockResolvedValueOnce(null);
      const tx1 = buildMockTransaction({ idempotencyKey: 'concurrent-1' });
      mockTransactionsRepository.createPending.mockResolvedValueOnce(tx1);
      mockTransactionsRepository.updateStatus.mockResolvedValue(undefined);

      // Intercept the balance update to apply it to our shared state
      qr1.manager.update.mockImplementation(async (_table: string, _where: any, data: any) => {
        currentBalance = parseFloat(data.balance);
      });

      const result1 = await service.processTransaction(mockUser as any, {
        amount: 100.00,
        type: TransactionType.DEBIT,
        idempotencyKey: 'concurrent-1',
      });

      // --- Request 2 (sees updated balance after lock) ---
      const qr2 = buildQR();
      mockDataSource.createQueryRunner.mockReturnValueOnce(qr2);
      mockTransactionsRepository.findByIdempotencyKey.mockResolvedValueOnce(null);
      const tx2 = buildMockTransaction({ id: 'tx-uuid-2', idempotencyKey: 'concurrent-2' });
      mockTransactionsRepository.createPending.mockResolvedValueOnce(tx2);

      const result2 = await service.processTransaction(mockUser as any, {
        amount: 100.00,
        type: TransactionType.DEBIT,
        idempotencyKey: 'concurrent-2',
      });

      // Assertions
      expect(result1.status).toBe(TransactionStatus.SUCCESS);
      expect(result2.status).toBe(TransactionStatus.FAILED);

      // Final balance should be 50 — not 150, not negative, not 0
      expect(currentBalance).toBe(50.00);
    });

    it('should acquire row-level lock for every debit', async () => {
      const qr = buildMockQueryRunner();
      mockDataSource.createQueryRunner.mockReturnValue(qr);
      mockWalletService.getWalletByUserId.mockResolvedValue(mockWallet);
      mockTransactionsRepository.findByIdempotencyKey.mockResolvedValue(null);
      mockWalletRepository.findByIdWithLock.mockResolvedValue({
        ...mockWallet,
        balance: '150.00',
      });
      const tx = buildMockTransaction();
      mockTransactionsRepository.createPending.mockResolvedValue(tx);
      mockTransactionsRepository.updateStatus.mockResolvedValue(undefined);

      await service.processTransaction(mockUser as any, {
        amount: 100.00,
        type: TransactionType.DEBIT,
        idempotencyKey: 'lock-test-key',
      });

      // Verify the lock was acquired — this is the core concurrency guarantee
      expect(mockWalletRepository.findByIdWithLock).toHaveBeenCalledWith(
        mockWallet.id,
        qr,
      );
    });
  });

  // ── 4. QueryRunner lifecycle ──────────────────────────────────────────────
  describe('Transaction Atomicity', () => {
    it('should rollback and release connection on unexpected error', async () => {
      const qr = buildMockQueryRunner();
      mockDataSource.createQueryRunner.mockReturnValue(qr);
      mockWalletService.getWalletByUserId.mockResolvedValue(mockWallet);
      mockTransactionsRepository.findByIdempotencyKey.mockResolvedValue(null);
      mockWalletRepository.findByIdWithLock.mockRejectedValue(
        new Error('DB connection lost'),
      );

      await expect(
        service.processTransaction(mockUser as any, {
          amount: 100.00,
          type: TransactionType.DEBIT,
          idempotencyKey: 'error-key',
        }),
      ).rejects.toThrow();

      expect(qr.rollbackTransaction).toHaveBeenCalledTimes(1);
      expect(qr.commitTransaction).not.toHaveBeenCalled();
      // Connection must always be released to prevent pool exhaustion
      expect(qr.release).toHaveBeenCalledTimes(1);
    });

    it('should always release the QueryRunner even on success', async () => {
      const qr = buildMockQueryRunner();
      mockDataSource.createQueryRunner.mockReturnValue(qr);
      mockWalletService.getWalletByUserId.mockResolvedValue(mockWallet);
      mockTransactionsRepository.findByIdempotencyKey.mockResolvedValue(null);
      mockWalletRepository.findByIdWithLock.mockResolvedValue({
        ...mockWallet,
        balance: '150.00',
      });
      const tx = buildMockTransaction();
      mockTransactionsRepository.createPending.mockResolvedValue(tx);
      mockTransactionsRepository.updateStatus.mockResolvedValue(undefined);

      await service.processTransaction(mockUser as any, {
        amount: 100.00,
        type: TransactionType.DEBIT,
        idempotencyKey: 'success-release-key',
      });

      expect(qr.release).toHaveBeenCalledTimes(1);
    });
  });

  // ── 5. Pagination ─────────────────────────────────────────────────────────
  describe('getTransactions', () => {
    it('should return paginated transactions for the authenticated user', async () => {
      mockWalletService.getWalletByUserId.mockResolvedValue(mockWallet);
      const transactions = [buildMockTransaction(), buildMockTransaction({ id: 'tx-2' })];
      mockTransactionsRepository.findByWalletId.mockResolvedValue([transactions, 2]);

      const result = await service.getTransactions(mockUser as any, 1, 20);

      expect(result.data).toHaveLength(2);
      expect(result.meta.total).toBe(2);
      expect(result.meta.page).toBe(1);
      expect(result.meta.totalPages).toBe(1);
    });
  });
});
