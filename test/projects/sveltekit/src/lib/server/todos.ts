export interface Todo {
	id: string;
	title: string;
	done: boolean;
	dueDate: string | null;
	ownerId: string;
}

let nextId = 2;

export const todos: Todo[] = [
	{ id: '1', title: 'Write fixtures', done: false, dueDate: null, ownerId: '1' }
];

export const accounts = [{ id: '1', email: 'admin@example.com', password: 'Str0ngPassw0rd!' }];

export function createTodo(data: Omit<Todo, 'id'>): Todo {
	const todo = { id: String(nextId++), ...data };
	todos.push(todo);
	return todo;
}
