export type Role = 'admin' | 'customer'
export type OrderStatus = 'pending' | 'paid' | 'shipped' | 'delivered' | 'cancelled'

export interface User {
  id: number
  email: string
  username: string
  password: string
  role: Role
  fullName?: string
}

export interface Product {
  id: number
  name: string
  description: string
  price: number
  stock: number
  category: 'electronics' | 'books' | 'clothing' | 'home'
  imageUrl?: string
}

export interface OrderItem {
  productId: number
  quantity: number
  unitPrice: number
}

export interface Order {
  id: number
  userId: number
  items: OrderItem[]
  total: number
  status: OrderStatus
  shippingAddress: string
  note?: string
  createdAt: Date
}

const counters = { users: 1, products: 1, orders: 1 }

export const nextId = (table: keyof typeof counters) => ++counters[table]

export const users: User[] = [
  {
    id: 1,
    email: 'admin@example.com',
    username: 'admin',
    // Plaintext only because this is an in-memory demo store.
    password: 'Str0ngPassw0rd!',
    role: 'admin',
    fullName: 'Site Admin',
  },
]

export const products: Product[] = [
  {
    id: 1,
    name: 'Mechanical Keyboard',
    description: 'Hot-swappable 75% keyboard with brown switches',
    price: 129.99,
    stock: 25,
    category: 'electronics',
  },
]

export const orders: Order[] = [
  {
    id: 1,
    userId: 1,
    items: [{ productId: 1, quantity: 1, unitPrice: 129.99 }],
    total: 129.99,
    status: 'paid',
    shippingAddress: '221B Baker Street, London',
    createdAt: new Date(),
  },
]

export const sanitize = ({ password: _password, ...rest }: User) => rest
