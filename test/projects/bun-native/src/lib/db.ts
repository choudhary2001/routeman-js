export type Role = "admin" | "user";

export interface User {
  id: number;
  email: string;
  username: string;
  passwordHash: string;
  role: Role;
}

export interface Item {
  id: number;
  name: string;
  description: string;
  price: number;
  quantity: number;
  category: string;
  createdAt: string;
}

export const users: User[] = [
  {
    id: 1,
    email: "admin@example.com",
    username: "admin",
    passwordHash: await Bun.password.hash("Str0ngPassw0rd!"),
    role: "admin",
  },
];

export const items: Item[] = [
  {
    id: 1,
    name: "Mechanical keyboard",
    description: "87-key, brown switches",
    price: 89.99,
    quantity: 12,
    category: "peripherals",
    createdAt: new Date().toISOString(),
  },
];

let itemSeq = items.length;
export const nextItemId = () => ++itemSeq;
