import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1700000000000 implements MigrationInterface {
  name = 'InitialSchema1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Users table ───────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE \`users\` (
        \`id\`         VARCHAR(36)   NOT NULL,
        \`email\`      VARCHAR(255)  NOT NULL,
        \`password\`   VARCHAR(255)  NOT NULL,
        \`role\`       ENUM('admin','user') NOT NULL DEFAULT 'user',
        \`createdAt\`  DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`IDX_USER_EMAIL\` (\`email\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // ── Wallets table ─────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE \`wallets\` (
        \`id\`         VARCHAR(36)   NOT NULL,
        \`userId\`     VARCHAR(36)   NOT NULL,
        \`balance\`    DECIMAL(18,2) NOT NULL DEFAULT '0.00',
        \`currency\`   VARCHAR(10)   NOT NULL DEFAULT 'NGN',
        \`createdAt\`  DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\`  DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`IDX_WALLET_USER_ID\` (\`userId\`),
        CONSTRAINT \`FK_WALLET_USER\`
          FOREIGN KEY (\`userId\`) REFERENCES \`users\` (\`id\`)
          ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // ── Transactions table ────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE \`transactions\` (
        \`id\`             VARCHAR(36)    NOT NULL,
        \`reference\`      VARCHAR(255)   NOT NULL,
        \`walletId\`       VARCHAR(36)    NOT NULL,
        \`type\`           ENUM('credit','debit') NOT NULL,
        \`amount\`         DECIMAL(18,2)  NOT NULL,
        \`status\`         ENUM('pending','success','failed') NOT NULL DEFAULT 'pending',
        \`idempotencyKey\` VARCHAR(512)   NOT NULL,
        \`createdAt\`      DATETIME(6)    NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE INDEX \`IDX_TRANSACTION_REFERENCE\`      (\`reference\`),
        UNIQUE INDEX \`IDX_TRANSACTION_IDEMPOTENCY_KEY\` (\`idempotencyKey\`),
        INDEX \`IDX_TRANSACTION_WALLET_ID\`             (\`walletId\`),
        INDEX \`IDX_TRANSACTION_STATUS\`                (\`status\`),
        INDEX \`IDX_TRANSACTION_CREATED_AT\`            (\`createdAt\`),
        CONSTRAINT \`FK_TRANSACTION_WALLET\`
          FOREIGN KEY (\`walletId\`) REFERENCES \`wallets\` (\`id\`)
          ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // ── Composite index for paginated wallet transaction queries ──────────────
    await queryRunner.query(`
      CREATE INDEX \`IDX_TRANSACTION_WALLET_CREATED\`
        ON \`transactions\` (\`walletId\`, \`createdAt\` DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS \`transactions\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`wallets\``);
    await queryRunner.query(`DROP TABLE IF EXISTS \`users\``);
  }
}
