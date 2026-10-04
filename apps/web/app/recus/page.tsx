import { redirect } from 'next/navigation';
import { Camera } from 'lucide-react';
import { getSessionUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { AppShell } from '@/components/app-shell';
import { Card, EmptyState } from '@/components/ui';
import { ReceiptUploadForm, DraftReviewCard } from '@/components/draft-review';
import { listPendingDrafts } from '@/lib/ocr-pipeline';

export const dynamic = 'force-dynamic';

const date = (d: Date) =>
  d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });

/**
 * Reçus à confirmer — flow.md §57.
 *
 * Invariant affiché noir sur blanc : une photo ne devient une facture qu'après
 * validation par l'utilisateur. Le refus est une action à part entière, aussi
 * simple que la confirmation.
 */
export default async function ReceiptsPage() {
  const session = await getSessionUser();
  if (!session) redirect('/connexion');

  const [pending, waterMeters] = await Promise.all([
    listPendingDrafts(session.id),
    db.meter.findMany({
      where: { property: { userId: session.id }, utilityType: 'WATER', active: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true, label: true, provider: true },
    }),
  ]);

  return (
    <AppShell title="Reçus">
      <main className="mx-auto max-w-3xl px-4 py-5 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-semibold tracking-tight">Vos reçus</h1>
        <p className="mt-1 text-sm text-gray-500">
          Photographiez un reçu SODECI : vous vérifiez les valeurs avant qu’elles ne comptent.
        </p>

        <Card className="mt-4 border-gray-200 bg-gray-50/60 p-4">
          <p className="text-xs leading-5 text-gray-600">
            <b>Aucune facture n’est créée automatiquement.</b> Une photo reste une simple
            proposition tant que vous ne l’avez pas confirmée. Vous pouvez corriger les valeurs avant
            d’enregistrer, ou refuser le reçu.
          </p>
        </Card>

        {waterMeters.length > 0 && (
          <div className="mt-5">
            <ReceiptUploadForm
              meters={waterMeters.map((m) => ({
                id: m.id,
                label: m.label ?? 'Compteur SODECI',
              }))}
            />
          </div>
        )}

        <section className="mt-6">
          <h2 className="font-semibold">En attente de confirmation</h2>

          {pending.length === 0 ? (
            <div className="mt-3">
              <EmptyState
                title="Aucun reçu en attente."
                body="Déposez une photo de facture pour la vérifier ici avant de l’enregistrer."
                cta={
                  <span className="inline-flex items-center gap-2 text-xs text-gray-400">
                    <Camera size={14} />
                    Format : JPEG, PNG, WebP, HEIC ou PDF — 5 Mo maximum
                  </span>
                }
              />
            </div>
          ) : (
            <ul className="mt-3 flex flex-col gap-4">
              {pending.map((draft) => (
                <DraftReviewCard
                  key={draft.id}
                  draft={{
                    id: draft.id,
                    imagePath: draft.imagePath,
                    createdAt: draft.createdAt.toISOString(),
                    meterLabel: draft.meter.label ?? 'Compteur SODECI',
                    proposedConsumptionM3: draft.proposedConsumptionM3,
                    proposedAmountTtc: draft.proposedAmountTtc,
                    proposedPeriodStart: draft.proposedPeriodStart?.toISOString() ?? null,
                    proposedPeriodEnd: draft.proposedPeriodEnd?.toISOString() ?? null,
                    extractionConfidence: draft.extractionConfidence,
                  }}
                />
              ))}
            </ul>
          )}
        </section>

        {pending.length > 0 && (
          <p className="mt-4 text-xs text-gray-400">
            Déposé le {date(pending[0].createdAt)} · les valeurs que vous confirmez entrent dans vos
            calculs d’eau et vos projections.
          </p>
        )}
      </main>
    </AppShell>
  );
}