export interface User {
  id: string;
  email: string;
  username: string;
  passwordHash: string;
  role: "admin" | "member";
}

export interface Book {
  id: string;
  title: string;
  author: string;
  isbn?: string;
  year?: number;
  genres: string[];
}

export async function hashPassword(password: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export const users: User[] = [
  {
    id: "1",
    email: "admin@example.com",
    username: "admin",
    passwordHash: await hashPassword("Str0ngPassw0rd!"),
    role: "admin",
  },
];

export const books = new Map<string, Book>([
  ["1", {
    id: "1",
    title: "The Left Hand of Darkness",
    author: "Ursula K. Le Guin",
    isbn: "9780441478125",
    year: 1969,
    genres: ["science fiction"],
  }],
]);

let counter = 1;
export const nextBookId = () => String(++counter);
