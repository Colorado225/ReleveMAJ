/**
 * Envoi du code OTP (flow.md §40).
 *
 * Deux transports sont gérés :
 *  - `SMS_PROVIDER_URL` + `SMS_PROVIDER_TOKEN` : API HTTP (ex. Africa's Talking,
 *    Twilio, ORANGE API). Si absents, le code n'est PAS envoyé et l'appelant
 *    doit le signaler clairement plutôt que de mentir à l'utilisateur.
 *  - développement : le code est renvoyé pour la démonstration.
 *
 * Le secret du fournisseur ne transite jamais vers le client.
 */
export type OtpDelivery = { sent: boolean; devCode?: string; reason?: string };

export async function deliverOtp(phone: string, code: string): Promise<OtpDelivery> {
  const url = process.env.SMS_PROVIDER_URL;
  const token = process.env.SMS_PROVIDER_TOKEN;

  if (!url || !token) {
    if (process.env.NODE_ENV !== 'production') return { sent: false, devCode: code };
    return { sent: false, reason: 'provider_not_configured' };
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ to: phone, message: `Votre code ConsoCI : ${code}` }),
      // le transport ne doit pas faire tomber la requête utilisateur
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok ? { sent: true } : { sent: false, reason: `provider_status_${res.status}` };
  } catch {
    return { sent: false, reason: 'provider_unreachable' };
  }
}