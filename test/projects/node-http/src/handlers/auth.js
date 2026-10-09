import { users, verifyPassword } from '../db.js';
import { readJson } from '../lib/body.js';
import { signToken } from '../lib/auth.js';
import { sendJson } from '../lib/respond.js';

export async function login(req, res) {
  const { username, password } = await readJson(req);

  if (typeof username !== 'string' || typeof password !== 'string') {
    return sendJson(res, 400, { error: 'username and password are required' });
  }

  const user = users.find((u) => u.username === username || u.email === username);
  if (!user || !verifyPassword(password, user.password)) {
    return sendJson(res, 401, { error: 'Invalid username or password' });
  }

  sendJson(res, 200, { data: { token: signToken(user), user: { id: user.id, username: user.username, role: user.role } } });
}
