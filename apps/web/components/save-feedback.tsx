'use client';

// Feedback après sauvegarde — flow.md §44.
//
// Point important : une sauvegarde RÉUSSIE ne doit pas dépendre d'une animation.
// Si l'utilisateur n'a pas de « mouvement réduit », un retour visuel suffit —
// on n'ajoute pas de message qui disparaîtrait tout seul et qui masquerait
// l'information.

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Check } from 'lucide-react';
import { Button } from './ui';

/**
 * Bouton d'enregistrement avec retour visuel.
 * `pending` = envoi en cours, `message` = erreur éventuelle (durée indefinite).
 */
export function SaveButton({
  pending,
  message,
  label = 'Enregistrer',
  pendingLabel = 'Enregistrement…',
}: {
  pending: boolean;
  message: string | null;
  label?: string;
  pendingLabel?: string;
}) {
  const reduce = useReducedMotion();
  const isError = Boolean(message);

  return (
    <div className="flex flex-col gap-2">
      <Button type="submit" disabled={pending} className="relative w-full overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={pending ? 'pending' : 'idle'}
            initial={reduce ? { opacity: 1 } : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6 }}
            transition={{ duration: reduce ? 0 : 0.18 }}
            className="flex items-center justify-center gap-2"
          >
            {pending ? pendingLabel : label}
            {!pending && !isError && <Check size={16} aria-hidden />}
          </motion.span>
        </AnimatePresence>
      </Button>

      {/* Les erreurs restent affichées : elles ne disparaissent pas d'elles-mêmes. */}
      {message && (
        <p
          role="alert"
          className="text-xs leading-5 text-amber-700"
        >
          {message}
        </p>
      )}
    </div>
  );
}
