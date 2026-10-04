// Pipeline OCR — flow.md §57.
//
//   Photo → OCR → Extraction → Proposition → Confirmation → Sauvegarde
//
// Invariant non négociable : « l'OCR ne doit jamais écrire directement une
// facture sans confirmation humaine ». Ici, `createDraftExtraction` n'écrit
// QUE dans DraftExtraction. La facture n'est créée que par
// `confirmDraftExtraction`, après revalidation explicite par l'utilisateur.
//
// L'OCR lui-même est une V1.1 (§56 exclut la reconnaissance automatique de la
// V1) : `extractFromImage` retourne honnêtement `null` faute de moteur branché.
// Aucune valeur n'est inventée pour faire semblant.

import { db } from './db';
import { audit } from './audit';
import { track } from './analytics';
import { deleteUploadedFile, saveReceipt } from './upload';
import { z } from 'zod';

export type DraftSourceType = 'WATER_BILL' | 'ELECTRICITY_PURCHASE';

/** Ce que l'OCR proposerait. `null` = aucune proposition (moteur absent). */
export type OcrExtraction = {
  amountTtc: number | null;
  consumptionM3: number | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  rawText: string | null;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | null;
};

/**
 * Étape « OCR » puis « Extraction ».
 *
 * V1.1 : aucun moteur de reconnaissance n'est embarqué. On lit donc un texte
 * déjà transcrit s'il est fourni (OCR tiers branché plus tard, ou collage
 * manuel), et on en extrait les champs. Sans texte, on renvoie `null` — jamais
 * de valeur devinée (§64 « NE PAS INVENTER »).
 *
 * Brancher un moteur réel revient à remplacer cette fonction ; le reste du
 * pipeline (proposition → confirmation → sauvegarde) est inchangé.
 */
export async function extractFromImage(_imagePath: string): Promise<OcrExtraction | null> {
  return extractFromText(null);
}

/**
 * Extraction déterministe à partir d'un texte de reçu.
 *
 * On reste volontairement conservateur : un champ qui n'est pas trouvé reste
 * `null` et l'utilisateur le saisit. On ne devine ni ne complète.
 */
