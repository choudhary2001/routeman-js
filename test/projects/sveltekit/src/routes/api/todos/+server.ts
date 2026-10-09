import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { todos, createTodo } from '$lib/server/todos';
import { requireUser } from '$lib/server/auth';

export const GET: RequestHandler = async ({ url }) => {
	const status = url.searchParams.get('status');
	const limit = Number(url.searchParams.get('limit') ?? 50);

	let result = todos;
	if (status === 'done') result = todos.filter((t) => t.done);
	if (status === 'open') result = todos.filter((t) => !t.done);

	return json(result.slice(0, limit));
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const user = requireUser(locals);
	const { title, dueDate } = await request.json();

	if (typeof title !== 'string' || title.trim() === '') {
		error(400, 'title is required');
	}

	const todo = createTodo({ title: title.trim(), done: false, dueDate: dueDate ?? null, ownerId: user.id });
	return json(todo, { status: 201 });
};
