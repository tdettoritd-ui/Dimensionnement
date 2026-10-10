# Relevé PAC / Clim — dimensionnement

Application web (PWA) pour réaliser un relevé technique chez un client et obtenir **instantanément** le dimensionnement chauffage / climatisation, le radiateur préconisé par pièce, la vérification des radiateurs existants et la catégorie Anah / MaPrimeRénov'.

- Recalcul en direct à chaque saisie, sans bouton « calculer ».
- Fonctionne **hors ligne** une fois chargée (service worker) et s'installe sur l'écran d'accueil (« Ajouter à l'écran d'accueil »).
- **Aucune donnée envoyée à un serveur** : calcul et stockage (localStorage) restent sur l'appareil.
- Mobile-first, thèmes clair / sombre / automatique.
- **PDF** généré directement sur l'appareil (logo et coordonnées de l'entreprise, synthèse, détail par pièce).
- **Envoi par email** : partage du PDF via le menu du téléphone (Mail, Gmail, Outlook…), ou email pré-rempli dans la messagerie (destinataire, objet, synthèse).
- **Mon entreprise** (icône immeuble en haut) : logo, coordonnées, technicien — repris dans le PDF et l'email.
- **Vitrages** : saisie détaillée fenêtre par fenêtre, ou rapide (peu / moyennement / très vitré).

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
| `js/format.js` | Mise en forme partagée (nombres, libellés, descriptions) |
| `js/entreprise.js` | « Mon entreprise » : logo, coordonnées |
| `js/rapport.js` | Génération du PDF |
| `js/envoi.js` | Envoi par email (partage / messagerie) |
| `js/app.js` | Rendu, saisie, chantiers sauvegardés, barre d'actions, thème |
| `css/styles.css` | Styles (clair/sombre) |
| `vendor/` | jsPDF 4.2.1 et jspdf-autotable 5.0.8 (licence MIT, voir `vendor/LICENSES.txt`) |
| `logo.png`, `logo-embleme.png`, `icon-*.png` | Logo C&H Énergie (PDF, en-tête, icône) — source : `assets/logo-source.png` |
| `sw.js` | Cache hors ligne — **incrémenter `VERSION` à chaque mise à jour des fichiers** |
| `tests/calc.test.js` | Tests du moteur de calcul |

## Méthode de calcul

Par pièce :

- `S = L × l` ; `Smur = max(linéaire ext. × H − Σ vitrages, 0)`
- `U paroi = 1 / (R base + épaisseur(m) / λ)` ; toiture : U = 0 si la pièce n'est pas sous toiture ou si « Aucune » ; plancher : U = 0 si la pièce n'est pas sur plancher bas (étage) ou si « Aucun »
- U vitrage = U du type − 0,2 si volet roulant, minimum 0,5 W/m².K
- `G = U mur·Smur + U toit·S + U plancher·S + Σ U vitrage·surface + ponts thermiques + 0,34·débit`
- Chauffage = `max(G × (T confort hiver − T base hiver), 0) × (1 + surpuissance de relance %)` (10 % par défaut, réglable dans « Climat »)
- Climatisation = apports solaires (surface × g × rayonnement) + transmission `(U mur·Smur + U toit·S) × écart été` + ventilation `0,34·débit·écart été` + internes (occupants × W/activité + équipements)

Totaux : somme des pièces ; palier PAC/clim = plus petit palier ≥ total (au-delà de 28 kW : étude multi-splits).

**Ponts thermiques** (3CL-DPE 2021, annexe 1 § 3.4 ; valeurs ψ de la table `PONTS_THERMIQUES` de `js/data.js`) : `Σ ψ × longueur` par pièce, ψ selon l'isolation des murs (non isolés ; par l'intérieur ITI ; par l'extérieur ITE ; isolation répartie pour monomur, béton cellulaire et ossature bois) et selon que le plancher ou la toiture sont isolés. Longueurs déduites de la pièce :
- plancher bas / mur = linéaire L (plancher lourd seulement : pas pour plancher bois ni ossature bois) ;
- plancher haut / mur = L si la toiture est lourde (terrasse, combles sur dalle béton / hourdis) ; combles bois : 0 ;
- plancher intermédiaire / mur = 0,5 × L par face d'étage (sol d'une pièce d'étage, plafond d'une pièce sous un étage) ; 0 si les planchers d'étage sont en bois ;
- refend / mur = 0,25 × H par pièce ayant des murs extérieurs ;
- menuiserie / mur = Σ 4√S par baie (saisie rapide : max(4√S ; 3 × S)), pose au nu intérieur.
En ITI, les planchers d'étage et les refends dominent ; en ITE, ce sont le plancher bas et les tableaux de fenêtres.

**Radiateurs et régime d'eau** : les puissances catalogue (radiateurs neufs et tables des radiateurs existants) sont données à ΔT50, c'est-à-dire pour une eau à 75/65 °C et 20 °C ambiant. Le régime d'eau choisi dans « Installation » (55/45 °C par défaut) les corrige selon la loi EN 442 : `P = P50 × (ΔTlm / ΔTlm 75/65/20)^1,3`, soit environ ×0,87 en 70/60, ×0,51 en 55/45, ×0,40 en 50/40 et ×0,30 en 45/35. Radiateur existant « Suffisant » si sa puissance au régime choisi ≥ 95 % du besoin ; radiateur neuf = plus petit palier catalogue dont la puissance au régime choisi couvre le besoin (au-delà de 3 000 W catalogue : plusieurs émetteurs).

**Saisie rapide des vitrages** : surface vitrée = pourcentage de la surface au sol de la pièce selon le niveau (table `NIVEAUX_VITRAGE` de `js/data.js`), avec une orientation principale, un type de vitrage et la présence de volets. L'orientation « Plusieurs orientations » utilise la moyenne des rayonnements de la table.