export function extractFromText(rawText: string | null): OcrExtraction | null {
  if (!rawText) return null;
  const text = rawText.replace(/\s+/g, ' ').trim();
  if (!text) return null;

  // Montant : « 6 850 FCFA », « 6850 F », « montant : 12 500 »
  const amount = text.match(/([\d][\d\s.,]*)\s*(?:fcfa|f\b|xof)/i);
  const amountTtc = amount ? parseAmount(amount[1]) : null;

  // Consommation : « 15,5 m³ », « 15.5 m3 », « 12 m3 » (entier), ou
  // « consommation 15,5 ». La partie décimale est optionnelle : une
  // consommation ronde est parfaitement légitime.
  const consumption =
    text.match(/(\d+(?:[.,]\d+)?)\s*m[³3]/i) ??
    text.match(/consommation[^0-9]{0,12}(\d+(?:[.,]\d+)?)(?!\s*m[³3])/i);
  const consumptionM3 = consumption ? parseAmount(consumption[1]) : null;

  const periodStart = parseDate(text, /(?:du|d[ée]but)[^0-9]{0,12}(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/i);
  const periodEnd = parseDate(text, /(?:au|[àa]\s?)[^0-9]{0,12}(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/i);

  // sans un seul champ exploitable, on ne propose rien
  if (amountTtc == null && consumptionM3 == null && !periodStart && !periodEnd) return null;

  return {
    amountTtc,
    consumptionM3,
    periodStart,
    periodEnd,
    rawText,
    // flow.md §11 — une extraction automatique n'est jamais « haute confiance »
    // tant qu'elle n'a pas été vérifiée par l'utilisateur.
    confidence: amountTtc != null && consumptionM3 != null ? 'MEDIUM' : 'LOW',
  };
}

/** « 6 850 » / « 6.850,00 » → 6850 */
function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/\s/g, '');
  // format_français : espace(s) ou point comme séparateur de milliers, virgule décimale
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  let normalized: string;
  if (lastComma > lastDot) {
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > lastComma) {
    normalized = cleaned.replace(/,/g, '');
  } else {
    normalized = cleaned.replace(/,/g, '.');
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function parseDate(text: string, pattern: RegExp): Date | null {
  const m = text.match(pattern);
  if (!m) return null;
  const [, d, mo, y] = m;
  const year = y.length === 2 ? 2000 + Number(y) : Number(y);
  const date = new Date(year, Number(mo) - 1, Number(d));
  return Number.isNaN(date.getTime()) ? null : date;
}

const confirmationSchema = z.object({
  draftId: z.string().min(1),
  consumptionM3: z.number().min(0, 'La consommation ne peut pas être négative.'),
  amountTtc: z.number().min(0, 'Le montant ne peut pas être négatif.'),
  periodStart: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Date de début invalide.'),
  periodEnd: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Date de fin invalide.'),
});

export type ConfirmOutcome =
  | { ok: true; billId: string }
  | { ok: false; error: string };

/**
 * Étape « Confirmation » puis « Sauvegarde ».
 *
 * C'est le SEUL endroit où une facture est écrite à partir d'une photo. La
 * transaction garantit qu'un double-clic ne crée pas deux factures.
 */
export async function confirmDraftExtraction(
  userId: string,
  input: unknown,
): Promise<ConfirmOutcome> {
  const parsed = confirmationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Données invalides.' };

  const { draftId, consumptionM3, amountTtc } = parsed.data;
  const periodStart = new Date(parsed.data.periodStart);
  const periodEnd = new Date(parsed.data.periodEnd);

  if (periodEnd < periodStart) {
    return { ok: false, error: 'La fin de période doit être postérieure au début.' };
  }
  if (periodEnd > new Date()) {
    return { ok: false, error: 'La fin de période ne peut pas être dans le futur.' };
  }
  if (consumptionM3 === 0 && amountTtc > 0) {
    return { ok: false, error: 'Indiquez la consommation en m³ pour calculer le coût effectif.' };
  }

  const result = await db.$transaction(async (tx) => {
    const draft = await tx.draftExtraction.findFirst({
      where: { id: draftId, userId, status: 'PENDING' },
      include: { meter: true },
    });
    // déjà traitée, ou appartenant à quelqu'un d'autre → rien à écrire
    if (!draft) return null;
    if (draft.meter.utilityType !== 'WATER') return null;

    const bill = await tx.waterBill.create({
      data: {
        meterId: draft.meterId,
        propertyId: draft.meter.propertyId,
        periodStart,
        periodEnd,
        consumptionM3,
        amountTtc,
        // flow.md §23 — coût effectif observé, jamais le tarif officiel
        effectiveCostPerM3: consumptionM3 > 0 ? amountTtc / consumptionM3 : null,
        receiptImagePath: draft.imagePath,
        source: 'PHOTO',
      },
    });

    await tx.draftExtraction.update({
      where: { id: draft.id },
      data: { status: 'CONFIRMED', confirmedAt: new Date(), confirmedEntityId: bill.id },
    });

    return { bill, draft };
  });

  if (!result) {
    return { ok: false, error: 'Cette proposition a déjà été traitée ou est introuvable.' };
  }

  await audit({
    action: 'draft_extraction_confirmed',
    entity: 'DraftExtraction',
    entityId: result.draft.id,
    userId,
    metadata: { billId: result.bill.id },
  });
  await track('first_bill', { userId });

  return { ok: true, billId: result.bill.id };
}

/** L'utilisateur refuse la proposition : rien n'est écrit, la photo est supprimée. */
export async function rejectDraftExtraction(userId: string, draftId: string): Promise<boolean> {
  const draft = await db.draftExtraction.findFirst({
    where: { id: draftId, userId, status: 'PENDING' },
    select: { id: true, imagePath: true },
  });
  if (!draft) return false;

  await db.draftExtraction.update({ where: { id: draft.id }, data: { status: 'REJECTED' } });
  await audit({
    action: 'draft_extraction_rejected',
    entity: 'DraftExtraction',
    entityId: draft.id,
    userId,
  });

  // Un reçu refusé n'a plus de raison d'être conservé : le fichier est
  // supprimé du disque (la ligne passe en REJECTED pour garder la trace).
  await deleteUploadedFile(draft.imagePath);

  return true;
}

/** Dépose une photo : l'image est stockée, une proposition est créée. */
export async function createDraftExtraction(input: {
  userId: string;
  meterId: string;
  sourceType: DraftSourceType;
  file: File;
  /** texte déjà transcrit (OCR tiers ou collage manuel) — facultatif */
  rawText?: string | null;
}): Promise<{ ok: true; draftId: string } | { ok: false; error: string }> {
  const meter = await db.meter.findFirst({
    where: { id: input.meterId, property: { userId: input.userId } },
    select: { id: true, utilityType: true },
  });
  if (!meter) return { ok: false, error: 'Compteur introuvable.' };

  // réutilise la validation existante : magic bytes, taille, type réel
  const upload = await saveReceipt(input.file);
  if (!upload.ok) return { ok: false, error: upload.error };

  // pas de texte fourni → on tente rien : aucune valeur n'est devinée
  const extraction = input.rawText ? extractFromText(input.rawText) : null;

  const draft = await db.draftExtraction.create({
    data: {
      userId: input.userId,
      meterId: meter.id,
      sourceType: input.sourceType,
      imagePath: upload.path,
      status: 'PENDING',
      rawText: extraction?.rawText ?? null,
      proposedAmountTtc: extraction?.amountTtc ?? null,
      proposedConsumptionM3: extraction?.consumptionM3 ?? null,
      proposedPeriodStart: extraction?.periodStart ?? null,
      proposedPeriodEnd: extraction?.periodEnd ?? null,
      extractionConfidence: extraction?.confidence ?? null,
    },
  });

  await audit({
    action: 'draft_extraction_created',
    entity: 'DraftExtraction',
    entityId: draft.id,
    userId: input.userId,
    metadata: { sourceType: input.sourceType },
  });

  return { ok: true, draftId: draft.id };
}

/** Propositions en attente, les plus récentes d'abord. */
export async function listPendingDrafts(userId: string) {
  return db.draftExtraction.findMany({
    where: { userId, status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
    include: { meter: { select: { id: true, label: true, utilityType: true, provider: true } } },
  });
}