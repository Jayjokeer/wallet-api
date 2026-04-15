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

  async processTransaction(
    user: User,
    dto: CreateTransactionDto,
  ): Promise<TransactionResponseDto> {
    const walletBeforeLock = await this.walletService.getWalletByUserId(user.id);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction('READ COMMITTED');

    try {
      const existing = await this.transactionsRepository.findByIdempotencyKey(
        dto.idempotencyKey,
        queryRunner,
      );

      if (existing) {
        await queryRunner.rollbackTransaction();
        return this.toResponseDto(existing);
      }


      const wallet = await this.walletRepository.findByIdWithLock(
        walletBeforeLock.id,
        queryRunner,
      );

      if (!wallet) {
        throw new NotFoundException('Wallet not found');
      }

      const currentBalance = parseFloat(wallet.balance);
      const amount = parseFloat(dto.amount.toFixed(2));

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

      let newBalance: number;

      if (dto.type === TransactionType.DEBIT) {
        if (currentBalance < amount) {
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
        newBalance = currentBalance + amount;
      }

      await queryRunner.manager.update(
        'wallets',
        { id: wallet.id },
        { balance: newBalance.toFixed(2) },
      );

      await this.transactionsRepository.updateStatus(
        transaction.id,
        TransactionStatus.SUCCESS,
        queryRunner,
      );

      await queryRunner.commitTransaction();

      return this.toResponseDto({ ...transaction, status: TransactionStatus.SUCCESS });
    } catch (error) {
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
