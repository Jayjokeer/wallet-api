import { MigrationInterface, QueryRunner } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

const ADMIN_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$c2FsdHNhbHRzYWx0c2FsdA$REPLACE_WITH_REAL_HASH';

export class SeedAdminUser1700000000001 implements MigrationInterface {
  name = 'SeedAdminUser1700000000001';
 
  public async up(queryRunner: QueryRunner): Promise<void> {
    const adminId = uuidv4();
    const walletId = uuidv4();


    await queryRunner.query(`
      INSERT IGNORE INTO \`users\` (\`id\`, \`email\`, \`password\`, \`role\`)
      VALUES (
        '${adminId}',
        'admin@walletapi.com',
        '${ADMIN_PASSWORD_HASH}',
        'admin'
      )
    `);

    await queryRunner.query(`
      INSERT IGNORE INTO \`wallets\` (\`id\`, \`userId\`, \`balance\`, \`currency\`)
      VALUES ('${walletId}', '${adminId}', '0.00', 'NGN')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM \`users\` WHERE \`email\` = 'admin@walletapi.com'`);
  }
}
