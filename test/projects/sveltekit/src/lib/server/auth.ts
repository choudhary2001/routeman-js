import jwt from 'jsonwebtoken';
import { error } from '@sveltejs/kit';

const JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret';

export function signToken(user: { id: string; email: string }) {
	return jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: '1h' });
}

export function verifyToken(token: string) {
	try {
		const payload = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload;
		return { id: String(payload.sub), email: String(payload.email) };
	} catch {
		return null;
	}
}

export function requireUser(locals: App.Locals) {
	if (!locals.user) error(401, 'Authentication required');
	return locals.user;
}
