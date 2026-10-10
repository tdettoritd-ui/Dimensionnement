/*
 * Génération du rapport PDF (jsPDF + autotable, intégrés dans vendor/ pour fonctionner hors ligne).
 */
(function (root) {
  'use strict';

  var D = root.Data;
  var C = root.Calc;
  var F = root.Fmt;

  var MARGE = 14; // mm
  var BAS = 16; // réserve pour le pied de page (mm)
  var BLEU = [15, 95, 140];
  var TEXTE = [23, 32, 42];
  var GRIS = [93, 107, 122];
  var FILET = [221, 226, 232];
  var CHAUD = [194, 65, 12];
  var FROID = [3, 105, 161];
  var COULEURS_ANAH = { bleu: [29, 78, 216], jaune: [161, 98, 7], violet: [126, 34, 206], rose: [190, 24, 93] };

  // Caractères de Windows-1252 au-delà de Latin-1, acceptés par les polices standard du PDF.
  var CP1252 = '\u20ac\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u017d' +
    '\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u017e\u0178';

  // Symboles du logiciel sans équivalent Windows-1252.
  var SYMBOLES = {
    '\u2194': '<->', '\u2192': '->', '\u2264': '<=', '\u2265': '>=', '\u2248': 'env.',
    '\u0394': 'Delta ', '\u03bb': 'lambda', '\u2212': '-'
  };

  // Lettres hors Windows-1252 courantes dans les noms propres.
  var TRANSLITTERATION = {
    '\u0142': 'l', '\u0141': 'L', '\u0131': 'i', '\u0111': 'd', '\u0110': 'D', '\u00df': 'ss'
  };

  // Remplace un caractère hors Windows-1252 : symbole, translittération, lettre sans accent, sinon « ? ».
  function remplacer(ch) {
    if (CP1252.indexOf(ch) >= 0) return ch;
    if (SYMBOLES[ch]) return SYMBOLES[ch];
    if (TRANSLITTERATION[ch]) return TRANSLITTERATION[ch];
    var base = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return /^[ -\u00ff]+$/.test(base) ? base : '?';
  }

  // Les polices standard du PDF ne couvrent que Windows-1252 : on adapte le texte.
  function t(s) {
    return String(s == null ? '' : s).normalize('NFC')
      .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufe00-\ufe0f\ufeff]/g, '') // caractères invisibles (copier-coller)
      .replace(/[\u00a0\u2009\u202f]/g, ' ')
      .replace(/[\ud800-\udbff][\udc00-\udfff]/g, '') // emoji : sans équivalent dans les polices du PDF
      .replace(/[^\u0000-\u00ff]/g, remplacer);
  }

  function nomFichier(state) {
    var LIGATURES = { '\u0153': 'oe', '\u0152': 'OE', '\u00e6': 'ae', '\u00c6': 'AE' };
    var client = (state.client.nom || '')
      .replace(/[\u0153\u0152\u00e6\u00c6\u0142\u0141\u0131\u0111\u0110\u00df]/g, function (ch) {
        return LIGATURES[ch] || TRANSLITTERATION[ch];
      })
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return ['Releve', client || 'client', state.client.date].filter(Boolean).join('_') + '.pdf';
  }

  function couleurTexte(doc, rgb) { doc.setTextColor(rgb[0], rgb[1], rgb[2]); }
  function couleurTrait(doc, rgb) { doc.setDrawColor(rgb[0], rgb[1], rgb[2]); }

  function police(doc, taille, gras, rgb) {
    doc.setFont('helvetica', gras ? 'bold' : 'normal');
    doc.setFontSize(taille);
    couleurTexte(doc, rgb || TEXTE);
  }

  function valeur(v) {
    return v === '' || v == null ? '—' : v;
  }

  function construire(state, ent, logo) {
    var doc = new root.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
    var LARG = doc.internal.pageSize.getWidth();
    var HAUT = doc.internal.pageSize.getHeight();
    var UTILE = LARG - 2 * MARGE;
    var res = C.calculChantier(state);
    var c = state.client;
    var k = state.climat;
    var ins = state.installation;
    var y = MARGE;

    function page() { return doc.getCurrentPageInfo().pageNumber; }

    function sautSiBesoin(hauteur) {
      if (y + hauteur > HAUT - BAS) {
        doc.addPage();
        y = MARGE;
      }
    }

    function stylesTableau(largeurLibelle) {
      return {
        theme: 'plain',
        margin: { left: MARGE, right: MARGE, top: MARGE, bottom: BAS },
        styles: {
          font: 'helvetica', fontSize: 8.5, textColor: TEXTE, overflow: 'linebreak',
          cellPadding: { top: 1.1, bottom: 1.1, left: 1.5, right: 1.5 },
          lineColor: FILET, lineWidth: { bottom: 0.2 }
        },
        columnStyles: { 0: { fontStyle: 'bold', textColor: [60, 70, 80], cellWidth: largeurLibelle } }
      };
    }

    // Tableau libellé / valeur, avec un titre au-dessus. Retourne { fin, page }.
    function tableauKV(titre, lignes, x, debut, largeur) {
      police(doc, 10.5, true, BLEU);
      doc.text(t(titre), x, debut + 4);
      var opts = stylesTableau(largeur * 0.4);
      opts.startY = debut + 6;
      opts.tableWidth = largeur;
      opts.margin.left = x;
      opts.margin.right = LARG - x - largeur;
      opts.body = lignes.map(function (l) { return [t(l[0]), t(valeur(l[1]))]; });
      doc.autoTable(opts);
      return { fin: doc.lastAutoTable.finalY, page: page() };
    }

    // Deux tableaux côte à côte, démarrant à la même hauteur.
    function paire(gauche, droite) {
      sautSiBesoin(75);
      var demi = (UTILE - 6) / 2;
      var depart = page();
      var a = tableauKV(gauche[0], gauche[1], MARGE, y, demi);
      doc.setPage(depart);
      var b = tableauKV(droite[0], droite[1], MARGE + demi + 6, y, demi);
      var fin = a.page > b.page ? a : b.page > a.page ? b : { fin: Math.max(a.fin, b.fin), page: a.page };
      doc.setPage(fin.page);
      y = fin.fin + 6;
    }

    /* --- En-tête entreprise --- */
    var hauteurEntete = 0;
    var largeurGauche = UTILE * 0.55;
    if (logo) {
      var lh = 28;
      var lw = lh * logo.w / logo.h;
      if (lw > 110) { lw = 110; lh = lw * logo.h / logo.w; }
      doc.addImage(logo.dataUrl, /^data:image\/png/.test(logo.dataUrl) ? 'PNG' : 'JPEG', MARGE, y, lw, lh);
      hauteurEntete = lh;
      largeurGauche = lw;
    } else {
      police(doc, 16, true, BLEU);
      doc.text(t(ent.nom), MARGE, y + 6);
      police(doc, 8.5, false, GRIS);
      var activite = doc.splitTextToSize(t(ent.activite), UTILE * 0.55);
      doc.text(activite, MARGE, y + 11);
      hauteurEntete = 9 + activite.length * 3.8;
    }
    // Coordonnées alignées à droite, coupées pour ne jamais chevaucher le logo.
    police(doc, 8.5, false, GRIS);
    var largeurDroite = Math.max(UTILE - largeurGauche - 6, 40);
    var coordonnees = [];
    [ent.adresse, ent.telephone, ent.email, ent.siret ? 'SIRET ' + ent.siret : ''].filter(Boolean).forEach(function (l) {
      coordonnees = coordonnees.concat(doc.splitTextToSize(t(l), largeurDroite));
    });
    coordonnees.forEach(function (l, i) {
      doc.text(l, LARG - MARGE, y + 4 + i * 4, { align: 'right' });
    });
    y += Math.max(hauteurEntete, coordonnees.length * 4 + 2) + 4;

    /* --- Titre --- */
    couleurTrait(doc, BLEU);
    doc.setLineWidth(0.6);
    doc.line(MARGE, y, LARG - MARGE, y);
    y += 7;
    police(doc, 15, true, BLEU);
    doc.text(t('Relevé technique – Pompe à chaleur / Climatisation'), MARGE, y);
    y += 6;
    police(doc, 9.5, false, TEXTE);
    var sousTitre = [
      c.nom || 'Client non renseigné',
      c.date ? 'relevé du ' + F.dateFr(c.date) : '',
      ent.technicien ? 'technicien : ' + ent.technicien : ''
    ].filter(Boolean).join(' · ');
    doc.text(doc.splitTextToSize(t(sousTitre), UTILE), MARGE, y);
    y += 7;

    /* --- Synthèse --- */
    var cartes = [
      { titre: 'Besoin de chauffage', valeur: F.kW(res.chauffage), detail: 'Palier PAC : ' + F.textePalierPac(res.palierChauffage), rgb: CHAUD },
      { titre: 'Besoin de climatisation', valeur: F.kW(res.climatisation), detail: 'Palier clim : ' + F.textePalierPac(res.palierClimatisation), rgb: FROID }
    ];
    if (res.anah) {
      cartes.push({ titre: 'Catégorie Anah', valeur: res.anah.categorie.label, detail: res.anah.categorie.detail, rgb: COULEURS_ANAH[res.anah.categorie.id] });
    }
    var ecart = 4;
    var lc = (UTILE - ecart * (cartes.length - 1)) / cartes.length;
    cartes.forEach(function (ca, i) {
      var x = MARGE + i * (lc + ecart);
      couleurTrait(doc, ca.rgb);
      doc.setLineWidth(0.5);
      doc.roundedRect(x, y, lc, 20, 2, 2, 'S');
      police(doc, 8, false, GRIS);
      doc.text(t(ca.titre), x + 3, y + 5);
      police(doc, 15, true, ca.rgb);
      doc.text(t(ca.valeur), x + 3, y + 12);
      police(doc, 8.5, false, TEXTE);
      doc.text(t(ca.detail), x + 3, y + 17);
    });
    y += 26;

    /* --- Informations générales --- */
    var u = C.uEnveloppe(k);
    paire(
      ['Client', [
        ['Nom', c.nom], ['Adresse', c.adresse], ['Téléphone', c.telephone], ['Email', c.email],
        ['Année de construction', c.annee], ['Chauffage actuel', c.generation ? F.libelle(D.GENERATIONS, c.generation) : '']
      ]],
      ['Prime Anah / MaPrimeRénov\'', [
        ['Personnes au foyer', state.prime.personnes],
        ['Revenu fiscal de réf.', C.estVide(state.prime.rfr) ? '' : F.euros(C.num(state.prime.rfr))],
        ['Zone', state.prime.zone === 'idf' ? 'Île-de-France' : 'Hors Île-de-France'],
        ['Catégorie', res.anah ? res.anah.categorie.label + ' – ' + res.anah.categorie.detail : '']
      ]]
    );
    paire(
      ['Climat / enveloppe', [
        ['Zone', F.libelle(D.ZONES, k.zone)],
        ['Base hiver / été', k.tBaseHiver + ' °C / ' + k.tBaseEte + ' °C'],
        ['Confort hiver / été', k.tConfortHiver + ' °C / ' + k.tConfortEte + ' °C'],
        ['Surpuissance de relance', (C.estVide(k.surpuissance) ? '0' : k.surpuissance) + ' %'],
        ['Murs', F.libelle(D.MURS, k.murType) + ' + ' + F.isolantTexte(k.isolantMur) + ' (U ' + F.nf(u.mur, 2) + ')'],
        ['Plancher bas', F.libelle(D.PLANCHERS, k.plancherType) + (k.plancherType !== 'aucun' ? ' + ' + F.isolantTexte(k.isolantPlancher) : '') + ' (U ' + F.nf(u.plancher, 2) + ')'],
        ['Toiture', F.libelle(D.TOITURES, k.toitureType) + (k.toitureType !== 'aucune' ? ' + ' + F.isolantTexte(k.isolantToiture) : '') + ' (U ' + F.nf(u.toiture, 2) + ')'],
        ['Ventilation', F.libelle(D.VENTILATIONS, k.ventilation)]
      ]],
      ['Installation', [
        ['Ballon tampon', F.texteOuiNon(ins.ballonTampon) + (ins.ballonTampon === 'oui' && ins.volumeTampon ? ' – ' + ins.volumeTampon + ' L' : '')],
        ['ECS', F.texteEcs(ins)],
        ['Électricité', ins.electrique === 'mono' ? 'Monophasé' : ins.electrique === 'tri' ? 'Triphasé' : ''],
        ['Régulation connectée', F.texteOuiNon(ins.regulation)],
        ['Mini tableau dédié', F.texteOuiNon(ins.miniTableau)],
        ['Distance UI ↔ UE', F.avecUnite(ins.distUiUe, 'm')],
        ['Distance UE ↔ tableau', F.avecUnite(ins.distUeTableau, 'm')],
        ['Distance UI ↔ tableau', F.avecUnite(ins.distUiTableau, 'm')],
        ['Condensats à proximité', F.texteOuiNon(ins.condensats)],
        ['Régime d\'eau radiateurs', ins.regimeEau ? F.libelle(D.REGIMES_EAU, ins.regimeEau) : '']
      ]]
    );

    /* --- Synthèse par pièce --- */
    sautSiBesoin(30);
    police(doc, 10.5, true, BLEU);
    doc.text(t('Synthèse par pièce'), MARGE, y + 4);
    var surfaceTotale = 0;
    var lignesPieces = state.pieces.map(function (p, i) {
      var r = res.pieces[i];
      surfaceTotale += r.surface;
      var ex = r.radiateurExistant;
      return [
        t(p.nom), t(F.nf(r.surface, 1) + ' m²'), t(F.W(r.chauffage)), t(F.W(r.climatisation)),
        t(F.textePalierRadiateur(r.radiateurNeuf)),
        t(ex ? F.W(ex.puissance) + (ex.suffisant ? ' – suffisant' : ' – insuffisant') : '—')
      ];
    });
    doc.autoTable({
      startY: y + 6,
      margin: { left: MARGE, right: MARGE, top: MARGE, bottom: BAS },
      theme: 'grid',
      head: [['Pièce', 'Surface', 'Chauffage', 'Climatisation', 'Radiateur neuf', 'Radiateur existant'].map(t)],
      body: lignesPieces,
      showFoot: 'lastPage',
      foot: [[t('Total'), t(F.nf(surfaceTotale, 1) + ' m²'), t(F.kW(res.chauffage)), t(F.kW(res.climatisation)), '', '']],
      styles: { font: 'helvetica', fontSize: 8.5, textColor: TEXTE, lineColor: FILET, lineWidth: 0.2, cellPadding: 1.5 },
      headStyles: { fillColor: BLEU, textColor: 255, fontStyle: 'bold' },
      footStyles: { fillColor: [238, 243, 247], textColor: TEXTE, fontStyle: 'bold' },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } }
    });
    y = doc.lastAutoTable.finalY + 7;

    /* --- Détail des pièces --- */
    var LARGEUR_LIBELLE = 48;

    // Hauteur estimée d'un bloc pièce (titre + lignes), pour ne pas le couper en bas de page.
    function hauteurBloc(nom, lignes) {
      police(doc, 8.5, false, TEXTE);
      var h = 0;
      lignes.forEach(function (l) {
        var n = 0;
        l[1].split('\n').forEach(function (seg) { n += doc.splitTextToSize(seg, UTILE - LARGEUR_LIBELLE - 3).length; });
        n = Math.max(n, doc.splitTextToSize(l[0], LARGEUR_LIBELLE - 3).length);
        h += n * 3.6 + 2.4;
      });
      police(doc, 10, true, TEXTE);
      return h + doc.splitTextToSize(nom, LARGEUR_LIBELLE - 3).length * 4.3 + 3;
    }

    state.pieces.forEach(function (p, i) {
      var r = res.pieces[i];
      var vitrages = F.lignesVitrages(p, r);
      var lignes = [
        ['Dimensions', (p.longueur || '?') + ' × ' + (p.largeur || '?') + ' × ' + (p.hauteur || '?') + ' m · ' + F.nf(r.surface, 1) + ' m² · ' + F.nf(r.volume, 1) + ' m³'],
        ['Murs ext. exposés', (F.avecUnite(p.lineaire, 'ml') || '—') + ' · sous toiture : ' + F.texteOuiNon(p.sousToiture) +
          ' · sur plancher bas : ' + F.texteOuiNon(p.surPlancherBas)],
        ['Vitrages', vitrages.length ? vitrages.join('\n') : '—'],
        ['Occupants / équipements', (p.occupants || '0') + ' (' + F.libelle(D.ACTIVITES, p.activite) + ') · ' + (p.equipements || '0') + ' W'],
        ['Ventilation', F.nf(r.debit, 1) + ' m³/h' + (r.debitAuto ? ' (estimé)' : '')],
        ['Déperditions G', F.nf(r.G, 2) + ' W/K · base ' + F.W(r.chauffageBase) + ' + relance ' + F.nf(r.surpuissance) + ' %'],
        ['Radiateur neuf préconisé', F.textePalierRadiateur(r.radiateurNeuf) +
          (r.facteurRegime !== 1 && r.radiateurNeuf.valeur ? ' (catalogue ΔT50, régime ' + ins.regimeEau + ' °C)' : '')],
        ['Radiateur existant', F.texteRadiateurExistant(p, r, ins.regimeEau)]
      ].map(function (l) { return [t(l[0]), t(l[1])]; });
      var nom = t(p.nom);
      sautSiBesoin(Math.min(hauteurBloc(nom, lignes) * 1.1, HAUT - BAS - MARGE - 2));

      // Le titre de la pièce est l'en-tête du tableau : répété si le bloc déborde sur la page suivante,
      // et contenu dans sa colonne (un nom long passe à la ligne au lieu de chevaucher les puissances).
      var opts = stylesTableau(LARGEUR_LIBELLE);
      opts.startY = y;
      opts.head = [[nom, {
        content: t(F.kW(r.chauffage) + ' chauffage · ' + F.kW(r.climatisation) + ' clim'),
        styles: { halign: 'right', fontStyle: 'normal', fontSize: 8.5 }
      }]];
      opts.headStyles = { fillColor: [238, 243, 247], textColor: TEXTE, fontStyle: 'bold', fontSize: 10, lineWidth: 0 };
      opts.showHead = 'everyPage';
      opts.rowPageBreak = 'avoid';
      opts.body = lignes;
      doc.autoTable(opts);
      y = doc.lastAutoTable.finalY + 6;
    });

    /* --- Mentions --- */
    var mentions = 'Dimensionnement indicatif établi par méthode simplifiée à partir des relevés effectués sur place. ' +
      'Puissances des radiateurs existants : valeurs indicatives à ΔT50, à recouper avec la documentation du fabricant. ' +
      'Plafonds Anah ' + D.ANAH.annee + ' : à vérifier lors du dépôt du dossier. Document établi le ' + new Date().toLocaleDateString('fr-FR') + '.';
    police(doc, 7.5, false, GRIS);
    var lignesMentions = doc.splitTextToSize(t(mentions), UTILE);
    sautSiBesoin(lignesMentions.length * 3.4 + 2);
    doc.text(lignesMentions, MARGE, y + 2);

    /* --- Pied de page --- */
    var n = doc.getNumberOfPages();
    for (var pg = 1; pg <= n; pg++) {
      doc.setPage(pg);
      couleurTrait(doc, FILET);
      doc.setLineWidth(0.3);
      doc.line(MARGE, HAUT - 11, LARG - MARGE, HAUT - 11);
      police(doc, 7.5, false, GRIS);
      doc.text(t([ent.nom, 'Relevé ' + (c.nom || '')].filter(Boolean).join(' – ')), MARGE, HAUT - 7);
      doc.text('Page ' + pg + ' / ' + n, LARG - MARGE, HAUT - 7, { align: 'right' });
    }

    return { blob: doc.output('blob'), nom: nomFichier(state) };
  }

  function disponible() {
    return !!(root.jspdf && root.jspdf.jsPDF && root.jspdf.jsPDF.API && root.jspdf.jsPDF.API.autoTable);
  }

  // Résout { blob, nom } : le PDF du relevé, avec le logo et les coordonnées de l'entreprise.
  function generer(state) {
    if (!disponible()) return Promise.reject(new Error('Bibliothèque PDF non chargée'));
    return root.Entreprise.logo().then(function (logo) {
      return construire(state, root.Entreprise.get(), logo);
    });
  }

  function telecharger(fichier) {
    var url = URL.createObjectURL(fichier.blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = fichier.nom;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  root.Rapport = {
    generer: generer,
    telecharger: telecharger,
    disponible: disponible
  };
})(this);
