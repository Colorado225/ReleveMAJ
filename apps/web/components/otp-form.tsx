'use client';

import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CheckCircle2, KeyRound, Loader2, MessageSquare, Phone } from 'lucide-react';
import { requestOtp, verifyOtp } from '@/lib/actions';
import { formatCivPhone, normalizeCivPhone } from '@/lib/phone';
import { cn } from '@/components/ui';

/** Délai avant de proposer un nouveau code (secondes). */
const RESEND_DELAY = 45;

type Step = 'phone' | 'code';

/**
 * `requestOtp` renvoie un texte libre : un succès ou une erreur. On ne peut pas
 * distinguer les deux par le type, seulement par le contenu. Ces deux motifs
 * sont les seules réponses de succès possibles (voir lib/actions.ts).
 */
function isSuccessMessage(message: string | null): boolean {
  if (!message) return false;
  return message.startsWith('Code envoyé') || message.startsWith('Code de démonstration');
}

/** Extrait le code affiché en développement (« Code de démonstration : 123456 »). */
function extractDevCode(message: string | null): string | null {
  const m = message?.match(/(\d{6})\s*$/);
  return m ? m[1] : null;
}

/**
 * Formulaire d'inscription ET de connexion — flow.md §33 et §40.
 *
 * Un seul parcours, pas deux écrans : le numéro crée le compte s'il est
 * inconnu, ou ouvre la session s'il existe déjà. C'est déjà ce que fait
 * `verifyOtp` (upsert) ; l'interface le raconte désormais clairement au lieu
 * de laisser croire qu'il faut choisir.
 *
 * Le parcours est découpé en deux étapes réelles (numéro → code) au lieu
 * d'afficher deux formulaires empilés : on ne voit que ce qui est saisissable
 * à ce moment-là.
 */
