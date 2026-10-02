# Relevé PAC / Clim — dimensionnement

Application web (PWA) pour réaliser un relevé technique chez un client et obtenir **instantanément** le dimensionnement chauffage / climatisation, le radiateur préconisé par pièce, la vérification des radiateurs existants et la catégorie Anah / MaPrimeRénov'.

- Recalcul en direct à chaque saisie, sans bouton « calculer ».
- Fonctionne **hors ligne** une fois chargée (service worker) et s'installe sur l'écran d'accueil (« Ajouter à l'écran d'accueil »).
- **Aucune donnée envoyée à un serveur** : calcul et stockage (localStorage) restent sur l'appareil.
- Mobile-first, thèmes clair / sombre / automatique.
- Export PDF via l'impression du navigateur (« Enregistrer au format PDF ») avec une mise en page dédiée.

## Utilisation

Aucune dépendance ni compilation : ce sont des fichiers statiques.

```sh
npm start          # sert le dossier sur http://localhost:8080 (python3 -m http.server)
npm test           # tests unitaires du moteur de calcul (node --test)
```

Pour un usage terrain, héberger le dossier sur n'importe quel hébergement statique en HTTPS (GitHub Pages, Netlify…) : le mode hors ligne nécessite HTTPS (ou localhost). L'ouverture directe de `index.html` (file://) fonctionne aussi, sans le mode hors ligne.

## Structure

| Fichier | Rôle |
|---|---|
| `index.html` | Coquille de l'application, barre de totaux et d'actions |
| `js/data.js` | Tables de référence (parois, isolants, vitrages, paliers, radiateurs, plafonds Anah…) |
| `js/calc.js` | Moteur de calcul (fonctions pures, testées) |
| `js/app.js` | Rendu, saisie, chantiers sauvegardés, export PDF, thème |
| `css/styles.css` | Styles écran (clair/sombre) et impression |
| `sw.js` | Cache hors ligne — **incrémenter `VERSION` à chaque mise à jour des fichiers** |
| `tests/calc.test.js` | Tests du moteur de calcul |

## Méthode de calcul

Par pièce :

- `S = L × l` ; `Smur = max(linéaire ext. × H − Σ vitrages, 0)`
- `U paroi = 1 / (R base + épaisseur(m) / λ)` ; toiture : U = 0 si la pièce n'est pas sous toiture ou si « Aucune » ; plancher : U = 0 si « Aucun »
- U vitrage = U du type − 0,2 si volet roulant, minimum 0,5 W/m².K
- `G = U mur·Smur + U toit·S + U plancher·S + Σ U vitrage·surface + 0,34·débit`
- Chauffage = `max(G × (T confort hiver − T base hiver), 0)`
- Climatisation = apports solaires (surface × g × rayonnement) + transmission `(U mur·Smur + U toit·S) × écart été` + ventilation `0,34·débit·écart été` + internes (occupants × W/activité + équipements)

Totaux : somme des pièces ; palier PAC/clim = plus petit palier ≥ total (au-delà de 28 kW : étude multi-splits). Radiateur neuf : plus petit palier ≥ besoin de la pièce (au-delà de 3 000 W : plusieurs émetteurs). Radiateur existant « Suffisant » si sa puissance ≥ 95 % du besoin.

**Débit de ventilation** : le bouton « Estimer » remplit `volume × taux` du type de ventilation. Si le champ est laissé vide, cette estimation est utilisée automatiquement (affichée en grisé) pour ne pas oublier le poste renouvellement d'air.

## Points d'attention

- Les puissances de radiateurs existants (acier, fonte, aluminium) sont des **ordres de grandeur ΔT50**, pas des données constructeur certifiées.
- Les plafonds Anah sont ceux de **2026** (`js/data.js`, objet `ANAH`) : à recontrôler et mettre à jour en début d'année civile.
- « Nouveau relevé » réinitialise client, installation, prime et pièces, mais conserve les réglages climat / enveloppe.
- Le relevé en cours est conservé automatiquement (brouillon) même sans sauvegarde explicite ; « Sauver » l'ajoute à « Mes chantiers ».
