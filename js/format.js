/*
 * Mise en forme partagée (écran, PDF, email) : nombres, libellés, descriptions textuelles.
 */
(function (root) {
  'use strict';

  var D = root.Data;
  var C = root.Calc;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function nf(v, dec) {
    return v.toLocaleString('fr-FR', { minimumFractionDigits: dec || 0, maximumFractionDigits: dec || 0 });
  }

  function kW(w) { return nf(w / 1000, 2) + ' kW'; }
  function W(w) { return nf(Math.round(w)) + ' W'; }
  function euros(v) { return nf(Math.round(v)) + ' €'; }

  function libelle(table, id) {
    var e = D.find(table, id);
    return e ? e.label : '—';
  }

  function libelleOrientation(id) {
    return id === D.ORIENTATION_MIXTE.id ? D.ORIENTATION_MIXTE.label : libelle(D.ORIENTATIONS, id);
  }

  function texteOuiNon(v) {
    return v === 'oui' ? 'Oui' : v === 'non' ? 'Non' : '—';
  }

  function textePalierPac(p) {
    if (p.depasse) return 'Étude multi-splits';
    return p.valeur === null ? '—' : nf(p.valeur, p.valeur % 1 ? 1 : 0) + ' kW';
  }

  function palierBarre(p) {
    return p.depasse ? textePalierPac(p) : 'Palier ' + textePalierPac(p);
  }

  function textePalierSplit(p) {
    if (p.depasse) return 'Plusieurs unités';
    return p.valeur === null ? '—' : nf(p.valeur, p.valeur % 1 ? 1 : 0) + ' kW';
  }

  // Radiateur neuf du catalogue ; court : pour une colonne de tableau.
  function textePalierRadiateur(p, court) {
    if (p.depasse) return 'Plusieurs émetteurs';
    if (p.valeur === null) return '—';
    if (!p.modele) return W(p.valeur);
    var m = p.modele;
    var n = p.nombre > 1 ? p.nombre + ' × ' : '';
    if (court) return n + 'T' + m.type + ' ' + m.hauteur + '×' + m.largeur;
    return n + 'Type ' + m.type + ' · H ' + m.hauteur + ' × L ' + m.largeur + ' mm – ' + W(m.p50) + (p.nombre > 1 ? ' chacun' : '') + ' (ΔT50) · réf. ' + m.ref;
  }

  function dateFr(iso) {
    if (!iso) return '';
    var d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
    return isNaN(d) ? iso : d.toLocaleDateString('fr-FR');
  }

  function avecUnite(v, u) {
    return C.estVide(v) ? '' : v + ' ' + u;
  }

  function isolantTexte(iso) {
    var m = D.find(D.ISOLANTS, iso.materiau);
    if (!m || !m.lambda) return 'Aucun isolant';
    return m.label + ' ' + (C.estVide(iso.epaisseur) ? '(épaisseur non saisie)' : iso.epaisseur + ' cm');
  }

  function texteEcs(ins) {
    var ecs = ins.ecsPac === 'oui' ? 'Par la PAC'
      : ins.ecsPac === 'non' ? (ins.ballonThermo === 'oui' ? 'Ballon thermodynamique' : ins.ballonThermo === 'non' ? 'Autre (hors PAC / thermo.)' : 'Hors PAC')
        : '';
    if (ecs && ins.ecsEmplacement && (ins.ecsPac === 'oui' || ins.ballonThermo === 'oui')) {
      ecs += ' – ' + (ins.ecsEmplacement === 'integre' ? 'intégré' : 'déporté');
    }
    return ecs;
  }

  // Une ligne par vitrage ; en saisie rapide, le niveau choisi et la surface estimée.
  function lignesVitrages(piece, resultat) {
    if (piece.vitrageMode === 'rapide') {
      var g = piece.vitrageRapide;
      var niveau = D.find(D.NIVEAUX_VITRAGE, g.niveau);
      return [(niveau ? niveau.label + ' (' + nf(niveau.ratio * 100) + ' % du sol)' : 'Saisie rapide') +
        ' · ' + libelleOrientation(g.orientation) + ' · ' + libelle(D.VITRAGES, g.type) +
        ' · ≈ ' + nf(resultat.surfaceVitree, 1) + ' m²' + (g.volet === 'oui' ? ' · volets' : '')];
    }
    return piece.vitrages.map(function (v) {
      return libelleOrientation(v.orientation) + ' · ' + libelle(D.VITRAGES, v.type) + ' · ' + (v.surface || '0') + ' m²' + (v.volet === 'oui' ? ' · volet' : '');
    });
  }

  function texteRadiateurExistant(piece, resultat, regimeEau) {
    var ex = resultat.radiateurExistant;
    if (!ex) return '—';
    var radiateurs = C.radiateursPiece(piece);
    var puissance = function (catalogue, reelle) {
      return resultat.facteurRegime !== 1 ? W(catalogue) + ' à ΔT50, soit ' + W(reelle) + ' en ' + regimeEau + ' °C' : W(reelle);
    };
    // Une ligne par radiateur, puis le total s'il y en a plusieurs.
    var lignes = ex.detail.map(function (d) {
      var pr = radiateurs[d.index];
      var desc = pr.materiau === 'acier'
        ? 'Acier ' + libelle(D.RADIATEURS_ACIER, pr.typeAcier) + ' ' + (pr.hauteur || '?') + ' × ' + (pr.longueur || '?') + ' cm'
        : libelle(D.MATERIAUX_RADIATEUR, pr.materiau) + ' ' + (pr.elements || '0') + ' élts de ' + pr.hauteurElement + ' mm';
      return desc + ' → ' + puissance(d.puissanceCatalogue, d.puissance);
    });
    if (lignes.length > 1) lignes.push('Total ' + lignes.length + ' radiateurs → ' + puissance(ex.puissanceCatalogue, ex.puissance));
    return lignes.join('\n') + ' · ' + (ex.suffisant ? 'Suffisant' : 'Insuffisant (manque ' + W(ex.manque) + ')');
  }

  // Département, altitude et côte (température de base de l'annexe nationale), sinon l'ancienne zone.
  function texteLocalisation(climat) {
    var dep = D.find(D.DEPARTEMENTS, climat.departement);
    if (!dep) return libelle(D.ZONES, climat.zone);
    var tb = C.temperatureBase(climat);
    return dep.label + (C.num(climat.altitude) > 0 ? ', ' + nf(C.num(climat.altitude)) + ' m' : '') +
      (climat.cote === 'oui' ? ', côte < 25 km' : '') + (tb ? ' (base ' + tb.t + ' °C)' : '');
  }

  // Revêtement intérieur des murs ; contre-cloison agglo avec son épaisseur et ce qu'il y a derrière.
  function texteRevetement(climat) {
    var texte = libelle(D.REVETEMENTS_MUR, climat.revetementMur).toLowerCase();
    if (climat.revetementMur !== 'agglo') return texte;
    var c = C.contreCloison(climat);
    var derriere = c.entre === 'air' ? 'lame d\'air ' + nf(c.lame, c.lame % 1 ? 1 : 0) + ' cm'
      : c.entre === 'isolant' ? isolantTexte(c.isolant).toLowerCase() : 'collée au mur';
    return texte + ' ' + nf(c.epaisseur, c.epaisseur % 1 ? 1 : 0) + ' cm, ' + derriere + ' (R ' + nf(C.rRevetement(climat), 2) + ')';
  }

  // Type d'isolation des murs (ponts thermiques), tel que renvoyé par Calc.isolationMur.
  var LIBELLES_ISOLATION = {
    non_isole: 'murs non isolés', iti: 'ITI', ite: 'ITE', itr: 'isolation répartie',
    iti_itr: 'ITI sur isolation répartie', ite_itr: 'ITE sur isolation répartie', mixte: 'isolations des murs différentes'
  };

  root.Fmt = {
    LIBELLES_ISOLATION: LIBELLES_ISOLATION,
    esc: esc,
    nf: nf,
    kW: kW,
    W: W,
    euros: euros,
    libelle: libelle,
    libelleOrientation: libelleOrientation,
    texteOuiNon: texteOuiNon,
    textePalierPac: textePalierPac,
    palierBarre: palierBarre,
    textePalierRadiateur: textePalierRadiateur,
    textePalierSplit: textePalierSplit,
    dateFr: dateFr,
    avecUnite: avecUnite,
    isolantTexte: isolantTexte,
    texteEcs: texteEcs,
    lignesVitrages: lignesVitrages,
    texteRadiateurExistant: texteRadiateurExistant,
    texteRevetement: texteRevetement,
    texteLocalisation: texteLocalisation
  };
})(this);
