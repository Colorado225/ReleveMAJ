'use client';

import { useActionState, useEffect, useState } from 'react';
import { AlertTriangle, Loader2, Pencil, Trash2, X } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui';

/**
 * Contrôleur de suppression — flow.md §21.
 *
 * Supprimer un logement efface en cascade ses compteurs, ses relevés, ses
 * recharges et ses factures. On ne met donc JAMAIS un bouton « Supprimer »
 * directement sur la ligne : la suppression se demande dans une boîte de
 * dialogue, et le texte rappelle ce qui disparaît avec.
 *
 * Le `Dialog` de shadcn (Radix) apporte ce qu'un simple état `open` n'apporte
 * pas : piège de focus, fermeture par Échap, `aria-modal`, et restitution du
 * focus au bouton d'origine après fermeture (flow.md §43).
 */
export function DeleteControl({
  id,
  action,
  entityLabel,
  cascadeWarning,
}: {
  id: string;
  action: (prev: string | null, formData: FormData) => Promise<string | null>;
  /** Ce que l'utilisateur reconnaît : « le logement "Yopougon" ». */
  entityLabel: string;
  /** Ce qui part en cascade, si applicable. */
  cascadeWarning?: string;
}) {
  const [open, setOpen] = useState(false);
  const [message, formAction, pending] = useActionState(action, null);

  // La suppression réussie revalide la page : le dialogue n'a plus lieu d'être.
  // On ne ferme que sur succès (message === null) pour qu'une erreur reste lisible.
  useEffect(() => {
    if (message === null && open) setOpen(false);
  }, [message, open]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={`Supprimer ${entityLabel}`}
          className="inline-flex items-center gap-1 text-xs text-gray-500 underline-offset-2 hover:text-red-600 hover:underline"
        >
          <Trash2 size={12} aria-hidden />
          Supprimer
        </button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle size={18} className="text-red-600" aria-hidden />
            Supprimer {entityLabel} ?
          </DialogTitle>
          <DialogDescription>
            {cascadeWarning ??
              'Cette opération est définitive : la donnée supprimée ne peut pas être récupérée.'}
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="id" value={id} />

          {/* Erreur du serveur : le dialogue reste ouvert pour qu'elle soit lue. */}
          {message && (
            <p role="alert" className="rounded-lg bg-red-50 p-2 text-sm text-red-700">
              {message}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Annuler
            </Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending && <Loader2 size={15} className="animate-spin" aria-hidden />}
              Supprimer définitivement
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Bascule d'édition : le formulaire apparaît sous la ligne, sans quitter la page.
 *
 * Volontairement PAS un `Dialog`, contrairement à `DeleteControl` : un
 * formulaire de modification compte cinq à six champs, et un dialogue le
 * tronquerait hors de l'écran tout en masquant la ligne qu'il modifie. Voir la
 * donnée et sa correction côte à côte est ici le bon compromis.
 *
 * On garde le formulaire monté seulement quand il est ouvert : un formulaire
 * caché reste dans le DOM et le soumettrait au premier « Entrée » pressé ailleurs.
 *
 * Le piège de focus de Radix n'est pas utilisé ici : la saisie reste libre dans
 * la page, ce qui est le comportement attendu pour un formulaire en ligne.
 */
export function EditControl({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={label}
        className="inline-flex items-center gap-1 text-xs text-gray-500 underline-offset-2 hover:text-gray-900 hover:underline"
      >
        <Pencil size={12} aria-hidden />
        Modifier
      </button>
    );
  }

  return (
    <div className="mt-3 flex flex-col gap-3">
      {children}
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="inline-flex w-fit items-center gap-1 text-xs text-gray-500 underline-offset-2 hover:underline"
      >
        <X size={12} aria-hidden />
        Annuler la modification
      </button>
    </div>
  );
}