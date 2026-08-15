export interface AnonymizeFailure {
  code?: string;
  message?: string;
}

export interface PublicFailure {
  status: 403 | 409 | 500;
  error: 'role_not_supported' | 'active_order' | 'anonymize_failed';
}

/** Reduce database diagnostics to the endpoint's bounded public contract. */
export function classifyAnonymizeFailure(error: AnonymizeFailure): PublicFailure {
  if (/ACCOUNT_DELETION_ROLE_NOT_SUPPORTED/i.test(error.message ?? '')) {
    return { status: 403, error: 'role_not_supported' };
  }
  if (error.code === '23514' && /ACTIVE_ORDER/i.test(error.message ?? '')) {
    return { status: 409, error: 'active_order' };
  }
  return { status: 500, error: 'anonymize_failed' };
}
