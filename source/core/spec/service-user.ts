/**
 * The user khatm acts as when it administers identities through Better Auth.
 * It has no account, so nobody can sign in as it, and the admin plugin lists
 * it in `adminUserIds`, so its sessions pass every permission check. The
 * person behind an admin action is recorded separately, never as this user.
 */
export const SERVICE_USER = {
  id: 'khatm-service',
  email: 'service@khatm.invalid',
  name: 'khatm',
} as const
