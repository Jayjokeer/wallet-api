import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Wallet } from '../../wallet/entities/wallet.entity';

export enum TransactionType {
  CREDIT = 'credit',
  DEBIT = 'debit',
}

export enum TransactionStatus {
  PENDING = 'pending',
  SUCCESS = 'success',
  FAILED = 'failed',
}

@Entity('transactions')
export class Transaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  @Index('IDX_TRANSACTION_REFERENCE')
  reference: string;

  @Column({ type: 'uuid' })
  @Index('IDX_TRANSACTION_WALLET_ID')
  walletId: string;

  @Column({ type: 'enum', enum: TransactionType })
  type: TransactionType;

  @Column({ type: 'decimal', precision: 18, scale: 2 })
  amount: string; // stored as string from MySQL decimal

  @Column({ type: 'enum', enum: TransactionStatus, default: TransactionStatus.PENDING })
  status: TransactionStatus;

  @Column({ type: 'varchar', length: 512, unique: true })
  @Index('IDX_TRANSACTION_IDEMPOTENCY_KEY')
  idempotencyKey: string;

  @CreateDateColumn()
  createdAt: Date;

  // Relation
  @ManyToOne(() => Wallet, (wallet) => wallet.transactions)
  @JoinColumn({ name: 'walletId' })
  wallet: Wallet;
}
