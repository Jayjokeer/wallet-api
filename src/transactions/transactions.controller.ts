import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiTags,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { TransactionsService } from './transactions.service';
import { CreateTransactionDto, TransactionResponseDto } from './dto/transaction.dto';
import { GetUser } from '../common/decorators/get-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { User, UserRole } from '../users/entities/user.entity';
import { PaginationDto } from '../common/dto/pagination.dto';

@ApiTags('Transactions')
@ApiBearerAuth('access-token')
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ short: { limit: 20, ttl: 60000 } })
  @ApiOperation({
    summary: 'Create a credit or debit transaction',
    description:
      'Atomic, idempotent transaction. Duplicate idempotencyKey returns original result without reprocessing.',
  })
  @ApiResponse({ status: 201, type: TransactionResponseDto })
  @ApiResponse({ status: 400, description: 'Insufficient funds or invalid input' })
  async createTransaction(
    @GetUser() user: User,
    @Body() dto: CreateTransactionDto,
  ): Promise<TransactionResponseDto> {
    return this.transactionsService.processTransaction(user, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get your transaction history (paginated)' })
  async getMyTransactions(
    @GetUser() user: User,
    @Query() pagination: PaginationDto,
  ) {
    return this.transactionsService.getTransactions(
      user,
      pagination.page,
      pagination.limit,
    );
  }

  @Get('all')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: '[Admin] Get all transactions paginated' })
  async getAllTransactions(@Query() pagination: PaginationDto) {
    return this.transactionsService.getAllTransactions(
      pagination.page,
      pagination.limit,
    );
  }
}
