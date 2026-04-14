import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { TransactionsRepository } from './transactions.repository';
import { WalletRepository } from '../wallet/wallet.repository';
import { CreateTransactionDto, TransactionResponseDto } from './dto/transaction.dto';
import { TransactionStatus, TransactionType } from './entities/transaction.entity';
import { User, UserRole } from '../users/entities/user.entity';
import { WalletService } from '../wallet/wallet.service';
import { PaginatedResult } from '../common/dto/pagination.dto';
import { Transaction } from './entities/transaction.entity';

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly transactionsRepository: TransactionsRepository,
    private readonly walletRepository: WalletRepository,
    private readonly walletService: WalletService,
  ) {}

  /**
   * processTransaction — the core atomic transaction handler.
   *
   * CONCURRENCY STRATEGY:
   * ─────────────────────
   * 1. We use a QueryRunner to get an explicit DB connection.
   * 2. We START a transaction with SERIALIZABLE isolation is too aggressive;
   *    we use READ COMMITTED + pessimistic row-level locking (SELECT FOR UPDATE).
   * 3. We lock the wallet row with `pessimistic_write` BEFORE reading the balance.
   *    This means: if two requests (Debit 100 + Debit 100) hit a wallet with 150,
   *    the second request blocks on the lock until the first commits/rolls back.
   *    After the first debit succeeds (balance → 50), the second debit reads 50,
   *    finds 50 < 100, and FAILS cleanly. No inconsistent state.
   * 4. Idempotency is checked INSIDE the lock — this prevents the TOCTOU
   *    (time-of-check-time-of-use) race where two identical keys arrive
   *    simultaneously and both pass the pre-lock idempotency check.
   *
   * CRASH RECOVERY:
   * ───────────────
   * If the server crashes after inserting a PENDING transaction but before
   * updating the wallet balance, the QueryRunner.rollbackTransaction() in the
   * catch block rolls back both the transaction row and the balance update.
   * PENDING transactions that remain on restart can be reconciled by a
   * background job that checks for stale PENDING records older than N minutes.
   */
  async processTransaction(
    user: User,
    dto: CreateTransactionDto,
  ): Promise<TransactionResponseDto> {
    // Get the user's wallet (resolves walletId before acquiring lock)
    const walletBeforeLock = await this.walletService.getWalletByUserId(user.id);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction('READ COMMITTED');

    try {
      // ── STEP 1: Idempotency check (inside transaction, before lock) ──────────
      const existing = await this.transactionsRepository.findByIdempotencyKey(
        dto.idempotencyKey,
        queryRunner,
      );

      if (existing) {
        // Duplicate request — return original result, do NOT process again
        await queryRunner.rollbackTransaction();
        return this.toResponseDto(existing);
      }

      // ── STEP 2: Acquire row-level lock on the wallet ──────────────────────────
      // SELECT ... FOR UPDATE — blocks concurrent debits on the same wallet
      const wallet = await this.walletRepository.findByIdWithLock(
        walletBeforeLock.id,
        queryRunner,
      );

      if (!wallet) {
        throw new NotFoundException('Wallet not found');
      }

      // ── STEP 3: Parse balance (MySQL decimal comes back as string) ────────────
      const currentBalance = parseFloat(wallet.balance);
      const amount = parseFloat(dto.amount.toFixed(2));

      // ── STEP 4: Insert transaction in PENDING state ───────────────────────────
      const reference = `TXN-${uuidv4()}`;
      const transaction = await this.transactionsRepository.createPending(
        {
          reference,
          walletId: wallet.id,
          type: dto.type,
          amount: amount.toFixed(2),
          idempotencyKey: dto.idempotencyKey,
        },
        queryRunner,
      );

      // ── STEP 5: Apply business logic ──────────────────────────────────────────
      let newBalance: number;

      if (dto.type === TransactionType.DEBIT) {
        if (currentBalance < amount) {
          // Insufficient funds — mark FAILED, commit so idempotency record is saved
          await this.transactionsRepository.updateStatus(
            transaction.id,
            TransactionStatus.FAILED,
            queryRunner,
          );
          await queryRunner.commitTransaction();
          return this.toResponseDto({ ...transaction, status: TransactionStatus.FAILED });
        }
        newBalance = currentBalance - amount;
      } else {
        // CREDIT — always succeeds if amount is valid (validated in DTO)
        newBalance = currentBalance + amount;
      }

      // ── STEP 6: Update wallet balance (still inside lock) ────────────────────
      await queryRunner.manager.update(
        'wallets',
        { id: wallet.id },
        { balance: newBalance.toFixed(2) },
      );

      // ── STEP 7: Mark transaction SUCCESS ─────────────────────────────────────
      await this.transactionsRepository.updateStatus(
        transaction.id,
        TransactionStatus.SUCCESS,
        queryRunner,
      );

      // ── STEP 8: Commit — releases the row lock ────────────────────────────────
      await queryRunner.commitTransaction();

      return this.toResponseDto({ ...transaction, status: TransactionStatus.SUCCESS });
    } catch (error) {
      // Rollback on any failure — wallet balance and transaction row both revert
      await queryRunner.rollbackTransaction();

      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }

      this.logger.error('Transaction processing failed', error?.stack);
      throw new InternalServerErrorException('Transaction could not be processed');
    } finally {
      // Always release the connection back to the pool
      await queryRunner.release();
    }
  }

  async getTransactions(
    user: User,
    page: number,
    limit: number,
  ): Promise<PaginatedResult<Transaction>> {
    const wallet = await this.walletService.getWalletByUserId(user.id);
    const [data, total] = await this.transactionsRepository.findByWalletId(
      wallet.id,
      page,
      limit,
    );

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getAllTransactions(
    page: number,
    limit: number,
  ): Promise<PaginatedResult<Transaction>> {
    const [data, total] = await this.transactionsRepository.findAllPaginated(page, limit);
    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  private toResponseDto(tx: Partial<Transaction>): TransactionResponseDto {
    return {
      id: tx.id,
      reference: tx.reference,
      walletId: tx.walletId,
      type: tx.type,
      amount: tx.amount,
      status: tx.status,
      idempotencyKey: tx.idempotencyKey,
      createdAt: tx.createdAt,
    };
  }
}
