import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { PublicUser, Role, User } from './entities/user.entity';

@Injectable()
export class UsersService {
  private readonly users: User[] = [];
  private nextId = 1;

  constructor() {
    this.seed();
  }

  findAll({ page = 1, limit = 20 }: PaginationQueryDto) {
    const start = (page - 1) * limit;
    return {
      data: this.users.slice(start, start + limit).map(toPublic),
      meta: { page, limit, total: this.users.length },
    };
  }

  findOne(id: number): PublicUser {
    return toPublic(this.getOrFail(id));
  }

  findByEmail(email: string): User | undefined {
    return this.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  }

  create(dto: CreateUserDto): PublicUser {
    this.assertUnique(dto.email, dto.username);
    const now = new Date().toISOString();
    const { password, ...rest } = dto;
    const user: User = {
      ...rest,
      id: this.nextId++,
      role: dto.role ?? Role.User,
      passwordHash: hashPassword(password),
      createdAt: now,
      updatedAt: now,
    };
    this.users.push(user);
    return toPublic(user);
  }

  update(id: number, dto: UpdateUserDto): PublicUser {
    const user = this.getOrFail(id);
    this.assertUnique(dto.email, dto.username, id);
    const { password, ...rest } = dto;
    Object.assign(user, rest, { updatedAt: new Date().toISOString() });
    if (password) {
      user.passwordHash = hashPassword(password);
    }
    return toPublic(user);
  }

  remove(id: number): void {
    const index = this.users.findIndex((u) => u.id === id);
    if (index === -1) {
      throw new NotFoundException(`User #${id} not found`);
    }
    this.users.splice(index, 1);
  }

  setAvatar(id: number, file: Express.Multer.File): PublicUser {
    const user = this.getOrFail(id);
    user.avatar = {
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      uploadedAt: new Date().toISOString(),
    };
    user.updatedAt = user.avatar.uploadedAt;
    return toPublic(user);
  }

  verifyPassword(user: User, password: string): boolean {
    const [salt, key] = user.passwordHash.split(':');
    const expected = Buffer.from(key, 'hex');
    const actual = scryptSync(password, salt, expected.length);
    return timingSafeEqual(expected, actual);
  }

  private getOrFail(id: number): User {
    const user = this.users.find((u) => u.id === id);
    if (!user) {
      throw new NotFoundException(`User #${id} not found`);
    }
    return user;
  }

  private assertUnique(email?: string, username?: string, ignoreId?: number) {
    const clash = this.users.find(
      (u) =>
        u.id !== ignoreId &&
        ((email && u.email.toLowerCase() === email.toLowerCase()) ||
          (username && u.username === username)),
    );
    if (clash) {
      throw new ConflictException('A user with this email or username already exists');
    }
  }

  private seed() {
    this.create({
      email: 'admin@example.com',
      username: 'admin',
      password: 'Str0ngPassw0rd!',
      fullName: 'Site Administrator',
      role: Role.Admin,
      address: {
        street: '1 Infinite Loop',
        city: 'Cupertino',
        postalCode: '95014',
        country: 'US',
      },
    });
    this.create({
      email: 'jane.doe@example.com',
      username: 'janedoe',
      password: 'S3cure-Passw0rd',
      fullName: 'Jane Doe',
    });
  }
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const key = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${key}`;
}

function toPublic({ passwordHash, ...user }: User): PublicUser {
  return user;
}
