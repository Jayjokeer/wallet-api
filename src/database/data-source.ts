import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
dotenv.config();
console.log('Database configuration:', { 
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  username: process.env.DB_USERNAME,
  database: process.env.DB_NAME,
});
export default new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST  as string || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  username: process.env.DB_USERNAME || 'wallet_user',
  password: process.env.DB_PASSWORD || 'wallet_password',
  database: process.env.DB_NAME || 'wallet_db',
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  synchronize: false,
});
