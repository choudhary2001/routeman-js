import { PickType } from '@nestjs/swagger';
import { CreateProductDto } from './create-product.dto';

export class UpdateStockDto extends PickType(CreateProductDto, ['stock'] as const) {}
