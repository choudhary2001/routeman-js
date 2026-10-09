import { login } from './handlers/auth.js';
import * as todos from './handlers/todos.js';
import { sendJson } from './lib/respond.js';

const TODO_ID = /^\/api\/todos\/(\d+)\/?$/;

export async function route(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const { pathname } = url;

  if (req.method === 'GET' && pathname === '/health') {
    return sendJson(res, 200, { status: 'ok', time: new Date().toISOString() });
  }

  if (req.method === 'POST' && pathname === '/api/auth/login') {
    return login(req, res);
  }

  if (pathname === '/api/todos' || pathname === '/api/todos/') {
    switch (req.method) {
      case 'GET':
        return todos.listTodos(req, res, url);
      case 'POST':
        return todos.createTodo(req, res);
      default:
        res.setHeader('Allow', 'GET, POST');
        return sendJson(res, 405, { error: 'Method Not Allowed' });
    }
  }

  const match = pathname.match(TODO_ID);
  if (match) {
    const id = match[1];
    switch (req.method) {
      case 'GET':
        return todos.getTodo(req, res, id);
      case 'PUT':
      case 'PATCH':
        return todos.updateTodo(req, res, id);
      case 'DELETE':
        return todos.deleteTodo(req, res, id);
      default:
        res.setHeader('Allow', 'GET, PUT, PATCH, DELETE');
        return sendJson(res, 405, { error: 'Method Not Allowed' });
    }
  }

  sendJson(res, 404, { error: `No route for ${req.method} ${pathname}` });
}
