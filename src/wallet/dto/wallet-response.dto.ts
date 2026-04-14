import { ApiProperty } from '@nestjs/swagger';

export class WalletResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  userId: string;

  @ApiProperty({ example: '1500.00' })
  balance: string;

  @ApiProperty({ example: 'NGN' })
  currency: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
