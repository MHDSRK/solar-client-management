export const AUTHORIZED_USER_EMAILS = [
  "solar.disunenergy@gmail.com",
  "mhdsharookh@gmail.com",
];

export function normalizeEmail(email?: string | null): string {
  return email?.trim().toLowerCase() ?? "";
}

export function isAuthorizedEmail(email?: string | null): boolean {
  const normalized = normalizeEmail(email);
  return AUTHORIZED_USER_EMAILS.some((authorized) => authorized.toLowerCase() === normalized);
}
