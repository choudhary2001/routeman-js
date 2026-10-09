import { randomUUID } from 'node:crypto';
import { compare, hash } from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { HttpError } from '../lib/httpError.js';
import type { LoginInput, RegisterInput } from '../schemas/auth.schema.js';
import { toPublicUser, type Database, type User } from './db.js';

export class AuthService {
  constructor(private readonly db: Database) {}

  private issueToken(user: User): string {
    return jwt.sign({ role: user.role, email: user.email }, config.jwt.secret, {
      subject: user.id,
      expiresIn: config.jwt.expiresIn,
    });
  }

  async register(input: RegisterInput) {
    for (const user of this.db.users.values()) {
      if (user.email === input.email || user.username === input.username) {
        throw HttpError.conflict('Email or username already registered');
      }
    }

    const user: User = {
      id: randomUUID(),
      email: input.email,
      username: input.username,
      name: input.name ?? input.username,
      passwordHash: await hash(input.password, 10),
      role: 'member',
      createdAt: new Date(),
    };
    this.db.users.set(user.id, user);

    return { user: toPublicUser(user), accessToken: this.issueToken(user) };
  }

  async login({ email, password }: LoginInput) {
    const user = [...this.db.users.values()].find((u) => u.email === email);
    if (!user || !(await compare(password, user.passwordHash))) {
      throw HttpError.unauthorized('Invalid email or password');
    }

    return { accessToken: this.issueToken(user), tokenType: 'Bearer', expiresIn: 3600 };
  }

  getProfile(userId: string) {
    const user = this.db.users.get(userId);
    if (!user) throw HttpError.notFound('User');
    return toPublicUser(user);
  }
}
