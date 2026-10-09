import { hash } from 'bcryptjs';

export type Role = 'admin' | 'member';
export type TaskStatus = 'todo' | 'in_progress' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high';

export interface User {
  id: string;
  email: string;
  username: string;
  name: string;
  passwordHash: string;
  role: Role;
  createdAt: Date;
}

export interface Project {
  id: string;
  ownerId: string;
  name: string;
  description: string | null;
  color: string | null;
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: Date | null;
  assigneeId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Database {
  users: Map<string, User>;
  projects: Map<string, Project>;
  tasks: Map<string, Task>;
}

export const db: Database = {
  users: new Map(),
  projects: new Map(),
  tasks: new Map(),
};

export const SEED_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

export async function seedDatabase(): Promise<void> {
  const now = new Date();

  db.users.set(SEED_ID, {
    id: SEED_ID,
    email: 'admin@example.com',
    username: 'admin',
    name: 'Administrator',
    passwordHash: await hash('Str0ngPassw0rd!', 10),
    role: 'admin',
    createdAt: now,
  });

  db.projects.set(SEED_ID, {
    id: SEED_ID,
    ownerId: SEED_ID,
    name: 'Website relaunch',
    description: 'Q3 marketing site rebuild',
    color: '#3366ff',
    archived: false,
    createdAt: now,
    updatedAt: now,
  });

  db.tasks.set(SEED_ID, {
    id: SEED_ID,
    projectId: SEED_ID,
    title: 'Draft sitemap',
    description: null,
    status: 'in_progress',
    priority: 'high',
    dueDate: null,
    assigneeId: SEED_ID,
    createdAt: now,
    updatedAt: now,
  });
}

export const toPublicUser = ({ passwordHash: _passwordHash, ...user }: User) => user;
