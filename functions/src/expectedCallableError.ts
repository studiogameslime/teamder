import { HttpsError } from 'firebase-functions/v2/https';

/** Explicit rejection of a request by the endpoint's existing input/access
 * policy. Preserves Firebase's response code and details. Infrastructure
 * failures, including ordinary HttpsErrors, remain observable. */
export class ExpectedCallableError extends HttpsError {}

export function isExpectedCallableError(error: unknown): error is ExpectedCallableError {
  return error instanceof ExpectedCallableError;
}
