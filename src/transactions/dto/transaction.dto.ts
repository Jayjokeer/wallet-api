import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsPositive,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { TransactionType, TransactionStatus } from '../entities/transaction.entity';

export class CreateTransactionDto {
  @ApiProperty({ example: 100.00, description: 'Amount must be positive' })
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Amount must have at most 2 decimal places' })
  @IsPositive({ message: 'Amount must be greater than 0' })
  @Type(() => Number)
  amount: number;

  @ApiProperty({ enum: TransactionType, example: TransactionType.DEBIT })
  @IsEnum(TransactionType, { message: 'type must be credit or debit' })
  type: TransactionType;

  @ApiProperty({
    example: 'order-xyz-20240101',
    description: 'Unique key to prevent duplicate processing',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  idempotencyKey: string;
}

export class TransactionResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  reference: string;

  @ApiProperty()
  walletId: string;

  @ApiProperty({ enum: TransactionType })
  type: TransactionType;

  @ApiProperty()
  amount: string;

  @ApiProperty({ enum: TransactionStatus })
  status: TransactionStatus;

  @ApiProperty()
  idempotencyKey: string;

  @ApiProperty()
  createdAt: Date;
}
