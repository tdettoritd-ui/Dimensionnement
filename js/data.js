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
  var MURS = [
    { id: 'pierre', label: 'Pierre / brique pleine (ancien)', r: 0.40 },
    { id: 'parpaing', label: 'Parpaing / béton banché', r: 0.40 },
    { id: 'machefer', label: 'Mâchefer (parpaing / agglo)', r: 0.42 },
    { id: 'brique_creuse', label: 'Brique creuse (20-25 cm)', r: 0.55 },
    { id: 'monomur', label: 'Brique monomur / alvéolaire (30-37,5 cm)', r: 2.1 },
    { id: 'beton_cellulaire', label: 'Béton cellulaire', r: 1.43 },
    { id: 'ossature_bois', label: 'Ossature bois', r: 0.30 }
  ];

  // Résistance de base toiture (m².K/W) — r null : U = 0
  var TOITURES = [
    { id: 'combles', label: 'Combles / rampants (structure bois)', r: 0.40 },
    { id: 'terrasse', label: 'Toiture terrasse (structure béton)', r: 0.35 },
    { id: 'aucune', label: 'Aucune (étage intermédiaire)', r: null }
  ];

  // Résistance de base plancher bas (m².K/W) — r null : U = 0.
  // Valeurs « équivalentes » : le calcul applique l'écart de température extérieur complet, alors
  // que le sol (terre-plein) ou un local non chauffé (cave, vide sanitaire) est moins froid.
  // Terre-plein : 1 / Ue des tables 3CL ; cave et vide sanitaire : R0 / b (b ≈ 0,6-0,8, EN 12831).
  var PLANCHERS = [
    { id: 'dalle', label: 'Dalle béton sur terre-plein', r: 2.0 },
    { id: 'dalle_machefer', label: 'Dalle mâchefer sur terre-plein', r: 2.1 },
    { id: 'bois_vs', label: 'Plancher bois / vide sanitaire', r: 0.8 },
    { id: 'cave', label: 'Sur cave non chauffée', r: 0.8 },
    { id: 'aucun', label: 'Aucun (étage intermédiaire)', r: null }
  ];

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

  // Rayonnement solaire de pointe d'été (W/m² de baie, à multiplier par g = Sw) : éclairement de
  // pointe en façade × facteur de charge solaire (méthode résidentielle ASHRAE, 45-49° N).
  // L'Ouest est la façade la plus pénalisante (pointe en fin d'après-midi, à l'heure chaude).
  var ORIENTATIONS = [
    { id: 'S', label: 'Sud', w: 250 },
    { id: 'SE', label: 'Sud-Est', w: 240 },
    { id: 'SO', label: 'Sud-Ouest', w: 370 },
    { id: 'E', label: 'Est', w: 220 },
    { id: 'O', label: 'Ouest', w: 390 },
    { id: 'NE', label: 'Nord-Est', w: 110 },
    { id: 'NO', label: 'Nord-Ouest', w: 240 },
    { id: 'N', label: 'Nord', w: 70 }
  ];

  // Orientation « moyenne » proposée en saisie rapide : rayonnement = moyenne des 8 orientations.
  var ORIENTATION_MIXTE = { id: 'mixte', label: 'Plusieurs orientations (moyenne)' };

  // Saisie rapide des vitrages : surface vitrée = ratio × surface au sol de la pièce.
  var NIVEAUX_VITRAGE = [
    { id: 'peu', label: 'Peu vitré', ratio: 0.10 },
    { id: 'moyen', label: 'Moyennement vitré', ratio: 0.17 },
    { id: 'tres', label: 'Très vitré', ratio: 0.25 }
  ];

  // Apports internes par occupant (W)
  var ACTIVITES = [
    { id: 'sedentaire', label: 'Sédentaire', w: 70 },
    { id: 'bureau', label: 'Bureau / classe', w: 80 },
    { id: 'legere', label: 'Activité légère', w: 100 },
    { id: 'cuisine', label: 'Restauration / cuisine', w: 130 }
  ];

  // Taux de renouvellement d'air (vol/h)
  var VENTILATIONS = [
    { id: 'aucune', label: 'Pas de VMC (fenêtres / infiltrations)', taux: 0.5 },
    { id: 'vmc_auto', label: 'VMC auto-réglable', taux: 0.6 },
    { id: 'vmc_hygro', label: 'VMC hygroréglable', taux: 0.45 }
  ];

  // Paliers commerciaux PAC / clim (kW)
  var PALIERS_PAC = [2.5, 3.5, 5, 6, 7, 8, 10, 12, 14, 16, 18, 20, 24, 28];

  // Paliers commerciaux radiateurs neufs (W)
  var PALIERS_RADIATEUR = [500, 750, 1000, 1250, 1500, 1800, 2000, 2500, 3000];

  // Radiateurs acier existants (W/m² de façade, ΔT50 — indicatif)
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
    PLANCHERS: PLANCHERS,
    ISOLANTS: ISOLANTS,
    VITRAGES: VITRAGES,
    ORIENTATIONS: ORIENTATIONS,
    ORIENTATION_MIXTE: ORIENTATION_MIXTE,
    NIVEAUX_VITRAGE: NIVEAUX_VITRAGE,
    ACTIVITES: ACTIVITES,
    VENTILATIONS: VENTILATIONS,
    PALIERS_PAC: PALIERS_PAC,
    PALIERS_RADIATEUR: PALIERS_RADIATEUR,
    RADIATEURS_ACIER: RADIATEURS_ACIER,
    RADIATEURS_ELEMENTS: RADIATEURS_ELEMENTS,
    MATERIAUX_RADIATEUR: MATERIAUX_RADIATEUR,
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
