'use server';

import { revalidatePath } from 'next/cache';
import { getSessionUser } from './auth';
import { requireBackOffice } from './backoffice';
import { db } from './db';
import { audit } from './audit';

/**
 * Back-office tarifaire (flow.md §49).
 *
 * Les tarifs sont administrables sans modifier le frontend : on ne modifie
 * JAMAIS une version publiée (flow.md §14), on crée une nouvelle version.
 */

async function requireAdmin() {
  const session = await getSessionUser();
  if (!session) throw new Error('Session expirée.');
  // flow.md §40 — RBAC centralisé (lib/backoffice.ts)
  if (!(await requireBackOffice(session)).allowed) {
    throw new Error("Accès réservé aux administrateurs d'organisation.");
  }
  return session;
}

/** Liste des règles d'une grille, pour l'affichage. */
export async function listTariffRules(schemeId: string) {
  return db.tariffRule.findMany({
    where: { schemeId },
    orderBy: { position: 'asc' },
  });
}

/**
 * Publie une nouvelle version d'une grille existante.
 *
 * Les règles sont copiées depuis la version courante puis remplacées par les
 * valeurs fournies. L'ancienne version reste intacte et consultable.
 */
export async function publishTariffVersionAction(
  _prev: string | null,
  formData: FormData,
): Promise<string | null> {
  try {
    await requireAdmin();
  } catch (e) {
    return e instanceof Error ? e.message : 'Action non autorisée.';
  }

  const baseCode = String(formData.get('code') ?? '');
  const effectiveFrom = String(formData.get('effectiveFrom') ?? '');
  const sourceUrl = String(formData.get('sourceUrl') ?? '');
  const sourceName = String(formData.get('sourceName') ?? '');

  if (!baseCode || !effectiveFrom || Number.isNaN(Date.parse(effectiveFrom))) {
    return 'Code et date d’effet valide sont obligatoires.';
  }
  if (!/^https:\/\//.test(sourceUrl)) {
    return 'La source doit être une URL en https.';
  }

  const base = await db.tariffScheme.findFirst({
    where: { code: baseCode },
    orderBy: { version: 'desc' },
    include: { rules: true },
  });
  if (!base) return 'Grille inconnue.';

  const latest = await db.tariffScheme.findFirst({
    where: { code: baseCode },
    orderBy: { version: 'desc' },
  });

  // une nouvelle version ne peut pas commencer avant la précédente
  if (latest && new Date(effectiveFrom) < latest.effectiveFrom) {
    return 'La date d’effet ne peut pas précéder celle de la version en cours.';
  }

  const submitted = formData.getAll('rule');
  const values = new Map<string, string>();
  for (const raw of submitted) {
    const s = String(raw);
    const i = s.indexOf(':');
    if (i > 0) values.set(s.slice(0, i), s.slice(i + 1));
  }

  const nextVersion = (latest?.version ?? 0) + 1;
  const created = await db.tariffScheme.create({
    data: {
      code: baseCode,
      version: nextVersion,
      provider: base.provider,
      category: base.category,
      subscribedPower: base.subscribedPower,
      effectiveFrom: new Date(effectiveFrom),
      // la version précédente reste valable jusqu'à la nouvelle date d'effet
      effectiveTo: null,
      sourceUrl,
      sourceName,
      documentReference: String(formData.get('documentReference') ?? ''),
      verifiedAt: new Date(),
      rules: {
        create: base.rules.map((r) => ({
          kind: r.kind,
          label: r.label,
          unit: r.unit,
          position: r.position,
          value: values.has(r.kind) ? Number(values.get(r.kind)) : r.value,
        })),
      },
    },
  });

  await audit({
    action: 'tariff_version_published',
    entity: 'TariffScheme',
    entityId: created.id,
    metadata: { code: baseCode, version: nextVersion, effectiveFrom },
  });

  revalidatePath('/back-office/tarifs');
  return null;
}