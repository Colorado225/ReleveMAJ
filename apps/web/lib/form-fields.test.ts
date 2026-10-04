import React from 'react';
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { RadioField, SelectField } from '../components/form-fields';

/**
 * Invariant critique : les widgets Radix (`Select`, `RadioGroup`) tiennent leur
 * état dans React et ne produisent RIEN dans un `<form>` HTML.
 *
 * Toutes les Server Actions du projet lisent des `FormData` natifs
 * (`formData.get('provider')`, `formData.get('readingType')`…). Si `SelectField`
 * / `RadioField` cessaient de répliquer leur valeur dans un `<input hidden>`,
 * le serveur recevrait `null`, la validation Zod échouerait, et l'utilisateur
 * verrait « Données invalides » sur un formulaire qu'il vient de remplir
 * correctement.
 *
 * Ce test verrouille ce contrat. Il échoue avant toute régression.
 */

/** Extrait les couples (name, value) des `<input type="hidden">` rendus. */
function hiddenFields(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/g)) {
    out[m[1]] = m[2];
  }
  return out;
}

test('SelectField : la valeur choisie est bien transmise au FormData', () => {
  const html = renderToStaticMarkup(
    React.createElement(
      'form',
      null,
      React.createElement(SelectField, {
        name: 'provider',
        label: 'Fournisseur',
        defaultValue: 'SODECI',
        options: [
          { value: 'CIE', label: 'CIE — électricité' },
          { value: 'SODECI', label: 'SODECI — eau' },
        ],
      }),
    ),
  );

  assert.deepEqual(hiddenFields(html), { provider: 'SODECI' });
});

test('SelectField : sans defaultValue, la première option est retenue', () => {
  const html = renderToStaticMarkup(
    React.createElement(
      'form',
      null,
      React.createElement(SelectField, {
        name: 'utilityType',
        label: 'Type',
        options: [
          { value: 'ELECTRICITY', label: 'Électricité' },
          { value: 'WATER', label: 'Eau' },
        ],
      }),
    ),
  );

  // Une liste déroulante HTML affiche la première option : le comportement doit
  // être identique, sinon l'utilisateur verrait « Vider » à l'écran et le
  // serveur recevrait autre chose.
  assert.deepEqual(hiddenFields(html), { utilityType: 'ELECTRICITY' });
});

test('RadioField : le type de valeur choisi est bien transmis (flow.md §10)', () => {
  const html = renderToStaticMarkup(
    React.createElement(
      'form',
      null,
      React.createElement(RadioField, {
        name: 'readingType',
        legend: 'Que représente cette valeur ?',
        defaultValue: 'CREDIT',
        options: [
          { value: 'INDEX', label: 'Index de consommation' },
          { value: 'CREDIT', label: 'Crédit disponible' },
        ],
      }),
    ),
  );

  assert.deepEqual(hiddenFields(html), { readingType: 'CREDIT' });
});

test('SelectField et RadioField : le libellé est rattaché au contrôle', () => {
  // Sans association label/contrôle, un lecteur d'écran annonce « liste
  // déroulante » sans dire de quoi elle parle (flow.md §43).
  const html = renderToStaticMarkup(
    React.createElement(
      'form',
      null,
      React.createElement(SelectField, {
        name: 'paymentMode',
        label: 'Mode de paiement',
        options: [{ value: 'PREPAID', label: 'Prépayé' }],
      }),
    ),
  );

  assert.match(html, /for="paymentMode"/);
  assert.match(html, /id="paymentMode"/);
});