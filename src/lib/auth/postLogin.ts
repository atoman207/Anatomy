export const DEFAULT_POST_LOGIN_PATH = "/dashboard";
export const ADMIN_POST_LOGIN_PATH = "/admin";

/** Same-site post-login paths only — blocks open redirects. */
export function sanitizeNextPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return DEFAULT_POST_LOGIN_PATH;
  }
  return value;
}

/**
 * When no `next` was requested, platform administrators land on `/admin`;
 * everyone else on `/dashboard`. An explicit `next` always wins.
 */
export function postLoginPathForSession(
  rawNext: string | null,
  canAccessAdmin: boolean,
): string {
  if (rawNext) return sanitizeNextPath(rawNext);
  if (canAccessAdmin) return ADMIN_POST_LOGIN_PATH;
  return DEFAULT_POST_LOGIN_PATH;
}
