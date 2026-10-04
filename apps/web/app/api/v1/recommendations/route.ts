// GET /api/v1/recommendations — flow.md §38 et §31.
// Maximum 3, chacune justifiée par une donnée observée (`basis`).
import { authenticate, ok, unauthorized } from '@/lib/api';
import { getDashboard } from '@/lib/services';
import { track } from '@/lib/analytics';

export async function GET(request: Request) {
  const session = await authenticate(request);
  if (!session) return unauthorized();

  const dashboard = await getDashboard(session.id);
  await track('recommendation_viewed', { userId: session.id });

  return ok({
    recommendations: dashboard.recommendations,
    // flow.md §31 — plafond de 3 recommandations simultanées
    maxDisplayed: 3,
  });
}