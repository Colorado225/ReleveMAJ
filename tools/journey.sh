#!/bin/bash
# Parcours utilisateur défini par flow.md §60, exécuté dans l'interface réelle :
#   compte -> logement -> CIE -> SODECI -> relevé -> recharge -> tableau de bord
#   -> compréhension -> projection
#
# Le serveur tourne en build de PRODUCTION, avec un faux fournisseur SMS.
set -u
ROOT=/Users/melvyn/projetSass/CIE_SODECIE
PORT=3320
# format attendu par la validation : +225 puis 10 chiffres (§52)
DIGITS=$(printf '%08d' $(( (RANDOM + $(date +%s)) % 90000000 + 10000000 )))
PHONE="+22507${DIGITS}"
echo "numéro de test : $PHONE"
export AGENT_BROWSER_SESSION="journey-$$"

rm -f /tmp/sms-stub.log

# un ancien faux fournisseur peut encore occuper le port : il servirait avec
# l'ancienne regex et écrirait un mauvais code.
pkill -f 'sms-stub' 2>/dev/null
sleep 1

# 1. faux fournisseur SMS
node "$ROOT/tools/sms-stub.mjs" > /tmp/sms-stub-server.log 2>&1 &
SMS=$!
sleep 1

# 2. application en production
cd "$ROOT/apps/web"
SMS_PROVIDER_URL="http://localhost:4000/send" \
SMS_PROVIDER_TOKEN="jeton-de-test" \
  npx next start -p $PORT > /tmp/journey-server.log 2>&1 &
APP=$!

cleanup() {
  kill $APP $SMS 2>/dev/null
  agent-browser close >/dev/null 2>&1
}
trap cleanup EXIT

for i in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT/accueil" || true)
  [ "$code" = "200" ] && break
  sleep 1
done
echo "serveur: ${code:-injoignable}"
[ "${code:-}" = "200" ] || { tail -5 /tmp/journey-server.log; exit 1; }

step() { echo; echo "=== $1 ==="; }

# trouve la ref d'un élément à partir de son libellé dans le snapshot
ref_of() { agent-browser snapshot -i 2>&1 | grep -m1 "$1" | sed 's/.*ref=//;s/\].*//'; }

fill()  { agent-browser fill "@$(ref_of "$2")" "$3" >/dev/null 2>&1; sleep 0.4; }
press() { agent-browser click "@$(ref_of "$2")" >/dev/null 2>&1; sleep "${3:-2.5}"; }

step "1. Créer son compte"
agent-browser open "http://localhost:$PORT/accueil" >/dev/null 2>&1
sleep 3
press "Commencer" "Commencer" 3
echo -n "sur /connexion ? "
agent-browser eval "location.pathname" 2>&1 | tail -1

fill "Numéro de téléphone" "Numéro de téléphone" "$PHONE"
press "Recevoir un code" "Recevoir un code" 4
CODE=$(tail -1 /tmp/sms-stub.log 2>/dev/null)
echo "code reçu du fournisseur SMS : ${CODE:-AUCUN}"

if [ -z "${CODE:-}" ]; then
  echo "ECHEC : aucun SMS recu. Contenu de la page :"
  agent-browser eval "document.body.innerText.replace(/\s+/g,' ').slice(0,240)" 2>&1 | tail -1
  exit 1
fi

fill "Code à 6 chiffres" "Code à 6 chiffres" "$CODE"
press "Se connecter" "Se connecter" 7
echo -n "connecte ? chemin = "
agent-browser eval "location.pathname" 2>&1 | tail -1
agent-browser eval "document.body.innerText.replace(/\s+/g,' ').slice(0,160)" 2>&1 | tail -1

step "2. Créer son logement"
press "Profil" "Profil" 4
fill "Nom" "Nom" "Villa Yopougon"
agent-browser eval "
(() => {
  const i = document.querySelector('input[name=name]');
  i.form.requestSubmit();
  return 'envoi';
})()" >/dev/null 2>&1
sleep 4
agent-browser eval "document.body.innerText.includes('Villa Yopougon')" 2>&1 | tail -1

step "3. Ajouter un compteur CIE"
agent-browser eval "
(() => {
  const f = [...document.querySelectorAll('form')].find(x => x.querySelector('select[name=provider]'));
  const s = f.querySelector('select[name=provider]');
  s.value = 'CIE'; s.dispatchEvent(new Event('change',{bubbles:true}));
  const u = f.querySelector('select[name=utilityType]');
  u.value = 'ELECTRICITY'; u.dispatchEvent(new Event('change',{bubbles:true}));
  const m = f.querySelector('select[name=paymentMode]');
  m.value = 'PREPAID'; m.dispatchEvent(new Event('change',{bubbles:true}));
  const p = f.querySelector('input[name=subscribedPower]');
  if (p) { p.value = '5'; p.dispatchEvent(new Event('change',{bubbles:true})); }
  f.requestSubmit();
  return 'envoi CIE';
})()" >/dev/null 2>&1
sleep 5
agent-browser eval "document.body.innerText.includes('Prépayé')" 2>&1 | tail -1

