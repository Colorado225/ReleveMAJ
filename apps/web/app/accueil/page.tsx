// Landing — flow.md §33. Première étape du parcours, avant le téléphone.
// Aucun compte n'est requis pour comprendre la promesse (flow.md §61 FIRST VALUE).
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowRight, Droplets, Gauge, Lightbulb, TrendingUp } from 'lucide-react';
import { getSessionUser } from '@/lib/auth';

const STEPS = [
  {
    icon: Lightbulb,
    title: 'Mesurez',
    body: 'Enregistrez vos recharges CIE et vos index SODECI en quelques secondes.',
  },
  {
    icon: Gauge,
    title: 'Comprenez',
    body: 'Voyez exactement combien vous dépensez, en kWh et en m³, mois après mois.',
  },
  {
    icon: TrendingUp,
    title: 'Anticipez',
    body: 'Une projection fondée sur votre rythme réel, jamais une fausse promesse.',
  },
  {
    icon: Droplets,
    title: 'Agissez',
    body: 'Des alertes prudentes et des conseils concrets quand quelque chose change.',
  },
];

export default async function LandingPage() {
  const session = await getSessionUser();
  // un utilisateur déjà connecté ne voit pas la landing
  if (session) redirect('/');

  return (
    <div className="min-h-screen bg-[#f7f8fa]">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-xl bg-gray-900 text-white">C</div>
          <span className="font-semibold">ConsoCI</span>
        </div>
        <Link
          href="/connexion"
          className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm"
        >
          Commencer
        </Link>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
        <section className="pt-10 text-center sm:pt-16">
          <p className="text-sm font-medium text-gray-500">Votre consommation. Votre budget. Votre contrôle.</p>
          <h1 className="mx-auto mt-3 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
            Comprenez enfin où part votre argent chez CIE et SODECI.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-gray-600">
            ConsoCI note vos recharges et vos relevés, puis vous dit clairement ce que vous consommez et
            ce que cela vous coûte.
          </p>
          <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/connexion"
              className="inline-flex items-center gap-2 rounded-xl bg-gray-900 px-5 py-3 text-sm font-medium text-white shadow-sm"
            >
              Créer mon compte
              <ArrowRight size={16} />
            </Link>
            <p className="text-xs text-gray-500">Numéro de téléphone uniquement. Aucun mot de passe.</p>
          </div>
        </section>

        <section className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s) => (
            <div key={s.title} className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-sm">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-gray-100">
                <s.icon size={18} />
              </div>
              <h2 className="mt-4 font-semibold">{s.title}</h2>
              <p className="mt-1.5 text-sm leading-6 text-gray-500">{s.body}</p>
            </div>
          ))}
        </section>

        <section className="mt-10 rounded-2xl border border-gray-200/80 bg-white p-6 shadow-sm">
          <h2 className="font-semibold">Une promesse tenue : jamais de fausse précision</h2>
          <ul className="mt-4 flex flex-col gap-3 text-sm text-gray-600">
            <li className="flex gap-2">
              <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-gray-400" />
              Vos kWh sont marqués <b>Réel</b> s’ils viennent du reçu, <b>Estimé</b> s’ils sont calculés.
            </li>
            <li className="flex gap-2">
              <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-gray-400" />
              Les projections sont toujours étiquetées « projection », jamais « prévision garantie ».
            </li>
            <li className="flex gap-2">
              <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-gray-400" />
              Une facture SODECI donne un coût <b>effectif observé</b>, pas un tarif officiel inventé.
            </li>
          </ul>
        </section>
      </main>
    </div>
  );
}