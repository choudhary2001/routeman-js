import { IsIn, IsInt, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';

export class CreateOrderDto {
  @IsInt()
  @IsPositive()
  productId: number;

  @IsInt()
  @IsPositive()
  quantity: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class OrderQuery {
  @IsOptional()
  @IsIn(['pending', 'shipped'])
  status?: 'pending' | 'shipped';

  @IsOptional()
  @IsInt()
  page?: number;
}
