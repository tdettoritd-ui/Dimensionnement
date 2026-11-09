/*
 * Plans du dossier client : photos et fichiers (images, PDF) stockés sur l'appareil (IndexedDB).
 * Le relevé ne garde que leur description { id, nom, type, taille } ; les fichiers sont trop lourds
 * pour le stockage du relevé. Les photos sont réduites (2000 px, JPEG) avant d'être enregistrées.
 */
(function (root) {
  'use strict';

  var BASE = 'dimclim-fichiers';
  var MAGASIN = 'plans';
  var COTE_MAX = 2000; // px : largeur ou hauteur maximale des images enregistrées
  var QUALITE = 0.85;

  var connexion = null;

  function base() {
    if (connexion) return connexion;
    connexion = new Promise(function (ok, ko) {
      if (!root.indexedDB) { ko(new Error('stockage des fichiers indisponible sur ce navigateur')); return; }
      var req = root.indexedDB.open(BASE, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(MAGASIN); };
      req.onsuccess = function () { ok(req.result); };
      req.onerror = function () { ko(req.error || new Error('stockage des fichiers indisponible')); };
    });
    connexion.catch(function () { connexion = null; });
    return connexion;
  }

  function operation(mode, action) {
    return base().then(function (db) {
      return new Promise(function (ok, ko) {
        var tx = db.transaction(MAGASIN, mode);
        var req = action(tx.objectStore(MAGASIN));
        tx.oncomplete = function () { ok(req && req.result); };
        tx.onerror = tx.onabort = function () { ko(tx.error || new Error('écriture impossible (stockage plein ?)')); };
      });
    });
  }

  function identifiant() {
    return 'plan-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // Image réduite au plus COTE_MAX px, en JPEG ; renvoie le fichier d'origine si la réduction échoue.
  function reduire(fichier) {
    if (!/^image\//.test(fichier.type) || !root.createImageBitmap) return Promise.resolve(fichier);
    return root.createImageBitmap(fichier).then(function (img) {
      var echelle = Math.min(1, COTE_MAX / Math.max(img.width, img.height));
      var canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * echelle);
      canvas.height = Math.round(img.height * echelle);
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; // fond blanc pour les PNG transparents
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return new Promise(function (ok) {
        canvas.toBlob(function (b) { ok(b && b.size < fichier.size ? b : fichier); }, 'image/jpeg', QUALITE);
      });
    }).catch(function () { return fichier; });
  }

  // Enregistre un fichier choisi ; résout sa description pour le relevé.
  function ajouter(fichier) {
    return reduire(fichier).then(function (contenu) {
      var id = identifiant();
      return operation('readwrite', function (s) { return s.put(contenu, id); }).then(function () {
        return {
          id: id,
          nom: String(fichier.name || 'Plan').replace(/\.[a-z0-9]+$/i, ''),
          type: contenu.type || fichier.type || '',
          taille: contenu.size
        };
      });
    });
  }

  function lire(id) {
    return operation('readonly', function (s) { return s.get(id); });
  }

  function supprimer(id) {
    return operation('readwrite', function (s) { return s.delete(id); });
  }

  function estImage(plan) {
    return /^image\//.test(plan.type);
  }

  // Image en data URL avec ses dimensions, pour l'intégrer au PDF.
  function imagePourPdf(plan) {
    return lire(plan.id).then(function (blob) {
      if (!blob) return null;
      return new Promise(function (ok) {
        var lecteur = new FileReader();
        lecteur.onload = function () {
          var img = new Image();
          img.onload = function () { ok({ nom: plan.nom, dataUrl: lecteur.result, w: img.naturalWidth, h: img.naturalHeight }); };
          img.onerror = function () { ok(null); };
          img.src = lecteur.result;
        };
        lecteur.onerror = function () { ok(null); };
        lecteur.readAsDataURL(blob);
      });
    }).catch(function () { return null; });
  }

  root.Plans = {
    ajouter: ajouter,
    lire: lire,
    supprimer: supprimer,
    estImage: estImage,
    imagePourPdf: imagePourPdf
  };
})(this);
