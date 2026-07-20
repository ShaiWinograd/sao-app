// A typed, exposable HTTP error. Thrown inside route/transaction code and mapped
// to a JSON response by the global error handler. Because it is thrown inside the
// caller's transaction, throwing it rolls the transaction back atomically.
export class AppError extends Error {
  statusCode: number;
  code: string;
  data?: Record<string, unknown>;
  constructor(statusCode: number, code: string, message: string, data?: Record<string, unknown>) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.data = data;
  }
}
