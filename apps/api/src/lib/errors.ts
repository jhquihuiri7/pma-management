export class HttpError extends Error {
  constructor(public statusCode: number, message: string, public details?: unknown) {
    super(message);
    this.name = "HttpError";
  }
}

export const Unauthorized = (msg = "Unauthorized") => new HttpError(401, msg);
export const Forbidden = (msg = "Forbidden") => new HttpError(403, msg);
export const NotFound = (msg = "Not Found") => new HttpError(404, msg);
export const BadRequest = (msg = "Bad Request", details?: unknown) =>
  new HttpError(400, msg, details);
export const Conflict = (msg = "Conflict") => new HttpError(409, msg);
