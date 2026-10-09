import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Version,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { UpdateStockDto } from './dto/update-stock.dto';
import { ProductsService } from './products.service';

@ApiTags('products')
@Controller({ path: 'products', version: '2' })
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  /**
   * v1 clients still expect a flat array of { id, name, price }.
   */
  @Public()
  @Version('1')
  @Get()
  @ApiOperation({ summary: 'List products (legacy v1 shape)', deprecated: true })
  findAllLegacy() {
    return this.productsService
      .findAll()
      .map(({ id, name, price }) => ({ id, name, price }));
  }

  @Public()
  @Get()
  @ApiOperation({ summary: 'Search the product catalogue' })
  @ApiQuery({ name: 'search', required: false, example: 'keyboard' })
  @ApiQuery({ name: 'category', required: false, example: 'electronics' })
  findAll(
    @Query('search') search?: string,
    @Query('category') category?: string,
  ) {
    const items = this.productsService.findAll(search, category);
    return { items, count: items.length };
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get a product by id' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.productsService.findOne(id);
  }

  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a product' })
  create(@Body() dto: CreateProductDto) {
    return this.productsService.create(dto);
  }

  @Patch(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update product details (SKU is immutable)' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProductDto,
  ) {
    return this.productsService.update(id, dto);
  }

  @Patch(':id/stock')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Adjust the stock level' })
  updateStock(
    @Param('id', ParseIntPipe) id: number,
    @Body() { stock }: UpdateStockDto,
  ) {
    return this.productsService.setStock(id, stock);
  }

  @Delete(':id')
  @Roles('admin')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a product (admin only)' })
  remove(@Param('id', ParseIntPipe) id: number) {
    this.productsService.remove(id);
  }
}