step "4. Ajouter un compteur SODECI"
agent-browser eval "
(() => {
  const f = [...document.querySelectorAll('form')].find(x => x.querySelector('select[name=provider]'));
  const s = f.querySelector('select[name=provider]');
  s.value = 'SODECI'; s.dispatchEvent(new Event('change',{bubbles:true}));
  const u = f.querySelector('select[name=utilityType]');
  u.value = 'WATER'; u.dispatchEvent(new Event('change',{bubbles:true}));
  f.requestSubmit();
  return 'envoi SODECI';
})()" >/dev/null 2>&1
sleep 4
agent-browser eval "document.body.innerText.includes('SODECI')" 2>&1 | tail -1

step "5. Saisir son premier relevé d'eau (index 124,3)"
agent-browser open "http://localhost:$PORT/ajouter" >/dev/null 2>&1
sleep 3
agent-browser eval "
(() => {
  const f = [...document.querySelectorAll('form')].find(x => x.querySelector('select[name=meterId]') && x.querySelector('input[name=value]'));
  if (!f) return 'formulaire de releve introuvable';
  const sel = f.querySelector('select[name=meterId]');
  const eau = [...sel.options].find(o => o.textContent.includes('Eau')) || sel.options[0];
  sel.value = eau.value; sel.dispatchEvent(new Event('change',{bubbles:true}));
  f.querySelector('input[name=value]').value = '124.3';
  f.requestSubmit();
  return 'releve 124.3 envoye';
})()" >/dev/null 2>&1
sleep 5
agent-browser eval "document.body.innerText.includes('124.3')" 2>&1 | tail -1

step "6. Enregistrer une recharge CIE de 10 000 FCFA"
agent-browser eval "
(() => {
  const f = [...document.querySelectorAll('form')].find(x => x.querySelector('input[name=amountPaid]'));
  if (!f) return 'formulaire de recharge introuvable';
  const sel = f.querySelector('select[name=meterId]');
  sel.selectedIndex = 0;
  sel.dispatchEvent(new Event('change',{bubbles:true}));
  f.querySelector('input[name=amountPaid]').value = '10000';
  f.requestSubmit();
  return 'recharge envoyee';
})()" >/dev/null 2>&1
sleep 6
agent-browser eval "document.body.innerText.replace(/\s+/g,' ').slice(0,150)" 2>&1 | tail -1

step "7. Voir son tableau de bord et sa projection"
agent-browser open "http://localhost:$PORT/" >/dev/null 2>&1
sleep 4
agent-browser eval "
(() => {
  // les nombres français utilisent une espace insécable fine : on normalise
  const t = document.body.innerText.replace(/[\u00a0\u202f\u2009]/g, ' ').replace(/\s+/g, ' ');
  return JSON.stringify({
    depense10k: /10 000 FCFA/.test(t),
    kwh: /kWh/.test(t),
    projection: /Projection/.test(t),
    conseil: /Vérifiez|Ajoutez|Enregistrez|Continuez/.test(t),
    carteEau: /m³/.test(t),
  });
})()" 2>&1 | tail -1

step "8. Deuxième relevé d'eau : consommation calculée"
agent-browser open "http://localhost:$PORT/ajouter" >/dev/null 2>&1
sleep 3
agent-browser eval "
(() => {
  const f = [...document.querySelectorAll('form')].find(x => x.querySelector('select[name=meterId]') && x.querySelector('input[name=value]'));
  const sel = f.querySelector('select[name=meterId]');
  const eau = [...sel.options].find(o => o.textContent.includes('Eau')) || sel.options[0];
  sel.value = eau.value; sel.dispatchEvent(new Event('change',{bubbles:true}));
  f.querySelector('input[name=value]').value = '139.8';
  f.requestSubmit();
  return 'releve 139.8 envoye';
})()" >/dev/null 2>&1
sleep 5
agent-browser open "http://localhost:$PORT/historique" >/dev/null 2>&1
sleep 4
agent-browser eval "
(() => {
  const t = document.body.innerText;
  return JSON.stringify({
    differenceCalculee: /15\.5/.test(t),
    consommation: /m³/.test(t),
  });
})()" 2>&1 | tail -1

agent-browser screenshot /tmp/journey-final.png >/dev/null 2>&1
echo; echo "parcours termine"