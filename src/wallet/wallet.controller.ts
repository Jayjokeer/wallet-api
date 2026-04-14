import {
  Controller,
  Get,
  Query,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { WalletService } from './wallet.service';
import { GetUser } from '../common/decorators/get-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { User, UserRole } from '../users/entities/user.entity';
import { WalletResponseDto } from './dto/wallet-response.dto';
import { PaginationDto } from '../common/dto/pagination.dto';

@ApiTags('Wallet')
@ApiBearerAuth('access-token')
@Controller('wallet')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get()
  @ApiOperation({ summary: 'Get your wallet balance' })
  @ApiResponse({ status: 200, type: WalletResponseDto })
  async getMyWallet(@GetUser() user: User): Promise<WalletResponseDto> {
    return this.walletService.getWallet(user);
  }

  @Get('all')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '[Admin] Get all wallets paginated' })
  async getAllWallets(@Query() pagination: PaginationDto) {
    return this.walletService.getAllWallets(pagination.page, pagination.limit);
  }
}
