export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }

  static badRequest(message = 'Bad request', details?: unknown) {
    return new HttpError(400, message, details);
  }

  static unauthorized(message = 'Unauthorized') {
    return new HttpError(401, message);
  }

  static forbidden(message = 'Forbidden') {
    return new HttpError(403, message);
  }

  static notFound(resource = 'Resource') {
    return new HttpError(404, `${resource} not found`);
  }

  static conflict(message: string) {
    return new HttpError(409, message);
  }

  static unprocessable(message: string) {
    return new HttpError(422, message);
  }
}