**Débit de ventilation** : le bouton « Estimer » remplit `volume × taux` du type de ventilation. Si le champ est laissé vide, cette estimation est utilisée automatiquement (affichée en grisé) pour ne pas oublier le poste renouvellement d'air.

## Révision des tables (octobre 2026)

Les tables de `js/data.js` ont été contrôlées et corrigées à partir des tables réglementaires 3CL-DPE 2021 (arrêté du 31/03/2021, transcription Open3CL), de la NF EN 12831 (températures de base, coefficients de réduction), de la méthode résidentielle ASHRAE (apports solaires de pointe) recoupée par un calcul d'ensoleillement par ciel clair, et de catalogues de radiateurs. Chaque correction a été contre-vérifiée ; en cas de doute, la valeur d'origine a été conservée.

| Table | Entrée | Avant | Après | Raison |
|---|---|---|---|---|
| Zones | H1 | -7 °C | **-10 °C** | Températures de base de la zone H1 en plaine (Lille -9, Lyon -10 ; 3CL -9,5) |
| Zones | H3 | 0 °C | **-5 °C** | Aucune base à 0 °C en métropole (Marseille, Montpellier -5 ; Corse -2) |
| Murs | Parpaing / béton banché | R 0,30 | **0,40** | R doit inclure Rsi + Rse ; U0 3CL plafonné à 2,5 |
| Murs | Mâchefer | R 0,65 | **0,42** | Table 3CL béton de mâchefer, 25 cm |
| Murs | Brique monomur (nouvelle entrée) | — | **2,1** | Brique alvéolaire 30 cm (3CL) ; séparée de la brique creuse (0,55) |
| Murs | Béton cellulaire | R 0,70 | **1,43** | 0,70 était un U saisi à la place d'un R (3CL : U 0,70 pour 20 cm) |
| Toiture | Combles / rampants | R 0,20 | **0,40** | U0 plafond 3CL = 2,5 |
| Toiture | Terrasse béton | R 0,17 | **0,35** | Dalle + étanchéité + Rsi/Rse |
| Plancher | Dalle sur terre-plein | R 0,35 | **2,0** | R équivalent sol (Ue 3CL / ISO 13370) : le calcul applique le ΔT extérieur complet |
| Plancher | Dalle mâchefer sur terre-plein | R 0,55 | **2,1** | Idem |
| Plancher | Bois / vide sanitaire | R 0,50 | **0,8** | R0 / b, b ≈ 0,8 (vide sanitaire ventilé, EN 12831) |
| Plancher | Sur cave non chauffée | R 0,45 | **0,8** | R0 / b, b ≈ 0,6 (cave avec soupiraux, EN 12831) |
| Ventilation | Pas de VMC | 0,3 vol/h | **0,5 vol/h** | Maisons sans VMC (fenêtres, infiltrations) |
| Vitrages | Simple / double / argon / triple | g 0,85 / 0,60 / 0,55 / 0,50 | **0,60 / 0,52 / 0,45 / 0,40** | g de la fenêtre entière (Sw 3CL), la surface saisie étant la baie |
| Vitrages | Argon / triple | U 1,3 / 0,8 | **1,4 / 1,0** | Uw 3CL d'une fenêtre (menuiserie comprise), pas Ug du verre |
| Orientations | S / SE / SO / E / O / NE / NO / N | 150 / 180 / 180 / 130 / 130 / 70 / 70 / 60 | **250 / 240 / 370 / 220 / 390 / 110 / 240 / 70** | Pointe d'été (ASHRAE) : l'Ouest et le Sud-Ouest sont les façades les plus chargées |
| Radiateurs acier | Type 20 | 1550 W/m² | **1700** | Catalogues Kermi / Purmo (ΔT50) |
| Toiture | Combles perdus sur dalle béton / hourdis (nouvelle entrée) | — | **R 0,40** + pont thermique plancher haut | Fréquent dans les pavillons 1950-1980 (Uph0 3CL 2,5) |

Inchangés après contrôle : Sarreguemines -15 °C, H2 -5 °C, températures de confort et base été, pierre, brique creuse, ossature bois, isolants, VMC, apports internes, radiateurs acier (autres types), fonte, aluminium, plafonds Anah 2026 (36 valeurs confirmées).

Impact sur une maison de 100 m² à Sarreguemines (parpaing + PSE 4 cm, combles 10 cm, dalle sur terre-plein, double vitrage ancien) : chauffage 16,7 → 8,2 kW, climatisation 3,5 → 4,5 kW.

## Points d'attention

- Les puissances de radiateurs existants (acier, fonte, aluminium) sont des **ordres de grandeur ΔT50**, pas des données constructeur certifiées.
- Les plafonds Anah sont ceux de **2026** (`js/data.js`, objet `ANAH`) : à recontrôler et mettre à jour en début d'année civile.
- « Nouveau relevé » réinitialise client, installation, prime et pièces, mais conserve les réglages climat / enveloppe.
- **Email** : sans serveur, l'application ne peut pas expédier le message elle-même. « Partager le PDF » (téléphones) joint le PDF dans la messagerie choisie ; l'adresse du client est copiée pour être collée dans « À ». « Ouvrir ma messagerie » prépare l'email ; sur ordinateur, le PDF est téléchargé pour être joint.
- **Changer le logo** : remplacer `logo.png` / `logo-embleme.png` (ou choisir une image dans « Mon entreprise », stockée sur l'appareil).
- Le relevé en cours est conservé automatiquement (brouillon) même sans sauvegarde explicite ; « Sauver » l'ajoute à « Mes chantiers ».
