// Page 404 — flow.md §52. Remplace la page par défaut de Next.js, qui est
// en anglais et ne propose aucune sortie.
import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm">
        <p className="text-sm font-medium text-gray-500">Erreur 404</p>
        <h1 className="mt-1 text-lg font-semibold">Cette page n’existe pas</h1>
        <p className="mt-2 text-sm leading-6 text-gray-600">
          Le lien est peut-être obsolète. Vos données sont intactes.
        </p>
        <Link
          href="/"
          className="mt-5 inline-block rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white"
        >
          Retour à l’accueil
        </Link>
      </div>
    </div>
  );
}