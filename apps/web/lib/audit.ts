import { Prisma } from '@prisma/client';
import { db } from './db';

/**
 * Journal d'audit (flow.md §40).
 * Isolé dans son propre module pour être réutilisé par les Server Actions
 * d'authentification comme par le back-office.
 */
export async function audit(input: {
  action: string;
  entity: string;
  entityId?: string | null;
  userId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await db.auditLog.create({
    data: {
      action: input.action,
      entity: input.entity,
      entityId: input.entityId ?? null,
      userId: input.userId ?? null,
      metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}