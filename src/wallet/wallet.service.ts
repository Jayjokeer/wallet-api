import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { WalletRepository } from './wallet.repository';
import { Wallet } from './entities/wallet.entity';
import { User, UserRole } from '../users/entities/user.entity';
import { PaginatedResult } from '../common/dto/pagination.dto';

@Injectable()
export class WalletService {
  constructor(private readonly walletRepository: WalletRepository) {}

  async createWallet(userId: string, currency = 'NGN'): Promise<Wallet> {
    return this.walletRepository.create(userId, currency);
  }

  async getWallet(requestingUser: User, targetUserId?: string): Promise<Wallet> {
    const userId = targetUserId ?? requestingUser.id;

    if (requestingUser.role !== UserRole.ADMIN && userId !== requestingUser.id) {
      throw new ForbiddenException('Access denied');
    }

    const wallet = await this.walletRepository.findByUserId(userId);
    if (!wallet) throw new NotFoundException('Wallet not found');

    return wallet;
  }

  async getWalletByUserId(userId: string): Promise<Wallet> {
    const wallet = await this.walletRepository.findByUserId(userId);
    if (!wallet) throw new NotFoundException('Wallet not found');
    return wallet;
  }

  async getAllWallets(
    page: number,
    limit: number,
  ): Promise<PaginatedResult<Wallet>> {
    const [data, total] = await this.walletRepository.findAll(page, limit);
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
}
