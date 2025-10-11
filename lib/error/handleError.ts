import { ValidationError } from "./ValidationError";

export const handleError = (error: unknown, fallbackMessage: string): never => {
  if (error instanceof ValidationError) {
    throw error;
  }

  throw new Error(fallbackMessage, { cause: error });
};
