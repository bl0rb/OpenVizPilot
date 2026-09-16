export type TableauErrorCode =
  | 'TABLEAU_CONFIG_INVALID'
  | 'TABLEAU_SECRET_UNAVAILABLE'
  | 'TABLEAU_DISABLED'
  | 'TABLEAU_CLAIM_INVALID'
  | 'TABLEAU_IDENTITY_EXPIRED'
  | 'TABLEAU_AUTH_FAILED'
  | 'TABLEAU_WRONG_SITE'
  | 'TABLEAU_USER_MISMATCH'
  | 'TABLEAU_RESPONSE_INVALID'
  | 'TABLEAU_ENDPOINT_FORBIDDEN'
  | 'TABLEAU_TARGET_BLOCKED'
  | 'TABLEAU_REQUEST_FAILED'
  | 'TABLEAU_TIMEOUT'
  | 'TABLEAU_RESPONSE_TOO_LARGE'
  | 'TABLEAU_REDIRECT'
  | 'TABLEAU_SIGNIN_INVALIDATED'
  | 'TABLEAU_HTTP_ERROR'
  | 'TABLEAU_QUERY_INVALID'
  | 'TABLEAU_METADATA_FAILED'
  | 'TABLEAU_VERSION_UNSUPPORTED'
  | 'TABLEAU_ABORTED'
  | 'TABLEAU_EAS_KEY_MISSING';

/** Connector errors contain only a stable classification and optional HTTP status. */
export class TableauError extends Error {
  constructor(
    readonly code: TableauErrorCode,
    readonly status?: number,
  ) {
    super(code);
    this.name = 'TableauError';
  }
}

export function isTableauError(error: unknown): error is TableauError {
  return error instanceof TableauError;
}
