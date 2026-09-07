import { setResponseStatus } from "@tanstack/react-start/server";

// TanStack serializes Error inside its RPC envelope. Set the response status
// explicitly as well, so browsers, monitoring and rate-limit clients agree.
export function httpError(statusCode: number, message: string) {
  setResponseStatus(statusCode);
  return Object.assign(new Error(message), { statusCode });
}
