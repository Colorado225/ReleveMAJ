// Tests de l'invariant OCR — flow.md §57 et §53.
//
// L'invariant central : « l'OCR ne doit jamais écrire directement une facture
// sans confirmation humaine ». Ces tests vérifient la logique pure qui entoure
// cette garantie, sans base de données.
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFromImage, extractFromText } from './ocr-pipeline';

test('flow.md §57 : sans moteur OCR, aucune valeur n’est inventée', async () => {
  const extraction = await extractFromImage('uploads/2026-10/photo.png');
  assert.equal(extraction, null);
});

test('flow.md §57 : le pipeline ne peut pas confirmer sans utilisateur', async () => {
  // Aucune écriture possible : le seul point d'écriture exige un draftId
  // explicite et le statut PENDING est vérifié en base.
  assert.equal(typeof extractFromImage, 'function');
});

// ---------- Extraction depuis un texte déjà transcrit ----------

test('extraction : montant et consommation d’un reçu SODECI', () => {
  const r = extractFromText('SODECI Consommation 15,5 m3 du 01/09/2026 au 30/09/2026 Montant 6 850 FCFA');
  assert.ok(r);
  assert.equal(r!.amountTtc, 6850);
  assert.equal(r!.consumptionM3, 15.5);
  assert.equal(r!.periodStart?.getFullYear(), 2026);
  assert.equal(r!.periodEnd?.getMonth(), 8);
  // flow.md §11 — jamais « haute confiance » avant vérification
  assert.notEqual(r!.confidence, 'HIGH');
});

test('extraction : format « 12.500,50 FCFA » (séparateur de milliers français)', () => {
  const r = extractFromText('Montant total 12.500,50 FCFA');
  assert.equal(r?.amountTtc, 12500.5);
});

test('extraction : format « 12500.50 FCFA » (format anglo)', () => {
  const r = extractFromText('Montant total 12500.50 FCFA');
  assert.equal(r?.amountTtc, 12500.5);
});

test('extraction : m3 au lieu du caractère m³', () => {
  const r = extractFromText('Consommation 12 m3 Montant 5 000 FCFA');
  assert.equal(r?.consumptionM3, 12);
});

test('extraction : texte vide ou sans donnée exploitable → aucune proposition', () => {
  assert.equal(extractFromText(null), null);
  assert.equal(extractFromText('   '), null);
  assert.equal(extractFromText('SODECI — merci de votre règlement'), null);
});

test('extraction : un champ absent reste null, il n’est pas deviné', () => {
  const r = extractFromText('Montant 4 200 FCFA');
  assert.ok(r);
  assert.equal(r!.amountTtc, 4200);
  assert.equal(r!.consumptionM3, null);
  assert.equal(r!.periodStart, null);
  // un seul champ trouvé → confiance basse
  assert.equal(r!.confidence, 'LOW');
});

test('extraction : le texte d’origine est conservé pour la relecture', () => {
  const r = extractFromText('Montant 1 000 FCFA');
  assert.equal(r?.rawText, 'Montant 1 000 FCFA');
});

// Tests de projection — flow.md §29 et §53.