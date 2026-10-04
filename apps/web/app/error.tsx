'use client';

// Frontière d'erreur de l'application — flow.md §52 « feedback d'erreur
// compréhensible ». Sans ce fichier, une exception dans une Server Action
// affiche la page d'erreur brute de Next.js, en anglais.

import { useEffect } from 'react';
import { Button } from '@/components/ui';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // journalisation côté client : l'audit serveur, lui, vit dans AuditLog
    console.error('Erreur applicative', error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold">Quelque chose s’est mal passé</h1>
        <p className="mt-2 text-sm leading-6 text-gray-600">
          Vos données sont intactes. Réessayez ; si le problème persiste, revenez à l’accueil.
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <Button onClick={reset}>Réessayer</Button>
          <Button asChild variant="outline">
            <a href="/">Retour à l’accueil</a>
          </Button>
        </div>
        {error.digest && (
          <p className="mt-4 text-[11px] text-gray-400">Référence : {error.digest}</p>
        )}
      </div>
    </div>
  );
}