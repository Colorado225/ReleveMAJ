// GET /api/v1/alerts — flow.md §38 et §30.
// Les alertes sont recalculées à la volée depuis les données réelles : aucune
// alerte n'est inventée et aucune n'est stockée sans cause observable.
import { authenticate, ok, unauthorized } from '@/lib/api';
import { getDashboard } from '@/lib/services';
import { track } from '@/lib/analytics';

export async function GET(request: Request) {
  const session = await authenticate(request);
  if (!session) return unauthorized();

  const dashboard = await getDashboard(session.id);
  if (dashboard.alerts.length > 0) await track('alert_viewed', { userId: session.id });

  return ok({
    alerts: dashboard.alerts,
    // flow.md §34 — jamais de « 0 alerte » présenté comme un problème
    emptyMessage: 'Aucune situation inhabituelle détectée sur vos données actuelles.',
    count: dashboard.alerts.length,
  });
}