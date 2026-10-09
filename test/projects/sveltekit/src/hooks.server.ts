import type { Handle } from '@sveltejs/kit';
import { verifyToken } from '$lib/server/auth';

export const handle: Handle = async ({ event, resolve }) => {
	const authorization = event.request.headers.get('authorization');
	event.locals.user = authorization?.startsWith('Bearer ')
		? verifyToken(authorization.slice('Bearer '.length))
		: null;

	return resolve(event);
};
