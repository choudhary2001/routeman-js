import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 32).toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const candidate = scryptSync(password, salt, 32);
  return timingSafeEqual(candidate, Buffer.from(hash, 'hex'));
}

export const users = [
  {
    id: 1,
    email: 'admin@example.com',
    username: 'admin',
    password: hashPassword('Str0ngPassw0rd!'),
    role: 'admin',
  },
];

export const todos = new Map([
  [1, { id: 1, title: 'Write the README', completed: false, priority: 'normal', dueDate: null, ownerId: 1 }],
]);

let lastId = 1;
export const nextTodoId = () => ++lastId;
