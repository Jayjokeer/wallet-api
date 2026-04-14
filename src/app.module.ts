import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { WalletModule } from './wallet/wallet.module';
import { TransactionsModule } from './transactions/transactions.module';
import { User } from './users/entities/user.entity';
import { Wallet } from './wallet/entities/wallet.entity';
import { Transaction } from './transactions/entities/transaction.entity';

@Module({
  imports: [
    // Config — loads .env
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // TypeORM — MySQL connection
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'mysql',
        host: config.get('DB_HOST', 'localhost'),
        port: config.get<number>('DB_PORT', 3306),
        username: config.get('DB_USERNAME', 'wallet_user'),
        password: config.get('DB_PASSWORD', 'wallet_password'),
        database: config.get('DB_NAME', 'wallet_db'),
        entities: [User, Wallet, Transaction],
        migrations: [__dirname + '/database/migrations/*{.ts,.js}'],
        migrationsRun: false, // run via CLI
        synchronize: false,   // NEVER true in production
        logging: config.get('NODE_ENV') !== 'production',
        extra: {
          // Connection pool settings for concurrency
          connectionLimit: 20,
          waitForConnections: true,
          queueLimit: 0,
        },
      }),
    }),

    // Rate limiting — global throttler
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 1000,   // 1 second
        limit: 10,   // max 10 req/sec globally
      },
      {
        name: 'medium',
        ttl: 60000,  // 1 minute
        limit: 100,  // max 100 req/min
      },
    ]),

    AuthModule,
    UsersModule,
    WalletModule,
    TransactionsModule,
  ],
})
export class AppModule {}
