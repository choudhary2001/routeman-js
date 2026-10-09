import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { accounts } from '$lib/server/todos';
import { signToken } from '$lib/server/auth';

export const POST: RequestHandler = async ({ request }) => {
	const { email, password } = await request.json();
	const account = accounts.find((a) => a.email === email && a.password === password);
	if (!account) error(401, 'Invalid credentials');

	return json({ token: signToken(account) });
};
