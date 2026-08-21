/**
 * Store only access/refresh tokens in cookies. The full user object (and any
 * avatar data URL that once lived in user_metadata) must not sit in the
 * Cookie header — that is what triggers HTTP 431.
 */
export const AUTH_COOKIE_ENCODE = "tokens-only" as const;
