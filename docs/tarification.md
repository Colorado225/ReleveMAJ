# Tarification et règles métier V1

## CIE

Le site CIE publie notamment le tarif domestique social monophasé 5A : prime fixe bimestrielle 614,90 FCFA TTC, 31,72 FCFA/kWh jusqu'à 80 kWh/bimestre et 65,11 FCFA/kWh au-delà, plus les taxes/redevances affichées par la CIE.

Le tarif domestique général monophasé 5A publie une prime fixe bimestrielle de 1 618,04 FCFA TTC et une première tranche à 86,92 FCFA/kWh jusqu'au seuil de 180×P souscrite par bimestre, puis 75,34 FCFA/kWh.

ANARE précise qu'il n'existe pas de tarif spécial pour le prépaiement : la grille en vigueur des compteurs ordinaires est appliquée au prépayé.

## Produit

Une valeur affichée par un compteur CIE ne doit pas être interprétée automatiquement comme un index kWh. Elle doit être qualifiée comme `CREDIT`, `ENERGY_AVAILABLE`, `INDEX` ou `UNKNOWN`.

Pour l'électricité prépayée, le produit distingue :
- montant effectivement payé ;
- kWh effectivement crédités quand disponibles ;
- kWh estimés quand seuls les FCFA sont connus ;
- niveau de confiance.

Pour l'eau, `index actuel - index précédent = m³ consommés`. Une facture SODECI saisie par l'utilisateur reste la référence financière ; l'app calcule alors un coût effectif par m³ sans le présenter comme le tarif réglementaire.
