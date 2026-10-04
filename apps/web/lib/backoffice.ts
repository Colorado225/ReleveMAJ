// Contrôle d'accès au back-office — flow.md §40 (RBAC).
// Centralisé pour que chaque page back-office applique la même règle.
import { db } from './db';
import type { SessionUser } from './auth-core';

export type BackOfficeAccess = { allowed: true } | { allowed: false };

/**
 * Seuls les membres d'une organisation avec le rôle OWNER ou ADMIN accèdent au
 * back-office. Un utilisateur absent de toute organisation est refusé.
 */
export async function requireBackOffice(session: SessionUser): Promise<BackOfficeAccess> {
  const member = await db.organizationMember.findFirst({
    where: { userId: session.id, role: { in: ['OWNER', 'ADMIN'] } },
    select: { id: true },
  });
  return member ? { allowed: true } : { allowed: false };
}