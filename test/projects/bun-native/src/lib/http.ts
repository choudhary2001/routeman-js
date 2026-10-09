export const json = (data: unknown, init: ResponseInit = {}) => Response.json(data, init);

export const error = (status: number, message: string, details?: unknown) =>
  Response.json({ error: message, ...(details ? { details } : {}) }, { status });

export const notFound = (message = "Not found") => error(404, message);

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as T) : null;
  } catch {
    return null;
  }
}
