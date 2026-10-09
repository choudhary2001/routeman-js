import { todos, nextTodoId } from '../db.js';
import { readJson } from '../lib/body.js';
import { requireAuth } from '../lib/auth.js';
import { sendJson, noContent, HttpError } from '../lib/respond.js';

const PRIORITIES = ['low', 'normal', 'high'];

function validateTodo(input, { partial = false } = {}) {
  const errors = {};

  if (!partial || 'title' in input) {
    if (typeof input.title !== 'string' || input.title.trim() === '') errors.title = 'is required';
  }
  if ('completed' in input && typeof input.completed !== 'boolean') errors.completed = 'must be a boolean';
  if ('priority' in input && !PRIORITIES.includes(input.priority)) {
    errors.priority = `must be one of ${PRIORITIES.join(', ')}`;
  }
  if ('dueDate' in input && input.dueDate !== null && Number.isNaN(Date.parse(input.dueDate))) {
    errors.dueDate = 'must be an ISO date';
  }

  if (Object.keys(errors).length) {
    const err = new HttpError(422, 'Validation failed');
    err.details = errors;
    throw err;
  }
}

function getTodoOr404(id) {
  const todo = todos.get(Number(id));
  if (!todo) throw new HttpError(404, `Todo ${id} not found`);
  return todo;
}

export function listTodos(req, res, url) {
  const completed = url.searchParams.get('completed');
  const search = url.searchParams.get('search');
  const page = Math.max(parseInt(url.searchParams.get('page') ?? '1', 10) || 1, 1);
  const perPage = Math.min(parseInt(url.searchParams.get('per_page') ?? '20', 10) || 20, 100);

  let result = [...todos.values()];
  if (completed === 'true' || completed === 'false') {
    result = result.filter((t) => t.completed === (completed === 'true'));
  }
  if (search) {
    result = result.filter((t) => t.title.toLowerCase().includes(search.toLowerCase()));
  }

  sendJson(res, 200, {
    data: result.slice((page - 1) * perPage, page * perPage),
    meta: { page, perPage, total: result.length },
  });
}

export function getTodo(req, res, id) {
  sendJson(res, 200, getTodoOr404(id));
}

export async function createTodo(req, res) {
  const user = requireAuth(req);
  const body = await readJson(req);
  validateTodo(body);

  const todo = {
    id: nextTodoId(),
    title: body.title.trim(),
    completed: body.completed ?? false,
    priority: body.priority ?? 'normal',
    dueDate: body.dueDate ?? null,
    ownerId: Number(user.sub),
  };
  todos.set(todo.id, todo);

  res.setHeader('Location', `/api/todos/${todo.id}`);
  sendJson(res, 201, todo);
}

export async function updateTodo(req, res, id) {
  requireAuth(req);
  const todo = getTodoOr404(id);
  const body = await readJson(req);
  // PUT and PATCH share this handler; PATCH allows partial updates
  validateTodo(body, { partial: req.method === 'PATCH' });

  for (const key of ['title', 'completed', 'priority', 'dueDate']) {
    if (key in body) todo[key] = body[key];
  }
  sendJson(res, 200, todo);
}

export function deleteTodo(req, res, id) {
  requireAuth(req);
  getTodoOr404(id);
  todos.delete(Number(id));
  noContent(res);
}
