// Analytics produit — flow.md §48.
//
// Les événements sont écrits sans bloquer la requête : un échec de tracking ne
// doit jamais faire échouer une saisie métier. Aucun caractère identifiant n'est
// stocké dans les propriétés.
export const PRODUCT_EVENTS = [
  'signup',
  'otp_verified',
  'property_created',
  'meter_created',
  'first_reading',
  'first_purchase',
  'first_bill',
  'dashboard_viewed',
  'forecast_viewed',
  'alert_viewed',
  'recommendation_viewed',
  'premium_clicked',
] as const;

export type ProductEvent = (typeof PRODUCT_EVENTS)[number];

export async function track(
  event: ProductEvent,
  options: { userId?: string | null; metadata?: Record<string, string | number | boolean> } = {},
): Promise<void> {
  try {
    const { db } = await import('./db');
    await db.productEvent.create({
      data: {
        event,
        userId: options.userId ?? null,
        metadata: (options.metadata ?? undefined) as never,
      },
    });
  } catch {
    // le tracking est best-effort : on ne casse jamais le parcours utilisateur
  }
}