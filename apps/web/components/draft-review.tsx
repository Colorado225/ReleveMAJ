'use client';

import { useActionState } from 'react';
import { confirmDraftAction, createDraftAction, rejectDraftAction } from '@/lib/data-actions';
import { Button, Input, Label } from '@/components/ui';

import { SelectField } from './form-fields';
import { SaveButton } from './save-feedback';

/**
 * Dépôt d'une photo de reçu — flow.md §57.
 *
 * Le formulaire ne contient QUE la photo et le compteur. Il n'y a aucun champ
 * montant/consommation ici : ces valeurs ne doivent pas pouvoir être
 * enregistrées sans passer par l'écran de confirmation.
 */
export function ReceiptUploadForm({ meters }: { meters: { id: string; label: string }[] }) {
  const [message, action, pending] = useActionState(createDraftAction, null);

  return (
    <form action={action} className="flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-5">
      <h2 className="font-semibold">Ajouter un reçu</h2>

      {meters.length > 1 && (
        <SelectField
          name="meterId"
          label="Compteur"
          options={meters.map((m) => ({ value: m.id, label: m.label }))}
        />
      )}
      {meters.length === 1 && <input type="hidden" name="meterId" value={meters[0].id} />}

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Photo du reçu</span>
        <input
          name="receipt"
          type="file"
          required
          accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
          className="rounded-xl border border-gray-200 px-3 py-2 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-sm"
        />
        <span className="text-xs text-gray-500">JPEG, PNG, WebP, HEIC ou PDF — 5 Mo maximum.</span>
      </label>

      {/* flow.md §57 — la lecture automatique arrive en V1.1. Un texte déjà
          transcrit permet dès aujourd'hui de proposer des valeurs, qui restent
          à confirmer avant tout enregistrement. */}
      <details className="rounded-xl border border-gray-200 p-3">
        <summary className="cursor-pointer text-sm font-medium">
          J’ai le texte de mon reçu (facultatif)
        </summary>
        <label className="mt-3 flex flex-col gap-1 text-sm">
          <span className="font-medium">Texte du reçu</span>
          <textarea
            id="rawText"
            name="rawText"
            rows={4}
            placeholder="Ex. : Consommation 15,5 m3 du 01/09/2026 au 30/09/2026 — Montant 6 850 FCFA"
            aria-describedby="rawText-help"
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
          <span id="rawText-help" className="text-xs text-gray-500">
            Les valeurs trouvées seront proposées — vous les vérifiez avant d’enregistrer.
          </span>
        </label>
      </details>

      {message && (
        <p role="alert" className="text-xs text-red-600">
          {message}
        </p>
      )}

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Envoi…' : 'Envoyer pour vérification'}
      </Button>
    </form>
  );
}
export type PendingDraft = {
  id: string;
  imagePath: string;
  createdAt: string;
  meterLabel: string;
  proposedConsumptionM3: number | null;
  proposedAmountTtc: number | null;
  proposedPeriodStart: string | null;
  proposedPeriodEnd: string | null;
  extractionConfidence: string | null;
};

/**
 * Carte de confirmation — flow.md §57.
 *
 * Point central : l'utilisateur CONFIRME avant tout enregistrement. Tant que ce
 * bouton n'est pas actionné, la facture n'existe pas et n'entre dans aucun
 * calcul. Les valeurs proposées par l'OCR sont pré-remplies mais modifiables —
 * c'est la personne qui décide, pas la machine.
 */
export function DraftReviewCard({ draft }: { draft: PendingDraft }) {
  return (
    <li className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Reçu à vérifier</h2>
          <p className="mt-0.5 text-xs text-gray-500">
            {draft.meterLabel} · déposé le{' '}
            {new Date(draft.createdAt).toLocaleDateString('fr-FR', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
            })}
          </p>
        </div>
        <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
          En attente de votre confirmation
        </span>
      </div>

      <ConfirmForm draft={draft} />
      <RejectForm draftId={draft.id} />
    </li>
  );
}

function ConfirmForm({ draft }: { draft: PendingDraft }) {
  const [message, action, pending] = useActionState(confirmDraftAction, null);

  return (
    <form action={action} className="mt-4 flex flex-col gap-4">
      <input type="hidden" name="draftId" value={draft.id} />

      {draft.extractionConfidence == null && (
        <p className="rounded-xl bg-gray-50 p-3 text-xs leading-5 text-gray-600">
          La lecture automatique du reçu n’est pas encore disponible. Vérifiez les valeurs sur votre
          photo, complétez-les ci-dessous, puis confirmez.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="consumptionM3">Consommation (m³)</Label>
            <Input
              id="consumptionM3"
              name="consumptionM3"
              type="number"
              required
              min="0"
              step="0.01"
              defaultValue={draft.proposedConsumptionM3 ?? ''}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="amountTtc">Montant TTC (FCFA)</Label>
            <Input
              id="amountTtc"
              name="amountTtc"
              type="number"
              required
              min="0"
              step="1"
              defaultValue={draft.proposedAmountTtc ?? ''}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="periodStart">Début de période</Label>
            <Input
              id="periodStart"
              name="periodStart"
              type="date"
              required
              defaultValue={draft.proposedPeriodStart?.slice(0, 10) ?? ''}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="periodEnd">Fin de période</Label>
            <Input
              id="periodEnd"
              name="periodEnd"
              type="date"
              required
              defaultValue={draft.proposedPeriodEnd?.slice(0, 10) ?? ''}
            />
          </div>
        </div>

      <SaveButton
        pending={pending}
        message={message}
        label="Confirmer et enregistrer"
        pendingLabel="Enregistrement…"
      />
    </form>
  );
}

function RejectForm({ draftId }: { draftId: string }) {
  const [message, action, pending] = useActionState(rejectDraftAction, null);

  return (
    <form action={action} className="mt-3">
      <input type="hidden" name="draftId" value={draftId} />
      <button
        type="submit"
        disabled={pending}
        className="text-xs text-gray-400 underline hover:text-red-600 disabled:opacity-50"
      >
        {message ?? 'Ce reçu ne correspond pas — le rejeter'}
      </button>
    </form>
  );
}