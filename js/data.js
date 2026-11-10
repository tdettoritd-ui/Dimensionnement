/*
 * Tables de référence du relevé chantier.
 * Les identifiants (id) sont stockés dans les chantiers sauvegardés : ne pas les renommer.
 */
(function (root) {
  'use strict';

  var ZONES = [
    { id: 'lorraine', label: 'Lorraine / Grand Est – Sarreguemines', t: -15 },
    { id: 'h1', label: 'H1 – Nord, Est, Centre-Est (plaine ; Île-de-France -5 à -7)', t: -10 },
    { id: 'h2', label: 'H2 – Centre-Ouest', t: -5 },
    { id: 'h3', label: 'H3 – Méditerranée (plaine ; Corse -2)', t: -5 }
  ];

  var GENERATIONS = [
    { id: 'gaz', label: 'Gaz' },
    { id: 'fioul', label: 'Fioul' },
    { id: 'electrique', label: 'Électrique' },
    { id: 'pac', label: 'Pompe à chaleur existante' },
    { id: 'bois', label: 'Bois / granulés' },
    { id: 'aucune', label: 'Aucune / inconnue' }
  ];

  // Résistance de base des murs (m².K/W, avant isolant rapporté), résistances superficielles
  // comprises (R = 1 / U0 des tables 3CL-DPE 2021). Révision octobre 2026 : voir README.
  // r : résistance du mur à l'épaisseur e (cm), résistances superficielles comprises (R_SURFACE_MUR).
  // Une autre épaisseur saisie donne r = R_SURFACE_MUR + épaisseur / λ, λ déduit de r et e.
  // Ossature bois : sans e, la résistance ne dépend pas de l'épaisseur saisie (isolant à part).
  var MURS = [
    { id: 'pierre', label: 'Pierre / brique pleine (ancien)', r: 0.40, e: 50, inertie: 'lourd' },
    { id: 'parpaing', label: 'Parpaing / béton banché', r: 0.40, e: 20, inertie: 'moyen' },
    { id: 'machefer', label: 'Mâchefer (parpaing / agglo)', r: 0.42, e: 20, inertie: 'moyen' },
    { id: 'brique_creuse', label: 'Brique creuse', r: 0.55, e: 20, inertie: 'moyen' },
    { id: 'monomur', label: 'Brique monomur / alvéolaire', r: 2.1, e: 30, itr: true, inertie: 'lourd' },
    { id: 'beton_cellulaire', label: 'Béton cellulaire', r: 1.43, e: 25, itr: true, inertie: 'lourd' },
    { id: 'ossature_bois', label: 'Ossature bois', r: 0.30, itr: true, bois: true, inertie: 'leger' }
  ];
  var R_SURFACE_MUR = 0.17; // m².K/W : Rsi + Rse d'un mur extérieur

  // Revêtement intérieur des murs : résistance ajoutée (m².K/W), sans isolant.
  var REVETEMENTS_MUR = [
    { id: 'aucun', label: 'Aucun / enduit ciment', r: 0 },
    { id: 'platre', label: 'Enduit plâtre (≈ 1,5 cm)', r: 0.03 },
    { id: 'ba13', label: 'BA13 (plaque de plâtre 12,5 mm)', r: 0.05 },
    { id: 'bois', label: 'Lambris bois (≈ 1,5 cm sur tasseaux)', r: 0.12 },
    { id: 'ytong', label: 'Contre-cloison Ytong / béton cellulaire (7 cm)', r: 0.58 },
    // Agglo creux 5 cm (≈ 0,06) + lame d'air non ventilée de 2 à 5 cm (≈ 0,16) + enduit.
    { id: 'agglo', label: 'Contre-cloison agglo (5 cm, avec lame d\'air)', r: 0.22 }
  ];

  // Été : écart de température équivalent des murs au soleil (ETD, K), tabulé pour 32 / 26 °C,
  // enduit de teinte moyenne, à l'heure de pointe de la maison (17-18 h), moyenne des façades
  // (conduction transitoire 1D, température sol-air du 21 juillet à Sarreguemines, ciel clair).
  var ETD_MURS = { lourd: 6, moyen_non_isole: 12, moyen_iti: 9, moyen_ite: 7, leger: 12 };

  // Résistance de base toiture (m².K/W) — r null : U = 0.
  // etd : écart équivalent d'été (K, pour 32 / 26 °C) : combles chauds (≈ 42 °C), rampants et terrasse
  // au soleil (Manual J 8, bilan des combles ventilés, conduction transitoire) ; leger : pièce légère.
  var TOITURES = [
    { id: 'combles', label: 'Combles perdus (plafond, structure bois)', r: 0.40, etd: 16 },
    { id: 'rampants', label: 'Combles aménagés / rampants (structure bois)', r: 0.40, etd: 25, leger: true },
    { id: 'combles_dalle', label: 'Combles perdus sur dalle béton / hourdis', r: 0.40, lourd: true, etd: 12 },
    { id: 'terrasse', label: 'Toiture terrasse (structure béton)', r: 0.35, lourd: true, etd: 8, etdNonIsole: 13 },
    { id: 'aucune', label: 'Aucune (étage intermédiaire)', r: null }
  ];

  // Résistance de base plancher bas (m².K/W) — r null : U = 0.
  // Valeurs « équivalentes » : le calcul applique l'écart de température extérieur complet, alors
  // que le sol (terre-plein) ou un local non chauffé (cave, vide sanitaire) est moins froid.
  // Terre-plein : 1 / Ue des tables 3CL ; cave et vide sanitaire : R0 / b (b ≈ 0,6-0,8, EN 12831).
  // Plancher bas = type de dalle + ce qu'il y a dessous.
  // r : résistance de la dalle, résistance superficielle intérieure comprise (m².K/W).
  var PLANCHERS_DALLE = [
    { id: 'beton', label: 'Béton', r: 0.25 },
    { id: 'bois', label: 'Bois', r: 0.45, leger: true },
    { id: 'machefer', label: 'Mâchefer', r: 0.35 }
  ];

  // Sous le plancher bas. Local non chauffé : U = b / (R dalle + R isolant + R_SE_LOCAL),
  // b = coefficient de réduction des températures (EN 12831, valeurs forfaitaires).
  // Terre-plein : la résistance du sol rSol remplace b (U ≈ 0,5 pour une dalle béton non isolée).
  // Cave chauffée : pas de déperdition par le plancher.
  var PLANCHERS_LOCAL = [
    { id: 'cave_enterree', label: 'Cave enterrée, sans fenêtre ni porte extérieure', b: 0.5 },
    { id: 'cave_semi', label: 'Cave semi-enterrée, avec soupiraux, fenêtres ou porte extérieure', b: 0.8 },
    { id: 'sous_sol_ventile', label: 'Sous-sol avec porte de garage, ou très ventilé', b: 0.9 },
    { id: 'vide_sanitaire', label: 'Vide sanitaire ventilé', b: 0.8 },
    { id: 'terre_plein', label: 'Terre-plein', rSol: 1.75 },
    { id: 'cave_chauffee', label: 'Sur cave chauffée', b: 0 }
  ];
  var R_SE_LOCAL = 0.17; // m².K/W : résistance superficielle côté local non chauffé

  // Relevés antérieurs : ancien choix unique du plancher bas → dalle + dessous.
  var PLANCHERS_ANCIENS = {
    dalle: ['beton', 'terre_plein'],
    dalle_machefer: ['machefer', 'terre_plein'],
    bois_vs: ['bois', 'vide_sanitaire'],
    cave: ['beton', 'cave_enterree'],
    aucun: ['beton', 'cave_chauffee']
  };

  // Position de l'isolant rapporté sur les murs : détermine les ponts thermiques.
  var POSITIONS_ISOLANT_MUR = [
    { id: 'interieur', label: 'Par l\'intérieur (ITI, doublage)' },
    { id: 'exterieur', label: 'Par l\'extérieur (ITE)' }
  ];

  // Planchers entre étages : un plancher bois n'a pas de pont thermique avec les murs.
  var PLANCHERS_ETAGE = [
    { id: 'lourd', label: 'Béton / hourdis' },
    { id: 'leger', label: 'Bois sur solives' }
  ];

  // Ponts thermiques ψ (W/m.K) : 3CL-DPE 2021, annexe 1 § 3.4 (table « pont_thermique », ids 1 à 137,
  // transcription Open3CL recoupée). Clé = isolation du mur : non isolé, ITI, ITE, ITR (isolation
  // répartie : monomur, béton cellulaire, ossature bois), ou ITI / ITE sur mur ITR.
  // plancherBas / plancherHaut : [plancher non isolé, plancher isolé]. Menuiseries posées au nu intérieur.
  var PONTS_THERMIQUES = {
    plancherBas: { non_isole: [0.39, 0.80], iti: [0.31, 0.71], ite: [0.49, 0.64], itr: [0.35, 0.45], iti_itr: [0.31, 0.45], ite_itr: [0.35, 0.45] },
    plancherHaut: { non_isole: [0.30, 0.40], iti: [0.27, 0.75], ite: [0.55, 0.58], itr: [0.40, 0.48], iti_itr: [0.27, 0.48], ite_itr: [0.40, 0.48] },
    plancherIntermediaire: { non_isole: 0.86, iti: 0.92, ite: 0.13, itr: 0.24, iti_itr: 0.24, ite_itr: 0.13 },
    refend: { non_isole: 0.73, iti: 0.82, ite: 0.13, itr: 0.20, iti_itr: 0.20, ite_itr: 0.13 },
    menuiserie: { non_isole: 0.38, iti: 0, ite: 0.25, itr: 0.20, iti_itr: 0, ite_itr: 0.20 },
    // Longueur de refend (mur intérieur lourd contre mur extérieur) comptée par pièce : 0,25 × hauteur
    // (moyenne observée sur 127 maisons, chaque jonction étant partagée entre deux pièces).
    refendParPiece: 0.25,
    // Saisie rapide des vitrages : périmètre des menuiseries ≈ 3 m par m² de baie (médiane des DPE).
    perimetreRapide: 3.0,
    // Mode global : refends comptés au prorata de la surface, comme une pièce de 14 m² (0,25 × H).
    refendParM2: 0.25 / 14
  };

  // Mode global (volume total) : le logement est saisi d'un bloc (surface, hauteur, niveaux).
  var GLOBAL = {
    niveauxMax: 4,
    // Périmètre estimé d'un niveau : emprise rectangulaire de proportions 1 × 1,5,
    // soit 2 × (√1,5 + 1/√1,5) ≈ 4,1 × √emprise. Réduire si le logement est mitoyen.
    facteurPerimetre: 4.1
  };

  // Conductivité des isolants (W/m.K) — lambda null : R isolant = 0
  var ISOLANTS = [
    { id: 'aucun', label: 'Aucun isolant', lambda: null },
    { id: 'laine_verre', label: 'Laine de verre', lambda: 0.035 },
    { id: 'laine_roche', label: 'Laine de roche', lambda: 0.038 },
    { id: 'laine_bois', label: 'Laine de bois', lambda: 0.040 },
    { id: 'ouate', label: 'Ouate de cellulose', lambda: 0.040 },
    { id: 'pse', label: 'Polystyrène expansé (PSE)', lambda: 0.035 },
    { id: 'pu', label: 'Polyuréthane (PU)', lambda: 0.025 }
  ];

  // Vitrages : U = Uw et g = Sw de la fenêtre entière (menuiserie comprise), car la surface saisie
  // est celle de la baie mesurée en tableau (tables 3CL-DPE 2021, fenêtre battante courante).
  var VITRAGES = [
    { id: 'simple', label: 'Simple vitrage', u: 5.8, g: 0.60 },
    { id: 'double', label: 'Double vitrage ancien (lame d\'air)', u: 2.8, g: 0.52 },
    { id: 'double_argon', label: 'Double vitrage récent (argon, faible émissivité)', u: 1.4, g: 0.45 },
    { id: 'triple', label: 'Triple vitrage', u: 1.0, g: 0.40 }
  ];

  // Rayonnement solaire de pointe d'été (W/m² de baie, à multiplier par g = Sw), baies sans protection.
  // w      : pointe SIMULTANÉE de la maison (éclairement de pointe × facteur de charge ASHRAE
  //          « maison entière ») : total chantier (groupe extérieur, PAC air/air, gainable).
  // wPiece : pointe PROPRE À LA PIÈCE (choix du split) : moyenne de Manual J 8 (pointe horaire,
  //          49° N) et d'un calcul ciel clair pvlib × stockage ISO 13790 (inertie moyenne).
  // toit   : fenêtre de toit (pente 30-45°), hors moyenne « mixte ».
  // cren   : charge solaire SIMULTANÉE de la maison (W/m² de baie × g) à 10, 12, 15, 17 et 19 h (heure d'été),
  //          calcul horaire ciel clair (21/07 et 21/08, Sarreguemines), inertie moyenne : total chantier.
  //          Le maximum sur les créneaux remplace la table w unique (façades mixtes) : une maison vitrée
  //          surtout au Sud ou à l'Ouest n'a pas de foisonnement solaire (cf. excursion AED de Manual J).
  var ORIENTATIONS = [
    { id: 'S', label: 'Sud', w: 250, wPiece: 380, cren: [130, 290, 395, 300, 160] },
    { id: 'SE', label: 'Sud-Est', w: 240, wPiece: 440, cren: [380, 460, 260, 165, 125] },
    { id: 'SO', label: 'Sud-Ouest', w: 370, wPiece: 460, cren: [95, 115, 355, 470, 390] },
    { id: 'E', label: 'Est', w: 220, wPiece: 430, cren: [455, 370, 175, 150, 125] },
    { id: 'O', label: 'Ouest', w: 390, wPiece: 480, cren: [100, 115, 175, 380, 475] },
    { id: 'NE', label: 'Nord-Est', w: 110, wPiece: 270, cren: [285, 165, 125, 115, 95] },
    { id: 'NO', label: 'Nord-Ouest', w: 240, wPiece: 300, cren: [80, 95, 105, 165, 315] },
    { id: 'N', label: 'Nord', w: 70, wPiece: 100, cren: [70, 80, 90, 85, 75] },
    { id: 'toit', label: 'Fenêtre de toit – pan Sud, Est ou Ouest', w: 500, wPiece: 700, toit: true, cren: [285, 515, 660, 560, 330] },
    { id: 'toit_n', label: 'Fenêtre de toit – pan Nord', w: 200, wPiece: 300, toit: true, cren: [185, 220, 240, 235, 210] }
  ];

  // Orientation « moyenne » proposée en saisie rapide : moyenne des 8 orientations verticales.
  var ORIENTATION_MIXTE = { id: 'mixte', label: 'Plusieurs orientations (moyenne)' };

  // Saisie rapide des vitrages : surface vitrée = ratio × surface au sol de la pièce.
  var NIVEAUX_VITRAGE = [
    { id: 'peu', label: 'Peu vitré', ratio: 0.10 },
    { id: 'moyen', label: 'Moyennement vitré', ratio: 0.17 },
    { id: 'tres', label: 'Très vitré', ratio: 0.25 }
  ];

  // Apports internes par occupant (W) : w sensible, lat latent (ASHRAE).
  var ACTIVITES = [
    { id: 'sedentaire', label: 'Sédentaire', w: 70, lat: 45 },
    { id: 'bureau', label: 'Bureau / classe', w: 80, lat: 55 },
    { id: 'legere', label: 'Activité légère', w: 100, lat: 55 },
    { id: 'cuisine', label: 'Restauration / cuisine', w: 130, lat: 80 }
  ];

  // Été : occupants et équipements (éclairage + appareils, W) par défaut selon le nom de la pièce,
  // quand le champ est vide (total ≈ 700 W par logement, défaut Manual J de 2 400 Btu/h).
  // occupants 'foyer' = personnes du foyer (encart Prime ; sinon chambres + 1).
  var TYPES_PIECE = [
    { id: 'sejour', motif: 's[ée]jour|salon|salle . manger|living|pi[èe]ce de vie|v[ée]randa', occupants: 'foyer', equipements: 150 },
    { id: 'cuisine', motif: 'cuisine', occupants: 1, equipements: 300 },
    { id: 'chambre', motif: 'chambre', occupants: 2, equipements: 50 },
    { id: 'bureau', motif: 'bureau', occupants: 1, equipements: 150 },
    { id: 'service', motif: 'bain|salle d.eau|wc|toilette|couloir|entr[ée]e|d[ée]gagement|buanderie|cellier|dressing|palier|escalier|garage', occupants: 0, equipements: 0 }
  ];

  // Constantes du calcul d'été.
  var CLIM = {
    ecartReferenceEtd: 6,  // K : écart 32 - 26 °C pour lequel les ETD sont tabulés (recalés sinon)
    solaireLeger: 1.15,    // pièce légère (sous rampants, ossature bois) : baies verticales
    latentAir: 0.83,       // W par (m³/h · g/kg) : 1,2 kg/m³ × 2 501 kJ/kg / 3 600
    dwEte: 2,              // g/kg : écart d'humidité absolue air extérieur / intérieur
    rapportSensible: 0.75, // part sensible de la puissance nominale air/air (27/19 °C, EN 14511)
    surdimMax: 1.3,        // plafond de surdimensionnement (inverter) : garde-fou, valeur non sourcée précisément
    equipementsParM2: 7,   // W/m² : pièce non reconnue
    occupantsInconnu: 1,   // pièce non reconnue
    foyerDefaut: 4,        // personnes si ni l'encart Prime ni les chambres ne le donnent
    foyerMax: 20,          // au-delà, « Personnes au foyer » est une erreur de saisie (souvent le RFR) : ignorée
    densiteMax: 400,       // W/m² : au-delà, puissance de pièce signalée « à vérifier » dans le récapitulatif
    heuresCreneaux: ['10 h', '12 h', '15 h', '17 h', '19 h'],
    partEcartCreneaux: [0, 0.15, 0.85, 1, 0.8], // part de l'écart été (T ext - T int) au créneau : baies, murs, toit, air
    majorationDefaut: 0    // % ajouté à la puissance nominale (pièces et total) si « Majoration clim » est vide
  };

  // Type d'installation choisi en début de relevé.
  var SYSTEMES = [
    { id: 'air_eau', label: 'PAC air/eau', detail: 'Radiateurs ou plancher chauffant, ECS' },
    { id: 'air_air', label: 'PAC air/air', detail: 'Splits, gainable : ni radiateur ni circuit d\'eau' }
  ];

  // Puissances nominales courantes des unités intérieures murales (kW) : choix du split par pièce.
  var PALIERS_SPLIT = [1.5, 2, 2.5, 3.5, 4.2, 5, 6, 7.1];

  // Taux de renouvellement d'air (vol/h)
  var VENTILATIONS = [
    { id: 'aucune', label: 'Pas de VMC (fenêtres / infiltrations)', taux: 0.5 },
    { id: 'vmc_auto', label: 'VMC auto-réglable', taux: 0.6 },
    { id: 'vmc_hygro', label: 'VMC hygroréglable', taux: 0.45 }
  ];

  // Paliers commerciaux PAC / clim (kW)
  var PALIERS_PAC = [2.5, 3.5, 5, 6, 7, 8, 10, 12, 14, 16, 18, 20, 24, 28];

  // Paliers commerciaux radiateurs neufs (W)
  // Radiateurs panneaux acier 4 connexions, catalogue Altech 2025-2026 (EN 442, RAL 9016) :
  // [type, hauteur mm, largeur mm, puissance ΔT50 W, puissance ΔT30 W, référence].
  // Sert au radiateur neuf préconisé et à la puissance des radiateurs acier existants de ces types.
  var CATALOGUE_RADIATEURS = {
    source: 'Altech 2025-2026',
    modeles: [
    ['11', 600, 400, 406, 209, '7595155'],
    ['11', 600, 500, 507, 262, '7595156'],
    ['11', 600, 600, 608, 314, '7595157'],
    ['11', 600, 800, 811, 419, '7595158'],
    ['11', 600, 1000, 1014, 523, '7595159'],
    ['11', 700, 400, 461, 238, '7595160'],
    ['11', 700, 500, 577, 297, '7595161'],
    ['11', 700, 600, 692, 357, '7595162'],
    ['11', 700, 800, 922, 476, '7595163'],
    ['11', 900, 400, 561, 289, '7595164'],
    ['11', 900, 500, 701, 361, '7595165'],
    ['11', 900, 600, 841, 433, '7595166'],
    ['11', 900, 700, 981, 506, '7595167'],
    ['11', 900, 800, 1122, 578, '7595168'],
    ['11', 900, 900, 1262, 650, '7595169'],
    ['21', 500, 400, 470, 240, '7595170'],
    ['21', 500, 600, 705, 360, '7595171'],
    ['21', 500, 800, 940, 480, '7595172'],
    ['21', 500, 900, 1058, 541, '7595173'],
    ['21', 600, 400, 545, 278, '7595174'],
    ['21', 600, 500, 681, 347, '7595175'],
    ['21', 600, 600, 817, 416, '7595176'],
    ['21', 600, 700, 953, 486, '7595177'],
    ['21', 600, 800, 1090, 555, '7595178'],
    ['21', 600, 900, 1226, 625, '7595179'],
    ['21', 600, 1000, 1362, 694, '7595180'],
    ['21', 600, 1200, 1634, 833, '7595181'],
    ['21', 700, 400, 616, 313, '7595182'],
    ['21', 700, 500, 770, 391, '7595183'],
    ['21', 700, 600, 923, 469, '7595184'],
    ['21', 700, 700, 1077, 547, '7595185'],
    ['21', 700, 800, 1231, 626, '7595186'],
    ['21', 700, 900, 1385, 704, '7595187'],
    ['21', 700, 1000, 1539, 782, '7595188'],
    ['21', 700, 1100, 1693, 860, '7595189'],
    ['21', 900, 400, 747, 377, '7595190'],
    ['21', 900, 500, 934, 472, '7595191'],
    ['21', 900, 600, 1121, 566, '7595192'],
    ['21', 900, 700, 1308, 661, '7595193'],
    ['21', 900, 800, 1494, 755, '7595194'],
    ['21', 900, 900, 1681, 849, '7595195'],
    ['22', 400, 600, 755, 384, '7595196'],
    ['22', 400, 800, 1007, 512, '7595197'],
    ['22', 400, 900, 1133, 576, '7595198'],
    ['22', 400, 1000, 1259, 640, '7595199'],
    ['22', 400, 1100, 1385, 704, '7595200'],
    ['22', 400, 1200, 1511, 768, '7595201'],
    ['22', 400, 1400, 1763, 896, '7595202'],
    ['22', 500, 400, 605, 306, '7595203'],
    ['22', 500, 500, 757, 383, '7595204'],
    ['22', 500, 600, 908, 459, '7595205'],
    ['22', 500, 700, 1059, 536, '7595206'],
    ['22', 500, 800, 1210, 612, '7595207'],
    ['22', 500, 900, 1362, 689, '7595208'],
    ['22', 500, 1000, 1513, 765, '7595209'],
    ['22', 500, 1100, 1664, 842, '7595210'],
    ['22', 500, 1200, 1816, 918, '7595211'],
    ['22', 500, 1400, 2118, 1071, '7595212'],
    ['22', 600, 400, 699, 351, '7595213'],
    ['22', 600, 500, 874, 439, '7595214'],
    ['22', 600, 600, 1048, 527, '7595215'],
    ['22', 600, 700, 1223, 615, '7595216'],
    ['22', 600, 800, 1398, 703, '7595217'],
    ['22', 600, 900, 1572, 791, '7595218'],
    ['22', 600, 1000, 1747, 879, '7595219'],
    ['22', 600, 1100, 1922, 966, '7595220'],
    ['22', 600, 1200, 2096, 1054, '7595221'],
    ['22', 600, 1400, 2446, 1230, '7595222'],
    ['22', 700, 400, 785, 395, '7595223'],
    ['22', 700, 500, 982, 494, '7595224'],
    ['22', 700, 600, 1178, 592, '7595225'],
    ['22', 700, 700, 1374, 691, '7595226'],
    ['22', 700, 800, 1570, 790, '7595227'],
    ['22', 700, 900, 1767, 889, '7595228'],
    ['22', 700, 1000, 1963, 987, '7595229'],
    ['22', 700, 1100, 2159, 1086, '7595230'],
    ['22', 700, 1200, 2356, 1185, '7595231'],
    ['22', 700, 1400, 2748, 1382, '7595232'],
    ['22', 900, 400, 937, 471, '7595233'],
    ['22', 900, 500, 1172, 589, '7595234'],
    ['22', 900, 600, 1406, 707, '7595235'],
    ['22', 900, 700, 1640, 825, '7595236'],
    ['22', 900, 800, 1874, 943, '7595237'],
    ['22', 900, 900, 2109, 1061, '7595238'],
    ['22', 900, 1000, 2343, 1179, '7595239'],
    ['22', 900, 1100, 2577, 1296, '7595240'],
    ['22', 900, 1200, 2812, 1414, '7595241'],
    ['22', 900, 1400, 3280, 1650, '7595242'],
    ['33', 400, 1000, 1791, 918, '4507448'],
    ['33', 500, 800, 1722, 880, '4507449'],
    ['33', 500, 1200, 2584, 1319, '4507450'],
    ['33', 600, 400, 994, 506, '4507452'],
    ['33', 600, 600, 1490, 758, '4507453'],
    ['33', 600, 700, 1739, 885, '4507454'],
    ['33', 600, 800, 1987, 1011, '4507455'],
    ['33', 600, 900, 2236, 1137, '4507456'],
    ['33', 600, 1000, 2484, 1264, '4507451'],
    ['33', 700, 400, 1115, 566, '4507457'],
    ['33', 700, 600, 1673, 849, '4507458'],
    ['33', 700, 700, 1952, 991, '4507459'],
    ['33', 700, 800, 2230, 1132, '7595243'],
    ['33', 700, 900, 2509, 1274, '4507460'],
    ['33', 700, 1000, 2788, 1415, '7595244'],
    ['33', 700, 1100, 3067, 1556, '7595245'],
    ['33', 900, 400, 1326, 670, '4507463'],
    ['33', 900, 600, 1990, 1005, '4507464'],
    ['33', 900, 700, 2321, 1173, '4507465'],
    ['33', 900, 800, 2653, 1340, '7595246'],
    ['33', 900, 900, 2984, 1507, '7595247'],
    ['33', 900, 1000, 3316, 1675, '4507461'],
    ['33', 900, 1100, 3648, 1842, '7595248'],
    ['33', 900, 1200, 3979, 2010, '4507462']
    ].map(function (m) { return { type: m[0], hauteur: m[1], largeur: m[2], p50: m[3], p30: m[4], ref: m[5] }; })
  };

  // Hauteurs proposées pour les radiateurs neufs (mm) : celles du catalogue.
  var HAUTEURS_RADIATEUR_NEUF = [400, 500, 600, 700, 900];

  // Radiateurs acier existants (W/m² de façade, ΔT50 — indicatif) ; types du catalogue : valeurs Altech.
  var RADIATEURS_ACIER = [
    { id: '10', label: 'Type 10', wm2: 1050 },
    { id: '11', label: 'Type 11', wm2: 1540 },
    { id: '20', label: 'Type 20', wm2: 1700 },
    { id: '21', label: 'Type 21', wm2: 2050 },
    { id: '22', label: 'Type 22', wm2: 2700 },
    { id: '30', label: 'Type 30', wm2: 2350 },
    { id: '33', label: 'Type 33', wm2: 3800 }
  ];

  // Radiateurs fonte / aluminium existants (W par élément selon hauteur, ΔT50 — indicatif)
  var RADIATEURS_ELEMENTS = {
    fonte: { 500: 75, 600: 95, 700: 115 },
    alu: { 500: 100, 600: 135, 700: 165 }
  };

  // Régimes d'eau (départ / retour, °C). Les puissances catalogue des radiateurs sont données à ΔT50
  // (75/65 °C pour 20 °C ambiant) ; à plus basse température, elles sont corrigées (voir calc.js).
  // Température de sortie d'eau de la PAC, de 35 à 60 °C, et type de PAC correspondant.
  // id « départ/retour » : retour 10 K sous le départ (5 K en très basse température).
  var REGIMES_EAU = [
    { id: '35/30', depart: 35, retour: 30, type: 'PAC basse température (plancher chauffant)' },
    { id: '40/35', depart: 40, retour: 35, type: 'PAC basse température' },
    { id: '45/35', depart: 45, retour: 35, type: 'PAC basse température' },
    { id: '50/40', depart: 50, retour: 40, type: 'PAC moyenne température' },
    { id: '55/45', depart: 55, retour: 45, type: 'PAC haute température' },
    { id: '60/50', depart: 60, retour: 50, type: 'PAC haute température' }
  ];
  REGIMES_EAU.forEach(function (r) { r.label = r.depart + ' °C – ' + r.type + ' (retour ' + r.retour + ' °C)'; });
  // Relevés antérieurs : régimes au-delà de 60 °C ramenés à 60 °C.
  var REGIMES_EAU_ANCIENS = { '65/55': '60/50', '70/60': '60/50', '75/65': '60/50' };

  // Exposant de la loi d'émission des radiateurs (EN 442) : P = P50 × (ΔTlm / ΔTlm50)^n.
  var EXPOSANT_RADIATEUR = 1.3;

  var MATERIAUX_RADIATEUR = [
    { id: 'acier', label: 'Acier' },
    { id: 'fonte', label: 'Fonte' },
    { id: 'alu', label: 'Aluminium' }
  ];

  var HAUTEURS_ELEMENT = [500, 600, 700];

  // Plafonds Anah / MaPrimeRénov' 2026 (RFR N-1, €) : [bleu, jaune, violet] par nb de personnes (1 à 5)
  // À recontrôler en début d'année civile (réindexation annuelle).
  var ANAH = {
    annee: 2026,
    hors_idf: {
      label: 'Hors Île-de-France',
      seuils: [
        [17363, 22259, 31185],
        [25393, 32553, 45842],
        [30540, 39148, 55196],
        [35676, 45735, 64550],
        [40835, 52348, 73907]
      ],
      parPersonne: [5151, 6598, 9357]
    },
    idf: {
      label: 'Île-de-France',
      seuils: [
        [24031, 29253, 40851],
        [35270, 42933, 60051],
        [42357, 51564, 71846],
        [49455, 60208, 84562],
        [56580, 68877, 96817]
      ],
      parPersonne: [7116, 8663, 12257]
    }
  };

  var CATEGORIES_ANAH = [
    { id: 'bleu', label: 'Bleu', detail: 'Très modestes' },
    { id: 'jaune', label: 'Jaune', detail: 'Modestes' },
    { id: 'violet', label: 'Violet', detail: 'Intermédiaires' },
    { id: 'rose', label: 'Rose', detail: 'Supérieurs' }
  ];

  var api = {
    ZONES: ZONES,
    GENERATIONS: GENERATIONS,
    MURS: MURS,
    TOITURES: TOITURES,
    PLANCHERS_DALLE: PLANCHERS_DALLE,
    PLANCHERS_LOCAL: PLANCHERS_LOCAL,
    R_SE_LOCAL: R_SE_LOCAL,
    PLANCHERS_ANCIENS: PLANCHERS_ANCIENS,
    ISOLANTS: ISOLANTS,
    POSITIONS_ISOLANT_MUR: POSITIONS_ISOLANT_MUR,
    PLANCHERS_ETAGE: PLANCHERS_ETAGE,
    PONTS_THERMIQUES: PONTS_THERMIQUES,
    GLOBAL: GLOBAL,
    VITRAGES: VITRAGES,
    ORIENTATIONS: ORIENTATIONS,
    ORIENTATION_MIXTE: ORIENTATION_MIXTE,
    NIVEAUX_VITRAGE: NIVEAUX_VITRAGE,
    ACTIVITES: ACTIVITES,
    VENTILATIONS: VENTILATIONS,
    PALIERS_PAC: PALIERS_PAC,
    PALIERS_SPLIT: PALIERS_SPLIT,
    ETD_MURS: ETD_MURS,
    TYPES_PIECE: TYPES_PIECE,
    CLIM: CLIM,
    R_SURFACE_MUR: R_SURFACE_MUR,
    REVETEMENTS_MUR: REVETEMENTS_MUR,
    SYSTEMES: SYSTEMES,
    CATALOGUE_RADIATEURS: CATALOGUE_RADIATEURS,
    HAUTEURS_RADIATEUR_NEUF: HAUTEURS_RADIATEUR_NEUF,
    RADIATEURS_ACIER: RADIATEURS_ACIER,
    RADIATEURS_ELEMENTS: RADIATEURS_ELEMENTS,
    MATERIAUX_RADIATEUR: MATERIAUX_RADIATEUR,
    REGIMES_EAU: REGIMES_EAU,
    REGIMES_EAU_ANCIENS: REGIMES_EAU_ANCIENS,
    EXPOSANT_RADIATEUR: EXPOSANT_RADIATEUR,
    HAUTEURS_ELEMENT: HAUTEURS_ELEMENT,
    ANAH: ANAH,
    CATEGORIES_ANAH: CATEGORIES_ANAH,
    find: function (table, id) {
      for (var i = 0; i < table.length; i++) if (table[i].id === id) return table[i];
      return null;
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Data = api;
})(this);
