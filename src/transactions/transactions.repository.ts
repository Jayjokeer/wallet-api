import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, QueryRunner } from 'typeorm';
import { Transaction, TransactionStatus, TransactionType } from './entities/transaction.entity';

@Injectable()
export class TransactionsRepository {
  constructor(
    @InjectRepository(Transaction)
    private readonly repo: Repository<Transaction>,
  ) {}

  async findByIdempotencyKey(
    idempotencyKey: string,
    queryRunner: QueryRunner,
  ): Promise<Transaction | null> {
    return queryRunner.manager.findOne(Transaction, {
      where: { idempotencyKey },
    });
  }

 
  async createPending(
    data: {
      reference: string;
      walletId: string;
      type: TransactionType;
      amount: string;
      idempotencyKey: string;
    },
    queryRunner: QueryRunner,
  ): Promise<Transaction> {
    const tx = queryRunner.manager.create(Transaction, {
      ...data,
      status: TransactionStatus.PENDING,
    });
    return queryRunner.manager.save(Transaction, tx);
  }


  async updateStatus(
    id: string,
    status: TransactionStatus,
    queryRunner: QueryRunner,
  ): Promise<void> {
    await queryRunner.manager.update(Transaction, { id }, { status });
  }

  async findByWalletId(
    walletId: string,
    page: number,
    limit: number,
  ): Promise<[Transaction[], number]> {
    return this.repo.findAndCount({
      where: { walletId },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
  }

  async findAllPaginated(
    page: number,
    limit: number,
  ): Promise<[Transaction[], number]> {
    return this.repo.findAndCount({
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
  }
}
