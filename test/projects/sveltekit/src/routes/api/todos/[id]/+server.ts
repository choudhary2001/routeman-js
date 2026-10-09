import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { todos } from '$lib/server/todos';
import { requireUser } from '$lib/server/auth';

function findTodo(id: string) {
	const todo = todos.find((t) => t.id === id);
	if (!todo) error(404, `Todo ${id} not found`);
	return todo;
}

export const GET: RequestHandler = ({ params }) => {
	return json(findTodo(params.id));
};

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	requireUser(locals);
	const todo = findTodo(params.id);
	const data = await request.json();

	if (data.title !== undefined) todo.title = String(data.title);
	if (data.done !== undefined) todo.done = Boolean(data.done);
	if (data.dueDate !== undefined) todo.dueDate = data.dueDate;

	return json(todo);
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	requireUser(locals);
	const index = todos.findIndex((t) => t.id === params.id);
	if (index === -1) error(404, 'Not found');

	todos.splice(index, 1);
	return new Response(null, { status: 204 });
};
