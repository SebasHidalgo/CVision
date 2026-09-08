import { AppError } from "./errors";

export class ValidationError extends AppError {
  constructor(message = "Invalid input") {
    super("INVALID_INPUT", message);
  }
}