export function OtpForm() {
  const [step, setStep] = useState<Step>('phone');
  const [phoneInput, setPhoneInput] = useState('');
  const [code, setCode] = useState('');
  const [touched, setTouched] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [otpMessage, otpAction, otpPending] = useActionState(requestOtp, null);
  const [sessionMessage, sessionAction, sessionPending] = useActionState(verifyOtp, null);

  const phoneRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  const phone = useMemo(() => normalizeCivPhone(phoneInput), [phoneInput]);
  const phoneReady = phone !== null;

  // Le message d'erreur ne s'affiche qu'après une tentative : on ne ridiculise
  // pas l'utilisateur qui est encore en train de taper (§43, §52).
  const phoneError =
    touched && phoneInput.trim().length > 0 && !phoneReady
      ? 'Numéro incomplet. Exemple : 07 00 00 00 00.'
      : null;

  // Passage automatique à l'étape 2 quand le code a bien été envoyé.
  useEffect(() => {
    if (isSuccessMessage(otpMessage)) {
      setStep('code');
      setResendIn(RESEND_DELAY);
    }
  }, [otpMessage]);

  // Compte à rebours du renvoi, puis on rend la main.
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((n) => Math.max(0, n - 1)), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  // Le focus suit l'étape : au clavier, l'utilisateur ne cherche pas où taper.
  useEffect(() => {
    if (step === 'phone') phoneRef.current?.focus();
    else codeRef.current?.focus();
  }, [step]);

  const devCode = extractDevCode(otpMessage);

  // Tout message qui n'est pas un succès est une erreur à afficher.
  const otpError = otpMessage && !isSuccessMessage(otpMessage) ? otpMessage : null;

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* Colonne de promesse — flow.md §61 : la valeur se comprend avant le compte. */}
      <div className="flex flex-col justify-between bg-gray-900 px-6 py-10 text-white lg:w-[44%] lg:px-12 lg:py-16">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-xl bg-white text-sm font-semibold text-gray-900">
            C
          </div>
          <span className="font-semibold">ConsoCI</span>
        </div>

        <div className="my-10 max-w-sm lg:my-0">
          <p className="text-sm text-gray-400">Votre consommation. Votre budget. Votre contrôle.</p>
          <h1 className="mt-3 text-2xl font-semibold leading-tight tracking-tight lg:text-3xl">
            {step === 'phone'
              ? 'Commençons par votre numéro.'
              : 'Entrez le code reçu par SMS.'}
          </h1>
          <p className="mt-3 text-sm leading-6 text-gray-400">
            {step === 'phone'
              ? 'Un numéro suffit : il identifie votre compte et vous connecte. Aucun mot de passe à retenir.'
              : `Un code à 6 chiffres a été envoyé au ${phone ? formatCivPhone(phone) : 'numéro saisi'}. Il reste valable 10 minutes.`}
          </p>
        </div>

        <ul className="flex flex-col gap-3 text-sm text-gray-400">
          {['Vos relevés CIE et SODECI au même endroit', 'Vos données restent privées', 'Aucun mot de passe à retenir'].map(
            (item) => (
              <li key={item} className="flex items-center gap-2">
                <CheckCircle2 size={15} className="shrink-0 text-emerald-400" aria-hidden />
                {item}
              </li>
            ),
          )}
        </ul>
      </div>
      {/* Colonne formulaire */}
      <div className="flex flex-1 items-center justify-center px-4 py-10 sm:px-8 lg:py-16">
        <div className="w-full max-w-sm">
          {/* Indicateur d'étape : l'utilisateur sait toujours où il en est. */}
          <ol className="mb-8 flex items-center gap-2" aria-label="Progression">
            {(['phone', 'code'] as const).map((s, i) => {
              const done = step === 'code' && s === 'phone';
              const active = step === s;
              return (
                <li key={s} className="flex flex-1 items-center gap-2">
                  <span
                    className={cn(
                      'grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-medium transition-colors',
                      done
                        ? 'bg-emerald-600 text-white'
                        : active
                          ? 'bg-gray-900 text-white'
                          : 'bg-gray-200 text-gray-500',
                    )}
                    aria-current={active ? 'step' : undefined}
                  >
                    {done ? <CheckCircle2 size={14} aria-hidden /> : i + 1}
                  </span>
                  <span className={cn('text-xs', active ? 'font-medium text-gray-900' : 'text-gray-500')}>
                    {s === 'phone' ? 'Numéro' : 'Code'}
                  </span>
                  {i === 0 && <span aria-hidden className="ml-auto h-px flex-1 bg-gray-200" />}
                </li>
              );
            })}
          </ol>

          {step === 'phone' ? (
            <form action={otpAction} className="flex flex-col gap-5" noValidate>
              <div className="flex flex-col gap-2">
                <label htmlFor="phone" className="text-sm font-medium">
                  Numéro de téléphone
                </label>
                <div className="relative">
                  <Phone
                    size={17}
                    aria-hidden
                    className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-gray-400"
                  />
                  <input
                    id="phone"
                    ref={phoneRef}
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    value={phoneInput}
                    onChange={(e) => setPhoneInput(e.target.value)}
                    onBlur={() => setTouched(true)}
                    aria-invalid={phoneError ? true : undefined}
                    aria-describedby={phoneError ? 'phone-error' : 'phone-help'}
                    placeholder="07 00 00 00 00"
                    className={cn(
                      'w-full rounded-xl border bg-white py-3 pr-4 pl-11 text-sm outline-none transition-colors placeholder:text-gray-400',
                      phoneError ? 'border-red-400' : 'border-gray-200 focus:border-gray-900',
                    )}
                  />
                </div>
                {phoneError ? (
                  <p id="phone-error" role="alert" className="text-sm text-red-600">
                    {phoneError}
                  </p>
                ) : (
                  <p id="phone-help" className="text-xs text-gray-500">
                    Numéro ivoirien. Le compte est créé automatiquement.
                  </p>
                )}
              </div>

              {/* La valeur normalisée part au serveur : la validation reste la
                  règle de vérité du serveur, jamais une copie côté client. */}
              <input type="hidden" name="phone" value={phone ?? ''} />

              <SubmitButton disabled={!phoneReady} pending={otpPending}>
                {otpPending ? 'Envoi…' : 'Recevoir un code'}
              </SubmitButton>

              {/* Erreur du serveur (rate limit, SMS en échec) : elle doit être
                  visible, sinon l'utilisateur croit que le bouton n'a rien fait. */}
              {otpError && (
                <p role="alert" className="text-center text-sm text-red-600">
                  {otpError}
                </p>
              )}

              <p className="text-xs leading-5 text-gray-500">
                ConsoCI ne présente jamais une estimation comme une facture officielle.
              </p>
            </form>
          ) : (
            <form action={sessionAction} className="flex flex-col gap-5" noValidate>
              <div className="flex flex-col gap-2">
                <label htmlFor="code" className="text-sm font-medium">
                  Code à 6 chiffres
                </label>
                <input
                  id="code"
                  ref={codeRef}
                  name="code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3.5 text-center text-lg font-semibold tracking-[0.5em] outline-none transition-colors placeholder:text-gray-300 focus:border-gray-900"
                />
                {devCode && (
                  <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-800">
                    <KeyRound size={14} className="mt-0.5 shrink-0" aria-hidden />
                    <span>
                      Mode développement : votre code est <b className="font-semibold">{devCode}</b>
                    </span>
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <label htmlFor="firstName" className="text-sm font-medium">
                  Prénom <span className="font-normal text-gray-500">(facultatif)</span>
                </label>
                <input
                  id="firstName"
                  name="firstName"
                  type="text"
                  autoComplete="given-name"
                  maxLength={60}
                  placeholder="Dominique"
                  className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none transition-colors placeholder:text-gray-400 focus:border-gray-900"
                />
              </div>

              <input type="hidden" name="phone" value={phone ?? ''} />

              <SubmitButton disabled={code.length !== 6} pending={sessionPending}>
                {sessionPending ? 'Vérification…' : 'Se connecter'}
              </SubmitButton>

              {/* Erreur du serveur : rôle « alert » pour être annoncée (§43). */}
              {sessionMessage && (
                <p role="alert" className="text-center text-sm text-red-600">
                  {sessionMessage}
                </p>
              )}

              <div className="flex items-center justify-between gap-3 border-t border-gray-200 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setStep('phone');
                    setCode('');
                  }}
                  className="inline-flex items-center gap-1.5 text-sm text-gray-600 underline-offset-2 hover:underline"
                >
                  <ArrowLeft size={14} aria-hidden />
                  Modifier le numéro
                </button>

                {/* Renvoi : le compte à rebours évite d'épuiser le quota de
                    3 demandes par heure sans le dire à l'utilisateur (§40).

                    ⚠ Pas de <form> imbriqué ici : le HTML l'interdit et cela
                    provoque une erreur d'hydratation. `formAction` fait soumettre
                    ce bouton via `otpAction` tout en restant dans le formulaire
                    de session, qui fournit déjà le champ `phone` caché. */}
                <button
                  type="submit"
                  formAction={otpAction}
                  disabled={resendIn > 0 || otpPending}
                  className="inline-flex items-center gap-1.5 text-sm text-gray-600 underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:text-gray-400 disabled:no-underline"
                >
                  <MessageSquare size={14} aria-hidden />
                  {resendIn > 0 ? `Renvoyer (${resendIn}s)` : 'Renvoyer le code'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Bouton d'envoi avec état d'attente : le libellé reste lisible même quand
 * l'icône tourne, pour que la personne sache ce qui est en cours.
 */
function SubmitButton({
  children,
  pending,
  disabled,
}: {
  children: React.ReactNode;
  pending: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="inline-flex items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 py-3 text-sm font-medium text-white shadow-sm transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending && <Loader2 size={15} className="animate-spin" aria-hidden />}
      {children}
    </button>
  );
}