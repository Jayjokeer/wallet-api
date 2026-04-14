import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, QueryRunner } from 'typeorm';
import { Wallet } from './entities/wallet.entity';

@Injectable()
export class WalletRepository {
  constructor(
    @InjectRepository(Wallet)
    private readonly repo: Repository<Wallet>,
  ) {}

  async create(userId: string, currency = 'NGN'): Promise<Wallet> {
    const wallet = this.repo.create({ userId, balance: '0.00', currency });
    return this.repo.save(wallet);
  }

  async findByUserId(userId: string): Promise<Wallet | null> {
    return this.repo.findOne({ where: { userId } });
  }

  async findById(id: string): Promise<Wallet | null> {
    return this.repo.findOne({ where: { id } });
  }

  /**
   * findByIdWithLock — acquires a pessimistic write lock on the wallet row.
   * This MUST be called inside an active QueryRunner transaction.
   * Prevents race conditions: two concurrent debits on the same wallet
   * will queue at the DB level — only one proceeds at a time.
   *
   * MySQL InnoDB: SELECT ... FOR UPDATE
   */
  async findByIdWithLock(walletId: string, queryRunner: QueryRunner): Promise<Wallet | null> {
    return queryRunner.manager
      .createQueryBuilder(Wallet, 'wallet')
      .setLock('pessimistic_write')
      .where('wallet.id = :walletId', { walletId })
      .getOne();
  }

  async findAll(page: number, limit: number): Promise<[Wallet[], number]> {
    return this.repo.findAndCount({
      relations: ['user'],
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
    });
  }
}
