/*
 * Synchronisation des chantiers entre appareils (Supabase : connexion par email + mot de passe,
 * table « chantiers », voir supabase/schema.sql).
 *
 * Principe : l'appareil reste la source de travail (tout fonctionne hors ligne). Quand le réseau
 * et la connexion sont là, on récupère les chantiers modifiés ailleurs, puis on envoie ceux
 * sauvegardés ici. En cas de conflit, la sauvegarde la plus récente l'emporte.
 * Une entrée locale porte « envoye: true » quand le serveur en a la même version ; les chantiers
 * déjà présents sur l'appareil avant la synchronisation n'ont pas ce champ et partent au premier envoi.
 * Une suppression laisse une trace locale (« pierre tombale ») jusqu'à ce que le serveur l'ait reçue.
 */
(function (root) {
  'use strict';

  /* ---------- Fusion (fonction pure, testée) ---------- */

  function t(d) { var v = Date.parse(d); return isNaN(v) ? 0 : v; }

  // locaux : [{ id, savedAt, data, envoye }] ; distants : [{ id, data, saved_at, deleted }] ;
  // suppressions : [{ id, at }]. Rend { locaux, modifies: [ids changés localement] }.
  function fusionner(locaux, distants, suppressions) {
    var liste = locaux.slice();
    var modifies = [];
    var tombes = {};
    (suppressions || []).forEach(function (s) { tombes[s.id] = t(s.at); });

    distants.forEach(function (row) {
      var tr = t(row.saved_at);
      var i = -1;
      for (var k = 0; k < liste.length; k++) if (liste[k].id === row.id) { i = k; break; }
      var loc = i >= 0 ? liste[i] : null;
      var tl = loc ? t(loc.savedAt) : 0;

      if (row.deleted) {
        // Supprimé ailleurs : on supprime ici, sauf si on l'a resauvegardé après la suppression.
        if (loc && !(loc.envoye !== true && tl > tr)) { liste.splice(i, 1); modifies.push(row.id); }
        return;
      }
      if (row.id in tombes && tombes[row.id] >= tr) return; // supprimé ici, suppression pas encore envoyée
      if (!loc) {
        liste.push({ id: row.id, savedAt: new Date(tr).toISOString(), data: row.data, envoye: true });
        modifies.push(row.id);
      } else if (tr > tl) {
        liste[i] = { id: row.id, savedAt: new Date(tr).toISOString(), data: row.data, envoye: true };
        modifies.push(row.id);
      } else if (tr === tl && loc.envoye !== true) {
        liste[i] = Object.assign({}, loc, { envoye: true });
      }
    });

    liste.sort(function (a, b) { return t(b.savedAt) - t(a.savedAt); });
    return { locaux: liste, modifies: modifies };
  }

  var api = { fusionner: fusionner };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }

  /* ---------- Accès au serveur ---------- */

  var CFG = root.CONFIG_SYNCHRO || {};
  var URL_BASE = String(CFG.url || '').replace(/\/+$/, '');
  var CLE_API = String(CFG.cle || '');
  var CLE_SESSION = 'dimclim.session';
  var CLE_SUPPR = 'dimclim.suppressions';
  var CLE_CURSEUR = 'dimclim.synchro.curseur';
  var CLE_DERNIERE = 'dimclim.synchro.derniere';
  var RECOUVREMENT = 2 * 60 * 1000; // relit 2 min en arrière : rien n'est manqué si deux appareils écrivent en même temps

  function lire(cle, defaut) { try { var v = localStorage.getItem(cle); return v ? JSON.parse(v) : defaut; } catch (e) { return defaut; } }
  function ecrire(cle, v) { try { if (v == null) localStorage.removeItem(cle); else localStorage.setItem(cle, JSON.stringify(v)); return true; } catch (e) { return false; } }

  var hooks = null;
  var session = lire(CLE_SESSION, null);
  var etat = { configure: !!(URL_BASE && CLE_API), connecte: !!session, email: session ? session.email : '', enCours: false, derniere: lire(CLE_DERNIERE, 0), erreur: '' };

  function signaler() { if (hooks && hooks.etat) hooks.etat(Object.assign({}, etat)); }

  function erreur(code, message) { var e = new Error(message); e.code = code; return e; }

  function appel(chemin, options) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return Promise.reject(erreur('hors_ligne', 'Pas de réseau'));
    return fetch(URL_BASE + chemin, options).catch(function () { throw erreur('hors_ligne', 'Serveur injoignable'); });
  }

  function enregistrerSession(r) {
    session = {
      access: r.access_token,
      refresh: r.refresh_token,
      expire: Date.now() + (r.expires_in || 3600) * 1000,
      email: (r.user && r.user.email) || (session && session.email) || ''
    };
    ecrire(CLE_SESSION, session);
    etat.connecte = true; etat.email = session.email;
  }

  function finSession() {
    session = null; ecrire(CLE_SESSION, null);
    etat.connecte = false; etat.email = '';
  }

  function jeton(forcer) {
    if (!session) return Promise.reject(erreur('deconnecte', 'Non connecté'));
    if (!forcer && session.expire - 60000 > Date.now()) return Promise.resolve(session.access);
    return appel('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      headers: { apikey: CLE_API, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refresh })
    }).then(function (r) {
      if (r.status === 400 || r.status === 401 || r.status === 403) { finSession(); throw erreur('deconnecte', 'Session expirée : reconnecte-toi'); }
      if (!r.ok) throw erreur('serveur', 'Erreur serveur (' + r.status + ')');
      return r.json().then(function (j) { enregistrerSession(j); return session.access; });
    });
  }

  function rest(chemin, options, deja) {
    return jeton(false).then(function (tk) {
      var h = Object.assign({ apikey: CLE_API, Authorization: 'Bearer ' + tk, 'Content-Type': 'application/json' }, options.headers || {});
      return appel('/rest/v1/' + chemin, Object.assign({}, options, { headers: h }));
    }).then(function (r) {
      if (r.status === 401 && !deja) return jeton(true).then(function () { return rest(chemin, options, true); });
      if (!r.ok) return r.text().then(function (txt) { throw erreur('serveur', 'Erreur serveur (' + r.status + ') ' + txt.slice(0, 120)); });
      return r.status === 204 ? null : r.text().then(function (txt) { return txt ? JSON.parse(txt) : null; });
    });
  }

  /* ---------- Connexion ---------- */

  function connecter(email, motDePasse) {
    if (!etat.configure) return Promise.reject(erreur('config', 'Synchronisation non configurée'));
    return appel('/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { apikey: CLE_API, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: String(email).trim(), password: motDePasse })
    }).then(function (r) {
      if (r.status === 400 || r.status === 401) throw erreur('identifiants', 'Email ou mot de passe incorrect');
      if (!r.ok) throw erreur('serveur', 'Connexion impossible (' + r.status + ')');
      return r.json();
    }).then(function (j) {
      enregistrerSession(j);
      ecrire(CLE_CURSEUR, null); // première synchro de cet appareil : tout relire
      etat.erreur = '';
      signaler();
      return synchroniser();
    });
  }

  function deconnecter() {
    finSession();
    etat.erreur = '';
    signaler();
  }

  /* ---------- Synchronisation ---------- */

  var relancer = false;

  function synchroniser() {
    if (!etat.configure || !session || !hooks) return Promise.resolve(null);
    if (etat.enCours) { relancer = true; return Promise.resolve(null); }
    etat.enCours = true; signaler();

    var curseur = lire(CLE_CURSEUR, null);
    var filtre = curseur ? '&updated_at=gt.' + encodeURIComponent(new Date(t(curseur) - RECOUVREMENT).toISOString()) : '';
    var bilan = { recus: [], envoyes: 0 };

    return rest('chantiers?select=id,data,saved_at,deleted,updated_at&order=updated_at.asc&limit=1000' + filtre, { method: 'GET' })
      .then(function (rows) {
        rows = rows || [];
        var f = fusionner(hooks.lireChantiers(), rows, lire(CLE_SUPPR, []));
        hooks.ecrireChantiers(f.locaux);
        bilan.recus = f.modifies;
        if (rows.length) ecrire(CLE_CURSEUR, rows[rows.length - 1].updated_at);

        // Envoi des chantiers sauvegardés ici et pas encore sur le serveur.
        var aEnvoyer = f.locaux.filter(function (c) { return c.envoye !== true; });
        var suppr = lire(CLE_SUPPR, []);
        var lignes = aEnvoyer.map(function (c) { return { id: c.id, data: c.data, saved_at: c.savedAt, deleted: false }; })
          .concat(suppr.map(function (s) { return { id: s.id, data: null, saved_at: s.at, deleted: true }; }));
        if (!lignes.length) return null;
        return rest('chantiers?on_conflict=id', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify(lignes)
        }).then(function () {
          var envoyes = {};
          aEnvoyer.forEach(function (c) { envoyes[c.id] = c.savedAt; });
          // Ne marque « envoyé » que ce qui n'a pas été resauvegardé pendant l'envoi.
          hooks.ecrireChantiers(hooks.lireChantiers().map(function (c) {
            return envoyes[c.id] === c.savedAt ? Object.assign({}, c, { envoye: true }) : c;
          }));
          var faits = {};
          suppr.forEach(function (s) { faits[s.id] = s.at; });
          ecrire(CLE_SUPPR, lire(CLE_SUPPR, []).filter(function (s) { return faits[s.id] !== s.at; }));
          bilan.envoyes = lignes.length;
        });
      })
      .then(function () {
        etat.derniere = Date.now(); ecrire(CLE_DERNIERE, etat.derniere);
        etat.erreur = '';
        return bilan;
      }, function (e) {
        etat.erreur = e.code === 'hors_ligne' ? 'hors ligne' : e.message;
        if (e.code === 'deconnecte') etat.connecte = false;
        return null;
      })
      .then(function (b) {
        etat.enCours = false;
        signaler();
        if (b && b.recus.length && hooks.recus) hooks.recus(b.recus);
        if (relancer) { relancer = false; planifier(); }
        return b;
      });
  }

  var minuterie = null;
  function planifier() {
    clearTimeout(minuterie);
    minuterie = setTimeout(synchroniser, 400);
  }

  // Note une suppression faite ici, pour la transmettre aux autres appareils.
  function supprimer(id) {
    if (!etat.configure) return;
    var s = lire(CLE_SUPPR, []).filter(function (x) { return x.id !== id; });
    s.push({ id: id, at: new Date().toISOString() });
    ecrire(CLE_SUPPR, s);
    planifier();
  }

  function initialiser(h) {
    hooks = h;
    signaler();
    if (!etat.configure) return;
    window.addEventListener('online', planifier);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') planifier(); });
    setInterval(function () { if (document.visibilityState === 'visible') synchroniser(); }, 60000);
    planifier();
  }

  api.initialiser = initialiser;
  api.connecter = connecter;
  api.deconnecter = deconnecter;
  api.synchroniser = synchroniser;
  api.planifier = planifier;
  api.supprimer = supprimer;
  api.etat = function () { return Object.assign({}, etat); };
  root.Sync = api;
})(this);
