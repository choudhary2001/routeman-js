export interface User {
  id: number;
  name: string;
  email: string;
  password: string;
  age?: number;
  role: 'admin' | 'customer';
}

export interface Order {
  id: number;
  userId: number;
  productId: number;
  quantity: number;
  note?: string;
  status: 'pending' | 'shipped';
}

class UserService {
  private users: User[] = [
    { id: 1, name: 'admin', email: 'admin@example.com', password: 'Str0ngPassw0rd!', role: 'admin' },
  ];

  readonly orders: Order[] = [{ id: 1, userId: 1, productId: 1, quantity: 2, status: 'pending' }];

  list(page: number, limit: number) {
    return this.users.slice((page - 1) * limit, page * limit);
  }

  findById(id: number) {
    return this.users.find((u) => u.id === id);
  }

  findByEmail(email: string) {
    return this.users.find((u) => u.email === email);
  }

  create(data: Omit<User, 'id' | 'role'>) {
    const user: User = { ...data, id: this.users.length + 1, role: 'customer' };
    this.users.push(user);
    return user;
  }

  update(id: number, data: Partial<User>) {
    const user = this.findById(id);
    if (user) Object.assign(user, data);
    return user;
  }

  remove(id: number) {
    const before = this.users.length;
    this.users = this.users.filter((u) => u.id !== id);
    return this.users.length !== before;
  }
}

export const userService = new UserService();
