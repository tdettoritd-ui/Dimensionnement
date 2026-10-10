/*
 * Interface du relevé : rendu, saisie, persistance locale, export PDF.
 * Tout est local à l'appareil : aucune donnée n'est envoyée à un serveur.
 */
(function () {
  'use strict';

  var D = window.Data;
  var C = window.Calc;
  var F = window.Fmt;

  var CLE_CHANTIERS = 'dimclim.chantiers';
  var CLE_BROUILLON = 'dimclim.brouillon';
  var CLE_THEME = 'dimclim.theme';

  var OUI_NON = [['oui', 'Oui'], ['non', 'Non']];

  /* ---------- Stockage local (tolérant aux erreurs : navigation privée, quota…) ---------- */

  function lire(cle, defaut) {
    try {
      var v = localStorage.getItem(cle);
      return v ? JSON.parse(v) : defaut;
    } catch (e) {
      return defaut;
    }
  }

  function ecrire(cle, valeur) {
    try {
      localStorage.setItem(cle, JSON.stringify(valeur));
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ---------- Modèle ---------- */

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function aujourdhui() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function climatDefaut() {
    return {
      zone: 'lorraine',
      tBaseHiver: '-15',
      tBaseEte: '32',
      tConfortEte: '26',
      tConfortHiver: '20',
      surpuissance: '10',
      murType: 'parpaing',
      plancherType: 'dalle',
      toitureType: 'combles',
      isolantMur: { materiau: 'aucun', epaisseur: '' },
      isolantPlancher: { materiau: 'aucun', epaisseur: '' },
      isolantToiture: { materiau: 'aucun', epaisseur: '' },
      ventilation: 'vmc_auto'
    };
  }

  function nouvellePiece(n) {
    return {
      uid: uid(),
      nom: 'Pièce ' + n,
      longueur: '',
      largeur: '',
      hauteur: '2,5',
      lineaire: '',
      sousToiture: 'oui',
      surPlancherBas: 'oui',
      vitrageMode: 'detail',
      vitrages: [],
      vitrageRapide: { niveau: 'moyen', orientation: 'mixte', type: 'double', volet: 'non' },
      occupants: '',
      activite: 'sedentaire',
      equipements: '',
      debit: '',
      radiateur: { materiau: '', typeAcier: '22', hauteur: '', longueur: '', hauteurElement: '600', elements: '' }
    };
  }

  function nouveauVitrage() {
    return { uid: uid(), orientation: 'S', type: 'double', surface: '', volet: 'non' };
  }

  function nouveauChantier(climat) {
    return {
      id: null,
      client: { nom: '', adresse: '', telephone: '', email: '', annee: '', date: aujourdhui(), generation: '' },
      climat: climat || climatDefaut(),
      installation: {
        ballonTampon: '', volumeTampon: '', ecsPac: '', ballonThermo: '', ecsEmplacement: '',
        electrique: '', regulation: '', miniTableau: '',
        distUiUe: '', distUeTableau: '', distUiTableau: '', condensats: '',
        regimeEau: '55/45'
      },
      prime: { personnes: '', rfr: '', zone: 'hors_idf' },
      pieces: [nouvellePiece(1)]
    };
  }

  // Complète un chantier chargé avec les champs éventuellement absents (versions antérieures).
  function normaliser(c) {
    var base = nouveauChantier();
    var out = Object.assign({}, base, c);
    ['client', 'installation', 'prime'].forEach(function (k) { out[k] = Object.assign({}, base[k], c[k]); });
    out.climat = Object.assign(climatDefaut(), c.climat);
    ['isolantMur', 'isolantPlancher', 'isolantToiture'].forEach(function (k) {
      out.climat[k] = Object.assign({ materiau: 'aucun', epaisseur: '' }, out.climat[k]);
    });
    out.pieces = (c.pieces || []).map(function (p, i) {
      var np = Object.assign(nouvellePiece(i + 1), p);
      np.radiateur = Object.assign(nouvellePiece(1).radiateur, p.radiateur);
      np.vitrages = (p.vitrages || []).map(function (v) { return Object.assign(nouveauVitrage(), v); });
      np.vitrageRapide = Object.assign(nouvellePiece(1).vitrageRapide, p.vitrageRapide);
      if (!np.uid) np.uid = uid();
      return np;
    });
    return out;
  }

  var state = normaliser(lire(CLE_BROUILLON, null) || nouveauChantier());
  var modifie = false;
  var ui = {
    open: { client: true, climat: true, installation: false, prime: false },
    replie: {},
    detail: {}
  };

  /* ---------- Chemins de données (« pieces.0.vitrages.1.surface ») ---------- */

  function getPath(obj, path) {
    return path.split('.').reduce(function (o, k) { return o == null ? undefined : o[k]; }, obj);
  }

  function setPath(obj, path, value) {
    var keys = path.split('.');
    var last = keys.pop();
    var target = keys.reduce(function (o, k) { return o[k]; }, obj);
    target[last] = value;
  }

  /* ---------- Formatage (js/format.js) ---------- */

  var esc = F.esc;
  var nf = F.nf;
  var kW = F.kW;
  var W = F.W;
  var euros = F.euros;
  var palierBarre = F.palierBarre;
  var textePalierRadiateur = F.textePalierRadiateur;
  var dateFr = F.dateFr;

  /* ---------- Composants de formulaire ---------- */

  function champ(label, path, o) {
    o = o || {};
    var v = getPath(state, path);
    var kind = o.kind || 'text';
    var attrs = '';
    if (kind === 'num') attrs = ' type="text" inputmode="decimal" autocomplete="off"';
    else if (kind === 'int') attrs = ' type="text" inputmode="numeric" autocomplete="off"';
    else if (kind === 'signed') attrs = ' type="text" autocomplete="off"'; // clavier complet : signe « - » disponible
    else attrs = ' type="' + kind + '"';
    if (o.autocomplete) attrs += ' autocomplete="' + o.autocomplete + '"';
    if (o.list) attrs += ' list="' + o.list + '"';
    var id = 'f-' + path.replace(/\./g, '-');
    var bouton = o.bouton
      ? '<button type="button" class="btn small" data-action="' + o.bouton.action + '"' + (o.bouton.data || '') + '>' + esc(o.bouton.label) + '</button>'
      : '';
    return '<div class="field ' + (o.cls || (o.bouton ? 'span-2' : '')) + '">' +
      '<label class="lbl" for="' + id + '">' + esc(label) + '</label>' +
      '<div class="ctrl">' +
      '<span class="inp"><input id="' + id + '" data-bind="' + path + '"' + attrs + ' value="' + esc(v == null ? '' : v) + '"' +
      (o.placeholder ? ' placeholder="' + esc(o.placeholder) + '"' : '') + '>' +
      (o.unite ? '<span class="unit">' + esc(o.unite) + '</span>' : '') + '</span>' +
      bouton +
      '</div>' +
      (o.aide || o.aideId ? '<p class="hint"' + (o.aideId ? ' id="' + o.aideId + '"' : '') + '>' + (o.aide || '') + '</p>' : '') +
      '</div>';
  }

  function liste(label, path, options, o) {
    o = o || {};
    var v = getPath(state, path);
    var id = 'f-' + path.replace(/\./g, '-');
    var opts = (o.vide ? '<option value="">' + esc(o.vide) + '</option>' : '') +
      options.map(function (op) {
        return '<option value="' + esc(op.value) + '"' + (String(op.value) === String(v) ? ' selected' : '') + '>' + esc(op.label) + '</option>';
      }).join('');
    return '<div class="field ' + (o.cls || '') + '">' +
      '<label class="lbl" for="' + id + '">' + esc(label) + '</label>' +
      '<div class="ctrl"><select id="' + id + '" data-bind="' + path + '">' + opts + '</select></div>' +
      '</div>';
  }

  function table2options(table) {
    return table.map(function (e) { return { value: e.id, label: e.label }; });
  }

  // Bouton segmenté ; data-clear : un second appui sur l'option active la désélectionne.
  function bascule(label, path, options, o) {
    o = o || {};
    var v = getPath(state, path);
    return '<div class="field ' + (o.cls || '') + '">' +
      '<span class="lbl">' + esc(label) + '</span>' +
      '<div class="seg" role="group" aria-label="' + esc(label) + '">' +
      (options || OUI_NON).map(function (op) {
        var actif = v === op[0];
        return '<button type="button" data-set="' + path + '" data-value="' + op[0] + '"' +
          (o.obligatoire ? '' : ' data-clear') + ' aria-pressed="' + actif + '" class="' + (actif ? 'on' : '') + '">' + esc(op[1]) + '</button>';
      }).join('') +
      '</div></div>';
  }

  function encart(key, titre, sousTitre, contenu) {
    return '<details class="card" data-key="open.' + key + '"' + (ui.open[key] ? ' open' : '') + '>' +
      '<summary><span class="card-title">' + esc(titre) + '</span>' +
      '<span class="card-sub" id="sub-' + key + '">' + (sousTitre || '') + '</span>' +
      '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></summary>' +
      '<div class="card-body">' + contenu + '</div></details>';
  }

  /* ---------- Encarts ---------- */

  function renderClient() {
    return encart('client', 'Client', esc(state.client.nom || ''),
      '<div class="grid">' +
      champ('Nom du client', 'client.nom', { cls: 'span-2', autocomplete: 'off' }) +
      champ('Adresse', 'client.adresse', { cls: 'span-2', autocomplete: 'off' }) +
      champ('Téléphone', 'client.telephone', { kind: 'tel', autocomplete: 'off' }) +
      champ('Email', 'client.email', { kind: 'email', autocomplete: 'off' }) +
      champ('Année de construction', 'client.annee', { kind: 'int', placeholder: 'ex. 1975' }) +
      champ('Date du relevé', 'client.date', { kind: 'date' }) +
      liste('Génération de chauffage actuelle', 'client.generation', table2options(D.GENERATIONS), { vide: '— Non renseignée —', cls: 'span-2' }) +
      '</div>');
  }

  function isolant(label, key) {
    var mat = state.climat[key].materiau;
    return '<div class="field-pair span-2">' +
      liste('Isolant ' + label, 'climat.' + key + '.materiau', table2options(D.ISOLANTS)) +
      (mat && mat !== 'aucun'
        ? champ('Épaisseur', 'climat.' + key + '.epaisseur', { kind: 'num', unite: 'cm', cls: 'narrow' })
        : '') +
      '</div>';
  }

  function renderClimat() {
    var c = state.climat;
    var zone = D.find(D.ZONES, c.zone);
    return encart('climat', 'Climat / enveloppe', esc(zone ? zone.label.split(' – ')[0] + ' · ' + c.tBaseHiver + ' °C' : ''),
      '<div class="grid">' +
      liste('Zone climatique hiver', 'climat.zone', D.ZONES.map(function (z) {
        return { value: z.id, label: z.label + ' (' + (z.t > 0 ? '+' : '') + z.t + ' °C)' };
      }), { cls: 'span-2' }) +
      champ('T° ext. de base hiver', 'climat.tBaseHiver', { kind: 'signed', unite: '°C' }) +
      champ('T° ext. de base été', 'climat.tBaseEte', { kind: 'signed', unite: '°C' }) +
      champ('Confort hiver', 'climat.tConfortHiver', { kind: 'num', unite: '°C' }) +
      champ('Confort été', 'climat.tConfortEte', { kind: 'num', unite: '°C' }) +
      champ('Surpuissance de relance', 'climat.surpuissance', { kind: 'num', unite: '%', cls: 'span-2',
        aide: 'Ajoutée à la puissance de chauffage pour remonter en température après un abaissement de nuit ou une absence. 0 % si le chauffage n\'est jamais abaissé.' }) +
      '</div>' +
      '<h3 class="sub-title">Murs</h3><div class="grid">' +
      liste('Type de paroi', 'climat.murType', D.MURS.map(function (m) { return { value: m.id, label: m.label + ' – R ' + nf(m.r, 2) }; }), { cls: 'span-2' }) +
      isolant('murs', 'isolantMur') +
      '</div>' +
      '<h3 class="sub-title">Plancher bas</h3><div class="grid">' +
      liste('Plancher bas', 'climat.plancherType', D.PLANCHERS.map(function (m) { return { value: m.id, label: m.label + (m.r ? ' – R ' + nf(m.r, 2) : '') }; }), { cls: 'span-2' }) +
      (c.plancherType !== 'aucun' ? isolant('plancher', 'isolantPlancher') : '') +
      '</div>' +
      '<h3 class="sub-title">Toiture / plafond</h3><div class="grid">' +
      liste('Toiture / plafond', 'climat.toitureType', D.TOITURES.map(function (m) { return { value: m.id, label: m.label + (m.r ? ' – R ' + nf(m.r, 2) : '') }; }), { cls: 'span-2' }) +
      (c.toitureType !== 'aucune' ? isolant('toiture', 'isolantToiture') : '') +
      '</div>' +
      '<h3 class="sub-title">Ventilation</h3><div class="grid">' +
      liste('Type de ventilation', 'climat.ventilation', D.VENTILATIONS.map(function (v) { return { value: v.id, label: v.label + ' – ' + nf(v.taux, 2) + ' vol/h' }; }), { cls: 'span-2' }) +
      '</div>' +
      '<p class="hint" id="u-enveloppe"></p>');
  }

  function renderInstallation() {
    var i = state.installation;
    var emplacement = bascule('ECS : intégré ou déporté ?', 'installation.ecsEmplacement', [['integre', 'Intégré'], ['deporte', 'Déporté']], { cls: 'span-2' });
    return encart('installation', 'Installation', '',
      '<div class="grid">' +
      liste('Régime d\'eau des radiateurs', 'installation.regimeEau', table2options(D.REGIMES_EAU), { cls: 'span-2' }) +
      '</div>' +
      '<p class="hint">Sert à vérifier les radiateurs existants et à choisir les neufs : les puissances catalogue sont données à ΔT50 (eau à 75 °C).</p>' +
      '<div class="grid">' +
      bascule('Ballon tampon', 'installation.ballonTampon') +
      (i.ballonTampon === 'oui' ? champ('Volume du ballon tampon', 'installation.volumeTampon', { kind: 'num', unite: 'L' }) : '<div class="spacer"></div>') +
      bascule('ECS produite par la PAC ?', 'installation.ecsPac') +
      (i.ecsPac === 'non' ? bascule('Ballon thermodynamique ?', 'installation.ballonThermo') : '<div class="spacer"></div>') +
      (i.ecsPac === 'oui' || (i.ecsPac === 'non' && i.ballonThermo === 'oui') ? emplacement : '') +
      bascule('Installation électrique', 'installation.electrique', [['mono', 'Monophasé'], ['tri', 'Triphasé']], { cls: 'span-2' }) +
      bascule('Régulation connectée', 'installation.regulation') +
      bascule('Mini tableau électrique dédié', 'installation.miniTableau') +
      champ('Distance UI ↔ UE', 'installation.distUiUe', { kind: 'num', unite: 'm' }) +
      champ('Distance UE ↔ tableau', 'installation.distUeTableau', { kind: 'num', unite: 'm' }) +
      champ('Distance UI ↔ tableau', 'installation.distUiTableau', { kind: 'num', unite: 'm' }) +
      bascule('Évacuation condensats à proximité', 'installation.condensats') +
      '</div>' +
      '<p class="hint">Les autres informations servent au chiffrage, sans effet sur le calcul.</p>');
  }

  function renderPrime() {
    return encart('prime', 'Prime', '<span id="sub-prime-badge"></span>',
      '<div class="grid">' +
      champ('Personnes au foyer', 'prime.personnes', { kind: 'int' }) +
      champ('Revenu fiscal de référence', 'prime.rfr', { kind: 'num', unite: '€' }) +
      bascule('Zone', 'prime.zone', [['hors_idf', 'Hors Île-de-France'], ['idf', 'Île-de-France']], { cls: 'span-2', obligatoire: true }) +
      '</div>' +
      '<div id="anah-resultat" class="anah"></div>' +
      '<p class="hint">Catégorie Anah / MaPrimeRénov\'. Plafonds ' + D.ANAH.annee + ' (RFR N-1), réindexés chaque année : à recontrôler en début d\'année civile.</p>');
  }

  function renderVitrage(i, j) {
    var base = 'pieces.' + i + '.vitrages.' + j;
    return '<div class="vitrage">' +
      '<div class="vitrage-head"><span>Vitrage ' + (j + 1) + '</span>' +
      '<button type="button" class="btn ghost small danger" data-action="supprimer-vitrage" data-i="' + i + '" data-j="' + j + '" aria-label="Supprimer le vitrage ' + (j + 1) + '">Supprimer</button></div>' +
      '<div class="grid">' +
      liste('Orientation', base + '.orientation', D.ORIENTATIONS.map(function (o) { return { value: o.id, label: o.label }; })) +
      champ('Surface de la baie', base + '.surface', { kind: 'num', unite: 'm²' }) +
      liste('Type de vitrage', base + '.type', table2options(D.VITRAGES), { cls: 'span-2' }) +
      bascule('Volet roulant', base + '.volet', OUI_NON, { obligatoire: true, cls: 'span-2' }) +
      '</div></div>';
  }

  // Saisie rapide : un niveau de vitrage global au lieu de chaque fenêtre.
  function renderVitrageRapide(p, i) {
    var base = 'pieces.' + i + '.vitrageRapide';
    var orientations = [{ value: D.ORIENTATION_MIXTE.id, label: D.ORIENTATION_MIXTE.label }]
      .concat(D.ORIENTATIONS.map(function (o) { return { value: o.id, label: o.label }; }));
    return '<div class="grid">' +
      bascule('Niveau de vitrage', base + '.niveau', D.NIVEAUX_VITRAGE.map(function (n) { return [n.id, n.label.replace(' vitré', '')]; }), { obligatoire: true, cls: 'span-2' }) +
      '</div>' +
      '<p class="hint" id="vitrage-rapide-' + p.uid + '"></p>' +
      '<div class="grid">' +
      liste('Orientation principale', base + '.orientation', orientations, { cls: 'span-2' }) +
      liste('Type de vitrage', base + '.type', table2options(D.VITRAGES), { cls: 'span-2' }) +
      bascule('Volets roulants', base + '.volet', OUI_NON, { obligatoire: true, cls: 'span-2' }) +
      '</div>';
  }

  function renderVitrages(p, i) {
    var rapide = p.vitrageMode === 'rapide';
    return '<div class="grid">' +
      bascule('Saisie des vitrages', 'pieces.' + i + '.vitrageMode', [['detail', 'Détaillée'], ['rapide', 'Rapide (estimation)']], { obligatoire: true, cls: 'span-2' }) +
      '</div>' +
      (rapide
        ? renderVitrageRapide(p, i)
        : p.vitrages.map(function (v, j) { return renderVitrage(i, j); }).join('') +
          '<button type="button" class="btn small" data-action="ajouter-vitrage" data-i="' + i + '">+ Ajouter un vitrage</button>');
  }

  function renderRadiateur(p, i) {
    var base = 'pieces.' + i + '.radiateur';
    var r = p.radiateur;
    var html = '<div class="grid">' +
      liste('Radiateur existant', base + '.materiau', table2options(D.MATERIAUX_RADIATEUR), { vide: '— Non relevé —', cls: 'span-2' });
    if (r.materiau === 'acier') {
      html += liste('Type', base + '.typeAcier', D.RADIATEURS_ACIER.map(function (t) { return { value: t.id, label: t.label + ' (' + nf(t.wm2) + ' W/m²)' }; }), { cls: 'span-2' }) +
        champ('Hauteur', base + '.hauteur', { kind: 'num', unite: 'cm' }) +
        champ('Longueur', base + '.longueur', { kind: 'num', unite: 'cm' });
    } else if (r.materiau) {
      var t = D.RADIATEURS_ELEMENTS[r.materiau];
      html += liste('Hauteur d\'élément', base + '.hauteurElement', D.HAUTEURS_ELEMENT.map(function (h) { return { value: String(h), label: h + ' mm (' + t[h] + ' W/élt)' }; })) +
        champ('Nombre d\'éléments', base + '.elements', { kind: 'int' });
    }
    html += '</div>';
    if (r.materiau) {
      html += '<div class="radex" id="radex-' + p.uid + '"></div>' +
        '<p class="hint">Puissance ramenée au régime d\'eau ' + F.esc(state.installation.regimeEau) + ' °C (réglage dans « Installation »).</p>' +
        '<p class="hint warn">Valeurs catalogue indicatives ΔT50 (ordre de grandeur, non certifiées) : à recouper avec la documentation constructeur.</p>';
    }
    return html;
  }

  function renderPiece(p, i) {
    var replie = ui.replie[p.uid];
    var corps = '';
    if (!replie) {
      corps = '<div class="grid">' +
        champ('Longueur', 'pieces.' + i + '.longueur', { kind: 'num', unite: 'm' }) +
        champ('Largeur', 'pieces.' + i + '.largeur', { kind: 'num', unite: 'm' }) +
        champ('Hauteur', 'pieces.' + i + '.hauteur', { kind: 'num', unite: 'm' }) +
        champ('Murs ext. exposés', 'pieces.' + i + '.lineaire', {
          kind: 'num', unite: 'ml',
          bouton: { action: 'auto-lineaire', label: '2×(L+l)', data: ' data-i="' + i + '"' },
          aide: '', aideId: 'lineaire-aide-' + p.uid
        }) +
        bascule('Pièce sous toiture ?', 'pieces.' + i + '.sousToiture', [['oui', 'Oui'], ['non', 'Non (étage interm.)']], { obligatoire: true, cls: 'span-2' }) +
        bascule('Pièce sur plancher bas ?', 'pieces.' + i + '.surPlancherBas', [['oui', 'Oui'], ['non', 'Non (à l\'étage)']], { obligatoire: true, cls: 'span-2' }) +
        '</div>' +
        '<h4 class="sub-title">Vitrages</h4>' +
        renderVitrages(p, i) +
        '<h4 class="sub-title">Apports internes et ventilation</h4>' +
        '<div class="grid">' +
        champ('Occupants', 'pieces.' + i + '.occupants', { kind: 'int' }) +
        champ('Équipements', 'pieces.' + i + '.equipements', { kind: 'num', unite: 'W' }) +
        liste('Activité des occupants', 'pieces.' + i + '.activite', D.ACTIVITES.map(function (a) { return { value: a.id, label: a.label + ' (' + a.w + ' W / pers.)' }; }), { cls: 'span-2' }) +
        champ('Débit de ventilation', 'pieces.' + i + '.debit', {
          kind: 'num', unite: 'm³/h',
          bouton: { action: 'estimer-debit', label: 'Estimer', data: ' data-i="' + i + '"' },
          aide: '', aideId: 'debit-aide-' + p.uid
        }) +
        '</div>' +
        '<div class="results" id="res-' + p.uid + '"></div>' +
        '<h4 class="sub-title">Radiateur existant <span class="muted">(optionnel)</span></h4>' +
        renderRadiateur(p, i);
    }
    return '<section class="card piece" aria-label="' + esc(p.nom) + '">' +
      '<div class="piece-head">' +
      '<button type="button" class="btn ghost icon-btn" data-action="replier" data-i="' + i + '" aria-expanded="' + !replie + '" aria-label="' + (replie ? 'Déplier' : 'Replier') + ' la pièce">' +
      '<svg class="chev' + (replie ? ' closed' : '') + '" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>' +
      '<input class="piece-name" data-bind="pieces.' + i + '.nom" value="' + esc(p.nom) + '" list="noms-pieces" aria-label="Nom de la pièce" autocomplete="off">' +
      '<span class="piece-chips" id="chips-' + p.uid + '"></span>' +
      '<button type="button" class="btn ghost icon-btn" data-action="dupliquer-piece" data-i="' + i + '" aria-label="Dupliquer la pièce" title="Dupliquer">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 9h11v11H9zM5 15H4V4h11v1"/></svg></button>' +
      '<button type="button" class="btn ghost icon-btn danger" data-action="supprimer-piece" data-i="' + i + '" aria-label="Supprimer la pièce" title="Supprimer">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></button>' +
      '</div>' +
      (replie ? '' : '<div class="card-body">' + corps + '</div>') +
      '</section>';
  }

  function render() {
    var actif = document.activeElement;
    var focusBind = actif && actif.dataset ? actif.dataset.bind || actif.dataset.set : null;
    var focusValue = actif && actif.dataset ? actif.dataset.value : null;
    var sel = null;
    try { sel = actif && actif.selectionStart != null ? [actif.selectionStart, actif.selectionEnd] : null; } catch (e) { sel = null; }
    var y = window.scrollY;

    document.getElementById('app').innerHTML =
      renderClient() + renderClimat() + renderInstallation() + renderPrime() +
      '<div class="pieces-head"><h2>Pièces</h2><span class="muted" id="nb-pieces"></span></div>' +
      state.pieces.map(renderPiece).join('') +
      '<button type="button" class="btn add-piece" data-action="ajouter-piece">+ Ajouter une pièce</button>' +
      '<datalist id="noms-pieces">' +
      ['Séjour', 'Salon', 'Salle à manger', 'Cuisine', 'Chambre', 'Chambre parentale', 'Bureau', 'Salle de bain', 'Salle d\'eau', 'Entrée', 'Couloir', 'Véranda', 'Buanderie']
        .map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') +
      '</datalist>';

    window.scrollTo(0, y);
    if (focusBind) {
      var q = focusValue != null
        ? '[data-set="' + focusBind + '"][data-value="' + focusValue + '"]'
        : '[data-bind="' + focusBind + '"]';
      var el = document.querySelector(q);
      if (el) {
        el.focus({ preventScroll: true });
        if (sel && el.setSelectionRange) try { el.setSelectionRange(sel[0], sel[1]); } catch (e) { /* type sans sélection */ }
      }
    }
    rafraichir();
  }

  /* ---------- Résultats (mis à jour à chaque frappe, sans reconstruire les champs) ---------- */

  function blocResultats(r) {
    var d = r.deperditions;
    var a = r.apports;
    return '<div class="kpis">' +
      '<div class="kpi heat"><span>Chauffage</span><strong>' + kW(r.chauffage) + '</strong><small>' + W(r.chauffage) + '</small></div>' +
      '<div class="kpi cool"><span>Climatisation</span><strong>' + kW(r.climatisation) + '</strong><small>' + W(r.climatisation) + '</small></div>' +
      '</div>' +
      '<div class="reco"><span>Radiateur neuf préconisé</span><strong>' + textePalierRadiateur(r.radiateurNeuf) + '</strong>' +
      (r.facteurRegime !== 1 ? '<small class="reco-note">puissance catalogue ΔT50, pour un régime ' + F.esc(state.installation.regimeEau) + ' °C</small>' : '') +
      '</div>' +
      '<details class="detail" data-key="detail"><summary>Détail du calcul</summary>' +
      '<table class="mini"><tbody>' +
      '<tr><th>Surface au sol</th><td>' + nf(r.surface, 2) + ' m²</td></tr>' +
      '<tr><th>Volume</th><td>' + nf(r.volume, 1) + ' m³</td></tr>' +
      '<tr><th>Surface murs nette</th><td>' + nf(r.smur, 2) + ' m²</td></tr>' +
      '<tr><th>Surface vitrée</th><td>' + nf(r.surfaceVitree, 2) + ' m²</td></tr>' +
      '<tr><th>U mur / toiture / plancher</th><td>' + nf(r.u.mur, 2) + ' / ' + nf(r.u.toiture, 2) + ' / ' + nf(r.u.plancher, 2) + '</td></tr>' +
      '<tr><th>Débit ventilation retenu</th><td>' + nf(r.debit, 1) + ' m³/h' + (r.debitAuto ? ' (estimé)' : '') + '</td></tr>' +
      '<tr class="sep"><th colspan="2">Déperditions (W/K)</th></tr>' +
      '<tr><th>Murs</th><td>' + nf(d.murs, 2) + '</td></tr>' +
      '<tr><th>Toiture</th><td>' + nf(d.toiture, 2) + '</td></tr>' +
      '<tr><th>Plancher</th><td>' + nf(d.plancher, 2) + '</td></tr>' +
      '<tr><th>Vitrages</th><td>' + nf(d.vitrages, 2) + '</td></tr>' +
      '<tr><th>Renouvellement d\'air</th><td>' + nf(d.air, 2) + '</td></tr>' +
      '<tr class="total"><th>G</th><td>' + nf(r.G, 2) + ' W/K</td></tr>' +
      '<tr><th>Puissance de base (G × ΔT)</th><td>' + W(r.chauffageBase) + '</td></tr>' +
      '<tr><th>Surpuissance de relance</th><td>+ ' + nf(r.surpuissance) + ' % = ' + W(r.chauffage) + '</td></tr>' +
      '<tr class="sep"><th colspan="2">Apports été (W)</th></tr>' +
      '<tr><th>Solaires</th><td>' + nf(a.solaires) + '</td></tr>' +
      '<tr><th>Transmission</th><td>' + nf(a.transmission) + '</td></tr>' +
      '<tr><th>Ventilation</th><td>' + nf(a.ventilation) + '</td></tr>' +
      '<tr><th>Internes</th><td>' + nf(a.internes) + '</td></tr>' +
      '</tbody></table></details>';
  }

  function blocRadiateurExistant(r) {
    var ex = r.radiateurExistant;
    if (!ex) return '';
    var badge = ex.suffisant
      ? '<span class="badge ok">Suffisant</span>'
      : '<span class="badge ko">Insuffisant · manque ' + W(ex.manque) + '</span>';
    var regime = state.installation.regimeEau;
    return '<span>Puissance existante en ' + F.esc(regime) + ' °C</span><strong>' + W(ex.puissance) + '</strong>' + badge +
      (r.facteurRegime !== 1 ? '<small class="reco-note">catalogue ΔT50 : ' + W(ex.puissanceCatalogue) + '</small>' : '');
  }

  function badgeAnah(anah) {
    if (!anah) return '';
    return '<span class="badge anah-' + anah.categorie.id + '">' + anah.categorie.label + '</span>';
  }

  function setHTML(id, html) {
    var el = document.getElementById(id);
    if (el && el.innerHTML !== html) el.innerHTML = html;
  }

  function rafraichir() {
    var res = C.calculChantier(state);

    state.pieces.forEach(function (p, i) {
      var r = res.pieces[i];
      setHTML('chips-' + p.uid, '<span class="chip heat">' + nf(r.chauffage / 1000, 2) + '</span><span class="chip cool">' + nf(r.climatisation / 1000, 2) + '</span>');
      var cible = document.getElementById('res-' + p.uid);
      if (cible) {
        var ouvert = !!ui.detail[p.uid];
        setHTML('res-' + p.uid, blocResultats(r));
        var det = cible.querySelector('details');
        if (det) { det.open = ouvert; det.dataset.uid = p.uid; }
      }
      setHTML('radex-' + p.uid, blocRadiateurExistant(r));
      var niveau = D.find(D.NIVEAUX_VITRAGE, p.vitrageRapide.niveau);
      setHTML('vitrage-rapide-' + p.uid, niveau
        ? 'Surface vitrée estimée : ' + nf(r.surfaceVitree, 1) + ' m² (' + nf(niveau.ratio * 100) + ' % de la surface au sol' +
          (r.surface > 0 ? '' : ', à calculer après saisie des dimensions') + ').'
        : '');
      var input = document.querySelector('[data-bind="pieces.' + i + '.debit"]');
      if (input) input.placeholder = 'auto : ' + nf(r.debitEstime, 1);
      setHTML('debit-aide-' + p.uid, r.debitAuto ? 'Vide : estimation volume × taux utilisée (' + nf(r.debitEstime, 1) + ' m³/h).' : '');
      // Alerte : sans linéaire, aucun mur extérieur n'est compté (cause fréquente de sous-évaluation).
      var aideLineaire = document.getElementById('lineaire-aide-' + p.uid);
      if (aideLineaire) {
        var oubli = C.estVide(p.lineaire) && r.surface > 0;
        aideLineaire.classList.toggle('warn', oubli);
        setHTML('lineaire-aide-' + p.uid, oubli
          ? '⚠ Non saisi : aucun mur extérieur n\'est compté. Saisir le linéaire (ou 0 pour une pièce sans mur extérieur).'
          : '');
      }
    });

    var u = C.uEnveloppe(state.climat);
    setHTML('u-enveloppe', 'U mur ' + nf(u.mur, 2) + ' · U toiture ' + nf(u.toiture, 2) + ' · U plancher ' + nf(u.plancher, 2) + ' W/m².K');
    setHTML('nb-pieces', state.pieces.length + (state.pieces.length > 1 ? ' pièces' : ' pièce'));

    var anah = res.anah;
    setHTML('sub-prime-badge', badgeAnah(anah));
    setHTML('anah-resultat', anah
      ? '<div class="anah-cat anah-' + anah.categorie.id + '"><span>Catégorie</span><strong>' + anah.categorie.label + '</strong><small>' + anah.categorie.detail + '</small></div>' +
        '<table class="mini"><tbody>' +
        '<tr><th>Bleu ≤</th><td>' + euros(anah.seuils[0]) + '</td></tr>' +
        '<tr><th>Jaune ≤</th><td>' + euros(anah.seuils[1]) + '</td></tr>' +
        '<tr><th>Violet ≤</th><td>' + euros(anah.seuils[2]) + '</td></tr>' +
        '<tr><th>Rose ></th><td>' + euros(anah.seuils[2]) + '</td></tr>' +
        '</tbody></table>'
      : '<p class="muted">Renseigner le nombre de personnes et le RFR.</p>');

    setHTML('totals-figures',
      '<div class="tot heat"><span>Chauffage</span><small>' + palierBarre(res.palierChauffage) + '</small><strong>' + kW(res.chauffage) + '</strong></div>' +
      '<div class="tot cool"><span>Climatisation</span><small>' + palierBarre(res.palierClimatisation) + '</small><strong>' + kW(res.climatisation) + '</strong></div>');

    setHTML('sub-client', esc(state.client.nom || ''));
    var z = D.find(D.ZONES, state.climat.zone);
    setHTML('sub-climat', esc((z ? z.label.split(' – ')[0] : '') + ' · ' + state.climat.tBaseHiver + ' °C'));
    document.getElementById('chantier-courant').textContent =
      (state.client.nom || 'Nouveau relevé') + (state.id ? '' : ' · non sauvegardé') + (modifie && state.id ? ' · modifié' : '');
  }

  /* ---------- Saisie ---------- */

  var minuterie = null;
  function modification() {
    modifie = true;
    clearTimeout(minuterie);
    minuterie = setTimeout(function () { ecrire(CLE_BROUILLON, state); }, 300);
  }

  var app = document.getElementById('app');

  app.addEventListener('input', function (e) {
    var el = e.target;
    if (!el.dataset.bind || el.tagName === 'SELECT') return;
    setPath(state, el.dataset.bind, el.value);
    modification();
    rafraichir();
  });

  app.addEventListener('change', function (e) {
    var el = e.target;
    if (!el.dataset.bind || el.tagName !== 'SELECT') return;
    setPath(state, el.dataset.bind, el.value);
    if (el.dataset.bind === 'climat.zone') {
      var z = D.find(D.ZONES, el.value);
      if (z) state.climat.tBaseHiver = String(z.t);
    }
    modification();
    render();
  });

  // L'évènement « toggle » ne remonte pas : écoute en phase de capture.
  app.addEventListener('toggle', function (e) {
    var el = e.target;
    if (!el.dataset || !el.dataset.key) return;
    if (el.dataset.key === 'detail') ui.detail[el.dataset.uid] = el.open;
    else ui.open[el.dataset.key.split('.')[1]] = el.open;
  }, true);

  app.addEventListener('click', function (e) {
    var bt = e.target.closest('button');
    if (!bt) return;

    if (bt.dataset.set) {
      var path = bt.dataset.set;
      var v = bt.dataset.value;
      setPath(state, path, getPath(state, path) === v && bt.hasAttribute('data-clear') ? '' : v);
      modification();
      render();
      return;
    }

    var i = parseInt(bt.dataset.i, 10);
    var j = parseInt(bt.dataset.j, 10);
    var p = state.pieces[i];
    switch (bt.dataset.action) {
      case 'ajouter-piece':
        state.pieces.push(nouvellePiece(state.pieces.length + 1));
        break;
      case 'dupliquer-piece':
        var copie = JSON.parse(JSON.stringify(p));
        copie.uid = uid();
        copie.nom = p.nom + ' (copie)';
        copie.vitrages.forEach(function (v) { v.uid = uid(); });
        state.pieces.splice(i + 1, 0, copie);
        break;
      case 'supprimer-piece':
        if (!confirm('Supprimer la pièce « ' + p.nom + ' » ?')) return;
        state.pieces.splice(i, 1);
        break;
      case 'replier':
        ui.replie[p.uid] = !ui.replie[p.uid];
        render();
        return;
      case 'ajouter-vitrage':
        p.vitrages.push(nouveauVitrage());
        break;
      case 'supprimer-vitrage':
        p.vitrages.splice(j, 1);
        break;
      case 'auto-lineaire':
        p.lineaire = String(Math.round(2 * (C.num(p.longueur) + C.num(p.largeur)) * 100) / 100).replace('.', ',');
        break;
      case 'estimer-debit':
        p.debit = String(Math.round(C.debitEstime(p, state.climat) * 10) / 10).replace('.', ',');
        break;
      default:
        return;
    }
    modification();
    render();
  });

  /* ---------- Chantiers sauvegardés ---------- */

  function chantiers() {
    var l = lire(CLE_CHANTIERS, []);
    return Array.isArray(l) ? l : [];
  }

  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  function sauvegarder() {
    var l = chantiers();
    if (!state.id) state.id = uid();
    var entree = { id: state.id, savedAt: new Date().toISOString(), data: JSON.parse(JSON.stringify(state)) };
    var idx = l.findIndex(function (c) { return c.id === state.id; });
    if (idx >= 0) l[idx] = entree; else l.unshift(entree);
    if (ecrire(CLE_CHANTIERS, l)) {
      modifie = false;
      ecrire(CLE_BROUILLON, state);
      toast('Chantier sauvegardé');
    } else {
      toast('Échec de la sauvegarde (stockage indisponible ou plein)');
    }
    rafraichir();
  }


  function afficherChantiers() {
    var l = chantiers();
    var html = l.length
      ? '<ul class="chantiers">' + l.map(function (c) {
        var cl = c.data.client || {};
        var res = C.calculChantier(normaliser(c.data));
        return '<li' + (c.id === state.id ? ' class="current"' : '') + '>' +
          '<button type="button" class="chantier-load" data-load="' + esc(c.id) + '">' +
          '<strong>' + esc(cl.nom || 'Sans nom') + '</strong>' +
          '<span class="muted small">' + esc(dateFr(cl.date)) + (cl.adresse ? ' · ' + esc(cl.adresse) : '') + '</span>' +
          '<span class="small">' + kW(res.chauffage) + ' chauffage · ' + kW(res.climatisation) + ' clim</span>' +
          '</button>' +
          '<button type="button" class="btn ghost icon-btn danger" data-delete="' + esc(c.id) + '" aria-label="Supprimer ce chantier">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></button>' +
          '</li>';
      }).join('') + '</ul>'
      : '<p class="muted empty">Aucun chantier sauvegardé sur cet appareil.</p>';
    document.getElementById('liste-chantiers').innerHTML = html +
      '<p class="hint">Les chantiers sont stockés uniquement sur cet appareil, dans ce navigateur.</p>';
  }

  var dlg = document.getElementById('dlg-chantiers');

  dlg.addEventListener('click', function (e) {
    if (e.target === dlg || e.target.closest('[data-close]')) { dlg.close(); return; }
    var load = e.target.closest('[data-load]');
    var del = e.target.closest('[data-delete]');
    if (load) {
      var c = chantiers().find(function (x) { return x.id === load.dataset.load; });
      if (!c) return;
      if (modifie && !confirm('Les modifications non sauvegardées du relevé en cours seront perdues. Continuer ?')) return;
      state = normaliser(c.data);
      state.id = c.id;
      modifie = false;
      ui.replie = {};
      ui.detail = {};
      ecrire(CLE_BROUILLON, state);
      dlg.close();
      render();
      window.scrollTo(0, 0);
      toast('Chantier chargé');
    } else if (del) {
      var l = chantiers();
      var cible = l.find(function (x) { return x.id === del.dataset.delete; });
      if (!cible) return;
      if (!confirm('Supprimer définitivement le chantier « ' + ((cible.data.client || {}).nom || 'Sans nom') + ' » ?')) return;
      ecrire(CLE_CHANTIERS, l.filter(function (x) { return x.id !== cible.id; }));
      if (state.id === cible.id) { state.id = null; ecrire(CLE_BROUILLON, state); rafraichir(); }
      afficherChantiers();
    }
  });

  function nouveauReleve() {
    if (!confirm('Démarrer un nouveau relevé ?\nClient, installation, prime et pièces seront réinitialisés (les réglages climat / enveloppe sont conservés).' +
      (modifie ? '\n\nAttention : des modifications ne sont pas sauvegardées.' : ''))) return;
    state = nouveauChantier(JSON.parse(JSON.stringify(state.climat)));
    modifie = false;
    ui.replie = {};
    ui.detail = {};
    ui.open.client = true;
    ecrire(CLE_BROUILLON, state);
    render();
    window.scrollTo(0, 0);
  }

  /* ---------- Export PDF ---------- */

  function exporterPdf() {
    toast('Création du PDF…');
    window.Rapport.generer(state).then(function (f) {
      window.Rapport.telecharger(f);
      toast('PDF enregistré : ' + f.nom);
    }).catch(function (err) {
      toast('PDF impossible : ' + err.message);
    });
  }

  /* ---------- Barre d'actions et thème ---------- */

  document.querySelector('.totals-actions').addEventListener('click', function (e) {
    var bt = e.target.closest('[data-global]');
    if (!bt) return;
    switch (bt.dataset.global) {
      case 'nouveau': nouveauReleve(); break;
      case 'chantiers': afficherChantiers(); dlg.showModal(); break;
      case 'pdf': exporterPdf(); break;
      case 'email': window.Envoi.ouvrir(state); break;
      case 'sauver': sauvegarder(); break;
    }
  });

  var THEMES = ['auto', 'light', 'dark'];
  var ICONES_THEME = {
    auto: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg>',
    light: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    dark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>'
  };
  var NOMS_THEME = { auto: 'automatique', light: 'clair', dark: 'sombre' };

  function appliquerTheme(t) {
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
    var b = document.getElementById('btn-theme');
    b.innerHTML = ICONES_THEME[t];
    b.setAttribute('aria-label', 'Thème ' + NOMS_THEME[t] + ' (changer)');
    b.title = 'Thème ' + NOMS_THEME[t];
  }

  var theme = 'auto';
  try { theme = localStorage.getItem(CLE_THEME) || 'auto'; } catch (e) { /* stockage indisponible */ }
  if (THEMES.indexOf(theme) < 0) theme = 'auto';
  appliquerTheme(theme);
  document.getElementById('btn-theme').addEventListener('click', function () {
    theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    try { localStorage.setItem(CLE_THEME, theme); } catch (e) { /* stockage indisponible */ }
    appliquerTheme(theme);
  });

  // Rappel avant de quitter avec des modifications non sauvegardées (le brouillon reste conservé).
  window.addEventListener('beforeunload', function () { ecrire(CLE_BROUILLON, state); });

  window.Entreprise.initialiser();
  window.Envoi.initialiser();

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(function () { /* hors ligne non disponible */ });
  }

  render();
})();
