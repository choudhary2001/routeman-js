export enum ProductCategory {
  Electronics = 'electronics',
  Books = 'books',
  Clothing = 'clothing',
  Home = 'home',
}

export class Product {
  id: number;
  sku: string;
  name: string;
  description?: string;
  price: number;
  category: ProductCategory;
  stock: number;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}
