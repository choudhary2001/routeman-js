import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { Product, ProductCategory } from './entities/product.entity';

@Injectable()
export class ProductsService {
  private products: Product[] = [];
  private nextId = 1;

  constructor() {
    this.create({
      sku: 'KB-MX-001',
      name: 'Mechanical Keyboard',
      description: 'Hot-swappable 75% board with brown switches',
      price: 89.99,
      category: ProductCategory.Electronics,
      stock: 25,
      tags: ['keyboard', 'peripherals'],
    });
    this.create({
      sku: 'BK-DDD-042',
      name: 'Domain-Driven Design',
      price: 54.5,
      category: ProductCategory.Books,
      stock: 8,
    });
  }

  findAll(search?: string, category?: string): Product[] {
    let result = this.products;
    if (search) {
      const needle = search.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(needle) ||
          p.description?.toLowerCase().includes(needle) ||
          p.tags.some((t) => t.toLowerCase().includes(needle)),
      );
    }
    if (category) {
      result = result.filter((p) => p.category === category);
    }
    return result;
  }

  findOne(id: number): Product {
    const product = this.products.find((p) => p.id === id);
    if (!product) {
      throw new NotFoundException(`Product #${id} not found`);
    }
    return product;
  }

  create(dto: CreateProductDto): Product {
    if (this.products.some((p) => p.sku === dto.sku)) {
      throw new ConflictException(`SKU ${dto.sku} already exists`);
    }
    const now = new Date().toISOString();
    const product: Product = {
      ...dto,
      id: this.nextId++,
      tags: dto.tags ?? [],
      createdAt: now,
      updatedAt: now,
    };
    this.products.push(product);
    return product;
  }

  update(id: number, dto: UpdateProductDto): Product {
    const product = this.findOne(id);
    Object.assign(product, dto, { updatedAt: new Date().toISOString() });
    return product;
  }

  setStock(id: number, stock: number): Product {
    return this.update(id, { stock });
  }

  remove(id: number): void {
    const before = this.products.length;
    this.products = this.products.filter((p) => p.id !== id);
    if (this.products.length === before) {
      throw new NotFoundException(`Product #${id} not found`);
    }
  }
}
