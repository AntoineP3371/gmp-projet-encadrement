(function () {
  'use strict';
  const PE = window.PE;
  const U = PE.util;
  const S = PE.scheduler;

  const fmtH = (h) => (Math.round(h * 100) / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' h';
  const hoursOf = (ms) => ms / 3600000;

  /* free sub-intervals of a coverage result -> "13:00–15:00, 16:00–17:00" */
  function fmtSlots(free) {
    if (!free || !free.length) return '';
    return free.map((iv) => U.fmtTime(iv.start) + '–' + U.fmtTime(iv.end)).join(', ');
  }

  /* Deux intitules "correspondent" quand, decoupes sur les tirets (- – —), ils
     portent exactement les memes segments — quel que soit leur ordre, casse et
     espaces superflus ignores. Ex. "SAE 2A - PROJET_S3 - S3:4 - P4" correspond a
     "P4 - S3:4 - PROJET_S3 - SAE 2A". */
  function sameLabelSegments(a, b) {
    const seg = (str) => String(str || '')
      .split(/[-–—]/)
      .map((x) => x.trim().replace(/\s+/g, ' ').toLowerCase())
      .filter(Boolean)
      .sort();
    const A = seg(a);
    const B = seg(b);
    if (!A.length || A.length !== B.length) return false;
    return A.every((x, i) => x === B[i]);
  }

  /* La seance de projet figure-t-elle telle quelle dans l'agenda de l'encadrant ?
     Il faut a la fois le MEME INTITULE (memes segments entre tirets, ordre libre)
     ET un recouvrement horaire des deux evenements. Cas typique : le meme cours
     est publie sur le calendrier du projet ET sur celui de l'enseignant. */
  function teacherHasSessionInAgenda(t, s) {
    if (!t || !t.events || !t.events.length) return false;
    const sS = +new Date(s.start);
    const sE = +new Date(s.end);
    return t.events.some((e) => {
      if (!e || e.allDay) return false;
      const eS = +new Date(e.start);
      const eE = +new Date(e.end);
      if (!(eS < sE && eE > sS)) return false;        // recouvrement horaire
      return sameLabelSegments(s.label, e.summary);   // memes segments d'intitule
    });
  }

  const teachersModel = PE.teacherModels;
  const schedOptions = PE.schedOptions;

  function projectsModel() {
    return PE.sourcesOfType('project').filter((s) => s.enabled !== false);
  }

  function setNoSup(sid, on) {
    const sch = PE.state.scheduling;
    sch.noSup = sch.noSup || {};
    if (on) {
      sch.noSup[sid] = true;
      if (sch.locked[sid]) delete sch.locked[sid];
      const a = ensureAssignments();
      a[sid] = [];
    } else {
      delete sch.noSup[sid];
    }
  }

  const ensureAssignments = PE.assignments;

  function lock(sid, tid) {
    const L = PE.state.scheduling.locked;
    L[sid] = L[sid] || [];
    if (L[sid].indexOf(tid) === -1) L[sid].push(tid);
  }
  function unlock(sid, tid) {
    const L = PE.state.scheduling.locked;
    if (L[sid]) L[sid] = L[sid].filter((x) => x !== tid);
  }

  function render(root) {
    const sch = PE.state.scheduling;
    const o = sch.options;
    const view = ['session', 'project', 'teacher'].indexOf(sch.view) !== -1 ? sch.view : 'session';
    const T = teachersModel();
    const projects = projectsModel();
    const sessions = PE.sessions();
    const toMoveSet = sch.toMove || {};
    const byTeacher = {};
    T.forEach((t) => { byTeacher[t.id] = t; });

    const assignments = ensureAssignments();
    Object.keys(assignments).forEach((k) => { if (!sessions.find((s) => s.id === k)) delete assignments[k]; });

    const ev = S.evaluate(sessions, T, schedOptions(), assignments);

    const busyMap = {};
    T.forEach((t) => { busyMap[t.id] = S.teacherBusy(t.events, o.allDayBusy); });
    const ivsMap = {};
    T.forEach((t) => { ivsMap[t.id] = []; });
    sessions.forEach((s) => {
      (assignments[s.id] || []).forEach((tid) => {
        if (ivsMap[tid]) ivsMap[tid].push({ start: +new Date(s.start), end: +new Date(s.end), sid: s.id });
      });
    });
    function covFor(tid, s) {
      const sMs = { start: +new Date(s.start), end: +new Date(s.end) };
      const other = (ivsMap[tid] || []).filter((iv) => iv.sid !== s.id);
      return S.coverage(busyMap[tid] || [], other, sMs);
    }
    const idgOf = (tid, s) => S.indispoDegree((byTeacher[tid] && byTeacher[tid].indispo) || [], s);

    // per (project, teacher) : sessions affected + sessions the teacher is
    // available for (complete vs partial coverage, team membership ignored ;
    // a hard "indisponible" half-day counts as unavailable).
    const pairCount = {};
    const pairAvail = {};
    projects.forEach((p) => {
      const ps = sessions.filter((s) => s.projectId === p.id);
      T.forEach((t) => {
        let full = 0;
        let part = 0;
        ps.forEach((s) => {
          if (idgOf(t.id, s) === 2) return;
          const c = covFor(t.id, s);
          if (c.frac >= 1 - 1e-9) full++;
          else if (c.frac > 1e-9) part++;
        });
        pairAvail[p.id + '::' + t.id] = { full: full, part: part };
      });
    });
    // pairCount = nb de seances affectees ; pairHours = heures reellement
    // encadrees, comptees a l'heure pres (couverture partielle -> heures reelles).
    const pairHours = {};
    sessions.forEach((s) => {
      if (toMoveSet[s.id] || s.projectId == null) return; // seance mise de cote : hors comptes
      (assignments[s.id] || []).forEach((tid) => {
        const k = s.projectId + '::' + tid;
        pairCount[k] = (pairCount[k] || 0) + 1;
        const c = covFor(tid, s);
        pairHours[k] = (pairHours[k] || 0) + (c.frac >= 1 - 1e-9 ? s.hours : c.freeMs / 3600000);
      });
    });

    const unfilledSet = {};
    (ev.unfilled || []).forEach((id) => { unfilledSet[id] = 1; });
    const noSupSet = {};
    (ev.noSup || []).forEach((id) => { noSupSet[id] = 1; });

    /* pourquoi un encadrant n'est-il pas (pleinement) disponible pour `s` :
       une autre seance affectee (souvent un autre projet), une indispo
       recurrente, ou un evenement d'agenda. Sert la colonne Disponibilites. */
    function reasonFor(tid, s) {
      const sS = +new Date(s.start);
      const sE = +new Date(s.end);
      const clash = (ivsMap[tid] || []).find((iv) => iv.sid !== s.id && iv.start < sE && iv.end > sS);
      if (clash) {
        const cs = sessions.find((x) => x.id === clash.sid);
        return cs
          ? 'occupé : ' + cs.project + ' — ' + cs.label + ' ' + U.fmtRange(cs.start, cs.end)
          : 'occupé sur une autre séance ' + U.fmtRange(new Date(clash.start), new Date(clash.end));
      }
      if (idgOf(tid, s) === 2) return 'indisponible récurrent (demi-journée)';
      const tm = byTeacher[tid];
      const evc = tm && (tm.events || []).find((e) => {
        if (e.allDay && !o.allDayBusy) return false;
        return +new Date(e.start) < sE && +new Date(e.end) > sS;
      });
      if (evc) {
        return 'agenda : ' + (evc.summary || 'occupé') +
          (evc.allDay ? ' (journée entière)' : ' ' + U.fmtRange(evc.start, evc.end));
      }
      return '';
    }

    // projets visibles / filtre "seances difficiles" pour la Repartition
    const vp = Array.isArray(sch.visibleProjects) ? sch.visibleProjects : null;
    let visProjects = vp ? projects.filter((p) => vp.indexOf(p.id) !== -1) : projects.slice();
    // filtre non vide dont AUCUN id ne correspond a un projet actuel (projets
    // supprimes / etat obsolete) -> on retombe sur "tous". Un filtre vide `[]`
    // reste "aucun projet" (choix explicite via « aucun »).
    if (vp && vp.length && !visProjects.length && projects.length) { visProjects = projects.slice(); }
    const visIds = {};
    visProjects.forEach((p) => { visIds[p.id] = 1; });
    const hardOnly = !!sch.hardOnly;
    const isHard = (s) => !toMoveSet[s.id] && (ev.availFull[s.id] || 0) === 0;
    const visProjSessions = sessions.filter((s) => visIds[s.projectId]);
    const visSessions = visProjSessions.filter((s) => !hardOnly || isHard(s));

    const altSupMap = sch.altSup || {};
    const validSet = sch.validated || {};
    const hasAlt = (s) => !!(altSupMap[s.id] && String(altSupMap[s.id]).trim());
    const loads = T.map((t) => ev.load[t.id] || 0);
    const maxLoad = Math.max(1, ...loads);
    const covered = sessions.filter((s) => !noSupSet[s.id] && !toMoveSet[s.id] &&
      (validSet[s.id] || (assignments[s.id] || []).length + (hasAlt(s) ? 1 : 0) >= o.minPerSession)).length;
    const totalAssignedH = Math.round(loads.reduce((a, b) => a + b, 0) * 10) / 10;
    const arbitrer = sessions.filter((s) => !noSupSet[s.id] && !toMoveSet[s.id] && (ev.availFull[s.id] || 0) >= 2).length;
    const partielles = sessions.filter((s) => (ev.partial[s.id] || []).length).length;
    const manque = (ev.unfilled || []).length;
    const sansEnc = (ev.noSup || []).length;
    const aDeplacer = (ev.toMove || []).length;
    const valide = (ev.validated || []).length;

    // per-project balance sheet -- les seances « a deplacer » restent visibles
    // (comptees dans « Seances », avec un rappel du nombre a cote du projet)
    // mais ne comptent ni comme couvertes, ni dans les heures affectees, ni
    // dans les totaux par encadrant.
    const round1 = (x) => Math.round(x * 10) / 10;
    const bilan = projects.map((p) => {
      const all = sessions.filter((s) => s.projectId === p.id);
      const ps = all.filter((s) => !toMoveSet[s.id]);
      let hours = 0;
      ps.forEach((s) => { hours += (assignments[s.id] || []).length * s.hours; });
      const sup = ev.supervisionOf[p.id] || (p.supervision === 'partial' ? 'partial' : 'full');
      return {
        p: p,
        supervision: sup,
        total: all.length,
        toMove: all.filter((s) => toMoveSet[s.id]).length,
        valide: ps.filter((s) => validSet[s.id]).length,
        covered: ps.filter((s) => !noSupSet[s.id] &&
          (validSet[s.id] || (assignments[s.id] || []).length + (hasAlt(s) ? 1 : 0) >= o.minPerSession)).length,
        manque: ps.filter((s) => unfilledSet[s.id]).length,
        sansEnc: ps.filter((s) => noSupSet[s.id]).length,
        unsupH: round1(ev.unsupHours[p.id] || 0),
        unsupTarget: round1(ev.unsupTarget[p.id] || 0),
        partial: ps.filter((s) => (ev.partial[s.id] || []).length).length,
        arbitrer: ps.filter((s) => (ev.availFull[s.id] || 0) >= 2).length,
        hours: round1(hours)
      };
    });
    const bTot = bilan.reduce((a, b) => ({
      total: a.total + b.total, toMove: a.toMove + b.toMove, valide: a.valide + b.valide, covered: a.covered + b.covered, manque: a.manque + b.manque,
      sansEnc: a.sansEnc + b.sansEnc, unsupH: round1(a.unsupH + b.unsupH), unsupTarget: round1(a.unsupTarget + b.unsupTarget),
      partial: a.partial + b.partial, arbitrer: a.arbitrer + b.arbitrer, hours: round1(a.hours + b.hours)
    }), { total: 0, toMove: 0, valide: 0, covered: 0, manque: 0, sansEnc: 0, unsupH: 0, unsupTarget: 0, partial: 0, arbitrer: 0, hours: 0 });

    root.innerHTML = `
      <div class="view-head">
        <h1>Affectation</h1>
        <span class="sub">Une seance de projet = ${o.sessionHours} h &middot; au moins ${o.minPerSession} encadrant(s) par seance</span>
      </div>

      <div class="panel">
        <div class="kpi">
          <div class="k"><b>${sessions.length}</b><span>seances</span></div>
          <div class="k"><b>${covered}</b><span>couvertes</span></div>
          <div class="k"><b style="color:${manque ? 'var(--danger)' : 'inherit'}">${manque}</b><span>manque encadrant</span></div>
          <div class="k"><b style="color:${sansEnc ? 'var(--muted)' : 'inherit'}">${sansEnc}</b><span>sans encadrant</span></div>
          <div class="k"><b style="color:${partielles ? 'var(--warn)' : 'inherit'}">${partielles}</b><span>partielles</span></div>
          <div class="k"><b style="color:${arbitrer ? 'var(--accent)' : 'inherit'}">${arbitrer}</b><span>a arbitrer</span></div>
          ${aDeplacer ? `<div class="k"><b style="color:var(--warn)">${aDeplacer}</b><span>a deplacer</span></div>` : ''}
          ${valide ? `<div class="k"><b style="color:var(--ok)">${valide}</b><span>validees</span></div>` : ''}
          <div class="k"><b>${totalAssignedH} h</b><span>affectees</span></div>
        </div>
      </div>

      <div class="panel">
        <h2>Bilan par projet</h2>
        ${projects.length ? `
        <div style="overflow:auto">
        <table class="grid">
          <thead><tr>
            <th>Projet</th><th style="text-align:right">Seances</th><th style="text-align:right">Couvertes</th>
            <th style="text-align:right">Manque</th><th style="text-align:right">Sans encadrant</th>
            <th style="text-align:right">Partielles</th><th style="text-align:right">A arbitrer</th>
            <th style="text-align:right">Heures affectees</th>
          </tr></thead>
          <tbody>
          ${bilan.map((b) => `
            <tr>
              <td><span class="dot" style="background:${b.p.color}"></span> ${U.esc(b.p.name)}
                <span class="badge ${b.supervision === 'partial' ? 'warn' : 'ok'}" style="margin-left:6px">${b.supervision === 'partial' ? 'partiel' : 'total'}</span>
                ${b.toMove ? `<span class="badge warn" style="margin-left:4px" title="incluses dans « Séances » mais pas dans « Couvertes » / « Heures affectées » ni dans les totaux par encadrant">dont ${b.toMove} à déplacer</span>` : ''}
                ${b.valide ? `<span class="badge ok" style="margin-left:4px">${b.valide} validée(s)</span>` : ''}</td>
              <td style="text-align:right">${b.total}</td>
              <td style="text-align:right">${b.covered}</td>
              <td style="text-align:right"><b style="color:${b.manque ? 'var(--danger)' : 'inherit'}">${b.manque}</b></td>
              <td style="text-align:right">${b.sansEnc}${(b.supervision === 'partial' || b.unsupTarget > 0)
                ? ` <span style="color:${b.unsupH > b.unsupTarget + 0.05 ? 'var(--warn)' : 'var(--muted)'}">(${b.unsupH} h / ${b.unsupTarget} h)</span>`
                : (b.sansEnc ? ` <span class="muted">(${b.unsupH} h)</span>` : '')}</td>
              <td style="text-align:right"><b style="color:${b.partial ? 'var(--warn)' : 'inherit'}">${b.partial}</b></td>
              <td style="text-align:right"><b style="color:${b.arbitrer ? 'var(--accent)' : 'inherit'}">${b.arbitrer}</b></td>
              <td style="text-align:right">${b.hours} h</td>
            </tr>`).join('')}
          ${bilan.length > 1 ? `<tr style="font-weight:700;border-top:2px solid var(--border)">
              <td>Total</td>
              <td style="text-align:right">${bTot.total}</td>
              <td style="text-align:right">${bTot.covered}</td>
              <td style="text-align:right">${bTot.manque}</td>
              <td style="text-align:right">${bTot.sansEnc} <span class="muted">(${bTot.unsupH} h)</span></td>
              <td style="text-align:right">${bTot.partial}</td>
              <td style="text-align:right">${bTot.arbitrer}</td>
              <td style="text-align:right">${bTot.hours} h</td>
            </tr>` : ''}
          </tbody>
        </table>
        </div>
        <p class="muted" style="margin:8px 0 0"><b>total / partiel</b> : mode d'encadrement du projet (defini a l'onglet Agendas). <b>Manque</b> : seances sous le minimum d'encadrants alors qu'un encadrement est attendu (rouge). <b>Sans encadrant</b> : seances laissees sans encadrant — volontairement, ou par manque de disponibilite sur un projet en encadrement partiel ; pour ces projets, heures effectives / cible. <b>Partielles</b> : au moins un encadrant affecte n'est libre que sur une partie de la seance. <b>A arbitrer</b> : au moins 2 encadrants eligibles libres sur toute la seance. <b>Heures affectees</b> : somme (nb encadrants &times; duree). Les seances marquees <b>« a deplacer »</b> restent visibles (comptees dans <b>Seances</b>, listees dans les bilans par seance et par encadrant) mais ne comptent pas comme couvertes, ni dans les heures affectees, ni dans le total de seances de chaque encadrant.</p>
        ` : '<p class="muted">Ajoutez un agenda « projet ».</p>'}
      </div>

      <div class="panel">
        <h2>Reglages</h2>
        <div class="row">
          <label>Nombre cible d'encadrants par seance <input type="number" id="o-target" min="1" max="6" value="${o.targetPerSession}" style="width:56px" /></label>
          <label>Nombre minimum d'encadrants par seance <input type="number" id="o-min" min="1" max="6" value="${o.minPerSession}" style="width:56px" /></label>
        </div>
        <div class="row" style="margin-top:8px">
          <label>Duree cible (h) <input type="number" id="o-sh" min="1" step="0.5" value="${o.sessionHours}" style="width:64px" /></label>
          <label>Duree max d'une seance (h) <input type="number" id="o-smax" min="1" step="1" value="${o.sessionMaxH == null ? 12 : o.sessionMaxH}" style="width:64px" /></label>
          <label>Poids preference <input type="number" id="o-wp" min="0" step="0.5" value="${o.prefWeight}" style="width:64px" /></label>
          <label><input type="checkbox" id="o-max" ${o.respectMaxHours ? 'checked' : ''} /> respecter le plafond d'heures</label>
          <label><input type="checkbox" id="o-ad" ${o.allDayBusy ? 'checked' : ''} /> journee entiere = indisponible</label>
        </div>
        <details style="margin-top:10px">
          <summary class="muted" style="cursor:pointer">A quoi servent ces reglages ?</summary>
          <ul class="muted" style="margin:8px 0 0;padding-left:18px;line-height:1.6">
            <li><b>Nombre cible d'encadrants par seance</b> : combien d'encadrants l'affectation automatique cherche a placer sur chaque seance.</li>
            <li><b>Nombre minimum d'encadrants par seance</b> : seuil sous lequel la seance est marquee « non couverte » (ligne rouge). En general 1.</li>
            <li><b>Duree cible (h)</b> : longueur de reference d'une seance (4 h). Sert au badge « &ne;4h » et au calcul « X h sur 4 h » de disponibilite.</li>
            <li><b>Duree max d'une seance (h)</b> : au-dela, l'evenement du projet n'est pas considere comme une seance (12 h par defaut). Ecarte les blocs « vacances » / marqueurs multi-jours emis par Pronote.</li>
            <li><b>Poids preference</b> : quand une periode preferee couvre le mois de la seance, l'encadrant gagne l'equivalent de ~1 seance dans le choix (multiplie par ce poids).</li>
            <li><b>Respecter le plafond d'heures</b> : si coche, aucun encadrant n'est affecte au-dela de son « plafond h ».</li>
            <li><b>Journee entiere = indisponible</b> : un evenement « journee entiere » (conges, mission) rend l'encadrant indisponible ce jour-la.</li>
          </ul>
          <p class="muted" style="margin:6px 0 0"><b>Nombre de seances par encadrant</b> : chaque encadrant recoit une <b>cible</b> = volume horaire du projet &times; son poids / somme des poids du projet (colonne « Sans encadrant » incluse), cumulee sur tous ses projets. L'affectation privilegie a chaque seance l'encadrant le plus loin sous sa cible, parmi ceux <b>libres sur toute la seance</b> (sinon un partiellement disponible), puis un passage de reequilibrage rapproche les charges des cibles. Les choix manuels sont verrouilles et jamais deplaces.</p>
        </details>
        <div class="row" style="margin-top:12px">
          <button class="primary" id="o-run">Affecter automatiquement</button>
          <button id="o-clear">Effacer (garder les verrouilles)</button>
          <button class="danger" id="o-reset">Tout effacer</button>
          <span class="spacer" style="flex:1"></span>
          <button id="o-pdf">Export PDF</button>
          <button id="o-pdf-vis" title="Rapport limite aux projets coches dans « Repartition des seances »">Export PDF (projets visibles)</button>
          <button id="o-csv">Export CSV</button>
          <button id="o-ics">Export ICS</button>
        </div>
        ${ev.unfilled.length ? `<p style="margin:10px 0 0"><span class="badge danger">${ev.unfilled.length} seance(s) sous le minimum</span> — verifiez les agendas, l'equipe du projet, ou ajoutez du monde.</p>` : ''}
      </div>

      <div class="panel">
        <h2>Equipe par projet &amp; poids des encadrants</h2>
        ${projects.length && T.length ? `
          <p class="muted" style="margin:0 0 8px">Cochez chaque encadrant <b>concerne</b> par le projet et son <b>poids relatif</b>. Les poids se comparent entre encadrants d'un projet, entre projets, et avec la colonne <b>Sans encadrant</b> : la part de chacun = poids / somme des poids du projet, appliquee au volume horaire du projet. Un encadrant present sur plusieurs projets cumule donc les seances. Sous chaque case : <b>N aff.</b> = seances affectees &middot; <b>cible ≈</b> selon les poids &middot; <b>dispo</b> = seances ou l'encadrant est libre (compl. / part.).</p>
          <table class="grid">
            <thead><tr><th>Projet</th>${T.map((t) => `<th style="text-align:center"><span class="dot" style="background:${t.color}"></span> ${U.esc(t.name)}</th>`).join('')}<th style="text-align:center">Sans<br>encadrant</th></tr></thead>
            <tbody>
            ${projects.map((p) => {
              const sh = o.sessionHours || 4;
              const teamMap = PE.state.scheduling.teams[p.id] || {};
              return `
              <tr data-pid="${p.id}">
                <td><span class="dot" style="background:${p.color}"></span> ${U.esc(p.name)}
                  <div class="muted" style="font-size:11px">${sessions.filter((s) => s.projectId === p.id).length} seance(s)</div></td>
                ${T.map((t) => {
                  const cell = teamMap[t.id];
                  const on = !!(cell && cell.on);
                  const w = cell && cell.w != null ? cell.w : 1;
                  const cnt = pairCount[p.id + '::' + t.id] || 0;
                  const av = pairAvail[p.id + '::' + t.id] || { full: 0, part: 0 };
                  const tgtH = (ev.targetPair && ev.targetPair[p.id + '::' + t.id]) || 0;
                  return `<td style="text-align:center">
                    <label class="cellbox">
                      <input type="checkbox" class="team-on" data-pid="${p.id}" data-tid="${t.id}" ${on ? 'checked' : ''} title="encadrant concerne par le projet" />
                      <input type="number" class="team-w" data-pid="${p.id}" data-tid="${t.id}" min="0" step="0.5" value="${on ? w : ''}" ${on ? '' : 'disabled'} title="poids relatif" style="width:52px" />
                    </label>
                    <div class="cell-meta">
                      <div${cnt ? '' : ' class="dim"'}>${cnt} aff. &middot; cible ≈ ${Math.round(tgtH / sh)}</div>
                      <div>dispo : ${av.full} compl.${av.part ? ' + ' + av.part + ' part.' : ''}</div>
                    </div>
                  </td>`;
                }).join('')}
                ${(function () {
                  const cell = teamMap[PE.NOSUP_KEY];
                  const on = !!(cell && cell.on);
                  const w = cell && cell.w != null ? cell.w : 1;
                  const uh = (ev.unsupTarget && ev.unsupTarget[p.id]) || 0;
                  const nsCnt = sessions.filter((s) => s.projectId === p.id && noSupSet[s.id]).length;
                  return `<td style="text-align:center;background:var(--bg)">
                    <label class="cellbox">
                      <input type="checkbox" class="team-on" data-pid="${p.id}" data-tid="${PE.NOSUP_KEY}" title="donner un poids aux seances sans encadrant" ${on ? 'checked' : ''} />
                      <input type="number" class="team-w" data-pid="${p.id}" data-tid="${PE.NOSUP_KEY}" min="0" step="0.5" value="${on ? w : ''}" ${on ? '' : 'disabled'} title="poids des seances sans encadrant" style="width:52px" />
                    </label>
                    <div class="cell-meta">
                      <div${nsCnt ? '' : ' class="dim"'}>${nsCnt} sans enc. &middot; cible ≈ ${Math.round(uh / sh)}</div>
                      <div${uh ? '' : ' class="dim"'}>${uh} h non encadrees</div>
                    </div>
                  </td>`;
                })()}
              </tr>`;
            }).join('')}
            </tbody>
          </table>` : '<p class="muted">Ajoutez au moins un projet et un enseignant.</p>'}
      </div>

      <div class="panel">
        <h2>Enseignants &amp; periodes preferees</h2>
        ${T.length ? T.map((t) => teacherRow(t, ev, maxLoad, sessions, assignments, o)).join('') : '<p class="muted">Aucun agenda de type « enseignant ».</p>'}
      </div>

      <div class="panel">
        <div class="spread" style="align-items:center;margin-bottom:6px">
          <h2 style="margin:0">Equilibre des encadrants par projet</h2>
          <div class="row wrap-tight">
            <span class="muted">Barres :</span>
            <button class="small bal-metric-btn ${sch.balanceMetric === 'sessions' ? '' : 'primary'}" data-metric="hours">heures</button>
            <button class="small bal-metric-btn ${sch.balanceMetric === 'sessions' ? 'primary' : ''}" data-metric="sessions">seances</button>
          </div>
        </div>
        <p class="muted" style="margin:0 0 8px">Seances et heures reellement encadrees par chaque encadrant, projet par projet (heures comptees a l'heure pres, couverture partielle comprise). Mis a jour a chaque affectation. Le trait vertical = cible d'apres les poids.</p>
        ${balancePanelHTML(projects, sessions, T, assignments, o, ev, pairCount, pairHours, pairAvail, noSupSet, toMoveSet, unfilledSet, sch.balanceMetric)}
      </div>

      <div class="panel">
        <div class="spread" style="align-items:center;margin-bottom:8px">
          <h2 style="margin:0">Repartition des seances (${visSessions.length}${visSessions.length !== sessions.length ? ' / ' + sessions.length : ''})</h2>
          <div class="row wrap-tight">
            <span class="muted">Vue :</span>
            <button class="small viewbtn ${view === 'session' ? 'primary' : ''}" data-view="session">Par seance</button>
            <button class="small viewbtn ${view === 'project' ? 'primary' : ''}" data-view="project">Par projet</button>
            <button class="small viewbtn ${view === 'teacher' ? 'primary' : ''}" data-view="teacher">Par encadrant</button>
          </div>
        </div>
        ${projects.length ? `
        <div class="row wrap-tight" style="margin:0 0 6px">
          <span class="muted">Projets :</span>
          ${projects.map((p) => `<button class="small projvis-btn ${visIds[p.id] ? 'primary' : ''}" data-pid="${p.id}"><span class="dot" style="background:${p.color}"></span> ${U.esc(p.name)}</button>`).join('')}
          <button class="small" id="projvis-all">tous</button>
          <button class="small" id="projvis-none">aucun</button>
          <span class="spacer" style="flex:1"></span>
          <label class="muted"><input type="checkbox" id="hardonly-tgl" ${hardOnly ? 'checked' : ''} /> seulement les seances sans encadrant pleinement disponible</label>
        </div>` : ''}
        <p class="muted" style="margin:0 0 8px">
          <span class="swatch" style="background:var(--danger-soft)"></span> non couverte / encadrant indisponible &nbsp;
          <span class="swatch" style="background:var(--warn-soft)"></span> disponibilite partielle / hors equipe &nbsp;
          <span class="swatch" style="background:var(--accent-soft)"></span> plusieurs encadrants disponibles sur toute la seance
        </p>
        ${view === 'teacher' ? (visProjSessions.length ? bodyByTeacher(visProjSessions, T, byTeacher, ev, assignments, o, covFor, reasonFor, toMoveSet) : '<p class="muted">Aucun projet coche.</p>')
          : !visSessions.length ? '<p class="muted">Aucune seance a afficher (verifiez les projets coches / le filtre ci-dessus).</p>'
            : view === 'project' ? bodyByProject(visSessions, visProjects, ev, byTeacher, T, assignments, o, covFor, reasonFor, toMoveSet)
              : bodyBySession(visSessions, ev, byTeacher, T, assignments, o, covFor, reasonFor, toMoveSet)}
      </div>`;

    wire(root, sessions, T, visSessions);
  }

  const SESSION_HEAD = `<thead><tr>
    <th>Date</th><th>Horaire</th><th>Duree</th><th>Projet</th><th>Seance</th>
    <th>Encadrant(s)</th><th>Disponibilites</th><th>Statut</th>
  </tr></thead>`;

  function bodyBySession(sessions, ev, byTeacher, T, assignments, o, covFor, reasonFor, toMoveSet) {
    return `<div style="overflow:auto"><table class="grid">${SESSION_HEAD}<tbody>
      ${sessions.map((s) => sessionRow(s, ev, byTeacher, T, assignments, o, covFor, reasonFor, toMoveSet)).join('')}
    </tbody></table></div>`;
  }

  function bodyByProject(sessions, projects, ev, byTeacher, T, assignments, o, covFor, reasonFor, toMoveSet) {
    const unf = {};
    (ev.unfilled || []).forEach((id) => { unf[id] = 1; });
    const nos = {};
    (ev.noSup || []).forEach((id) => { nos[id] = 1; });
    const vSet = PE.state.scheduling.validated || {};
    const aMap = PE.state.scheduling.altSup || {};
    const alt1 = (s) => (aMap[s.id] && String(aMap[s.id]).trim()) ? 1 : 0;
    return projects.map((p) => {
      const all = sessions.filter((s) => s.projectId === p.id);
      if (!all.length) return '';
      // les seances « a deplacer » restent affichees en ligne et comptees dans
      // le total « seance(s) », mais pas dans couvertes / heures / par encadrant.
      const ps = all.filter((s) => !toMoveSet[s.id]);
      const sup = ev.supervisionOf[p.id] || (p.supervision === 'partial' ? 'partial' : 'full');
      const cov = ps.filter((s) => !nos[s.id] &&
        (vSet[s.id] || (assignments[s.id] || []).length + alt1(s) >= o.minPerSession)).length;
      const mq = ps.filter((s) => unf[s.id]).length;
      const se = ps.filter((s) => nos[s.id]).length;
      const dep = all.filter((s) => toMoveSet[s.id]).length;
      const val = ps.filter((s) => vSet[s.id]).length;
      const par = ps.filter((s) => (ev.partial[s.id] || []).length).length;
      let hrs = 0;
      ps.forEach((s) => { hrs += (assignments[s.id] || []).length * s.hours; });
      const unsupH = Math.round((ev.unsupHours[p.id] || 0) * 10) / 10;
      const tgt = Math.round((ev.unsupTarget[p.id] || 0) * 10) / 10;
      return `<div class="grp-head"><span class="dot" style="background:${p.color}"></span> ${U.esc(p.name)}
        <span class="badge ${sup === 'partial' ? 'warn' : 'ok'}" style="margin-left:6px">${sup === 'partial' ? 'partiel' : 'total'}</span>
        <span class="muted">— ${all.length} seance(s) &middot; ${cov} couverte(s)${mq ? ' &middot; ' + mq + ' manque(nt)' : ''}${se ? ' &middot; ' + se + ' sans encadrant (' + unsupH + ' h' + (sup === 'partial' ? ' / ' + tgt + ' h cible' : '') + ')' : ''}${par ? ' &middot; ' + par + ' partielle(s)' : ''}${dep ? ' &middot; ' + dep + ' à déplacer (non comptée' + (dep > 1 ? 's' : '') + ')' : ''}${val ? ' &middot; ' + val + ' validée(s)' : ''} &middot; ${Math.round(hrs * 10) / 10} h affectees</span></div>
        <div style="overflow:auto"><table class="grid">${SESSION_HEAD}<tbody>
        ${all.map((s) => sessionRow(s, ev, byTeacher, T, assignments, o, covFor, reasonFor, toMoveSet)).join('')}
        </tbody></table></div>`;
    }).join('') || '<p class="muted">Aucun projet.</p>';
  }

  function coverageBadge(frac, sHours) {
    if (frac >= 1 - 1e-9) return '<span class="badge ok">complete</span>';
    if (frac <= 1e-9) return '<span class="badge danger">indispo</span>';
    return '<span class="badge warn">' + fmtH(frac * sHours) + ' / ' + sHours + ' h</span>';
  }

  /* "Equilibre des encadrants par projet" : pour chaque projet, une ligne par
     encadrant concerne avec ses seances + heures reellement encadrees (heures a
     l'heure pres, couverture partielle comprise), une barre (heures ou seances
     selon `metric`) et un repere de cible. Recalcule a chaque rendu -> se met a
     jour au fil des affectations. */
  function balancePanelHTML(projects, sessions, T, assignments, o, ev, pairCount, pairHours, pairAvail, noSupSet, toMoveSet, unfilledSet, metric) {
    if (!projects.length || !T.length) return '<p class="muted">Ajoutez au moins un projet et un enseignant.</p>';
    const r1 = (x) => Math.round(x * 10) / 10;
    const sh = o.sessionHours || 4;
    const byHours = metric !== 'sessions';
    const teamsAll = PE.state.scheduling.teams || {};

    const blocks = projects.map((p) => {
      if (!sessions.some((s) => s.projectId === p.id)) return '';
      const ps = sessions.filter((s) => s.projectId === p.id && !toMoveSet[s.id]);
      const team = teamsAll[p.id] || {};
      const teamOn = Object.keys(team).filter((k) => k !== PE.NOSUP_KEY && team[k] && team[k].on);

      let rows = T.filter((t) => {
        if (teamOn.length) return teamOn.indexOf(t.id) !== -1;
        const k = p.id + '::' + t.id;
        const av = pairAvail[k] || { full: 0, part: 0 };
        return (pairCount[k] || 0) > 0 || av.full + av.part > 0;
      }).map((t) => {
        const k = p.id + '::' + t.id;
        const tgtH = r1((ev.targetPair && ev.targetPair[k]) || 0);
        return {
          name: t.name, color: t.color, sansEnc: false,
          n: pairCount[k] || 0, h: r1(pairHours[k] || 0),
          tgtH: tgtH, tgtN: Math.round(tgtH / sh)
        };
      });

      const nsList = ps.filter((s) => noSupSet[s.id]);
      const nsTgtH = r1((ev.unsupTarget && ev.unsupTarget[p.id]) || 0);
      if (nsList.length || nsTgtH > 0) {
        rows.push({
          name: 'sans encadrant', color: '#94a3b8', sansEnc: true,
          n: nsList.length, h: r1(nsList.reduce((a, s) => a + s.hours, 0)),
          tgtH: nsTgtH, tgtN: Math.round(nsTgtH / sh)
        });
      }

      const val = (x) => (byHours ? x.h : x.n);
      const tgt = (x) => (byHours ? x.tgtH : x.tgtN);
      rows.sort((a, b) => (val(b) - val(a)) || a.name.localeCompare(b.name, 'fr'));
      rows = rows.filter((x) => !x.sansEnc).concat(rows.filter((x) => x.sansEnc));

      const teach = rows.filter((x) => !x.sansEnc);
      const maxV = Math.max(1, ...rows.map((x) => Math.max(val(x), tgt(x))));
      const totalSes = ps.length;
      const totalH = r1(ps.reduce((a, s) => a + s.hours, 0));
      const toPlace = ps.filter((s) => unfilledSet[s.id]).length;
      const nMove = sessions.filter((s) => s.projectId === p.id && toMoveSet[s.id]).length;
      const spreadN = teach.length >= 2 ? Math.max.apply(null, teach.map((x) => x.n)) - Math.min.apply(null, teach.map((x) => x.n)) : 0;
      const spreadH = teach.length >= 2 ? r1(Math.max.apply(null, teach.map((x) => x.h)) - Math.min.apply(null, teach.map((x) => x.h))) : 0;

      const rowHTML = rows.map((x) => {
        const d = byHours ? r1(x.h - x.tgtH) : (x.n - x.tgtN);
        const near = byHours ? Math.abs(d) < 0.5 : d === 0;
        const dCol = near ? 'var(--ok)' : (d > 0 ? 'var(--warn)' : 'var(--muted)');
        const dTxt = x.sansEnc ? '' : (near ? 'équilibré' : (d > 0 ? '+' : '−') + (byHours ? fmtH(Math.abs(d)) : Math.abs(d)));
        return `<div class="bal-row${x.sansEnc ? ' sans' : ''}">
          <span class="bal-name"><span class="dot" style="background:${x.color}"></span>${U.esc(x.name)}</span>
          <div class="loadbar"><span style="width:${Math.round(val(x) / maxV * 100)}%;background:${x.color}"></span><i class="tgt" style="left:${Math.min(100, Math.round(tgt(x) / maxV * 100))}%"></i></div>
          <span class="bal-fig">${x.n} séance${x.n > 1 ? 's' : ''} &middot; ${fmtH(x.h)}</span>
          <span class="bal-tgt" style="color:${dCol}">${x.sansEnc ? 'cible ≈ ' + fmtH(x.tgtH) : 'cible ≈ ' + x.tgtN + (byHours ? ' (' + fmtH(x.tgtH) + ')' : '') + (dTxt ? ' &middot; ' + dTxt : '')}</span>
        </div>`;
      }).join('');

      return `<div class="bal-proj">
        ${teach.length >= 2 ? `<span class="bal-spread muted">écart max : ${spreadN} séance${spreadN > 1 ? 's' : ''} / ${fmtH(spreadH)}</span>` : ''}
        <span class="dot" style="background:${p.color}"></span> <b>${U.esc(p.name)}</b>
        <span class="muted">— ${totalSes} séance${totalSes > 1 ? 's' : ''} &middot; ${fmtH(totalH)}${toPlace ? ' &middot; ' + toPlace + ' à placer' : ''}${nMove ? ' &middot; ' + nMove + ' à déplacer' : ''}</span>
        </div>${rowHTML || '<p class="muted" style="margin:2px 0 8px">aucun encadrant concerné</p>'}`;
    }).filter(Boolean).join('');

    return blocks || '<p class="muted">Aucun projet avec des séances.</p>';
  }

  /* [{ project, n, hours }] : seances + heures par projet pour un encadrant */
  function perProject(mine) {
    const m = {};
    mine.forEach((s) => {
      const k = s.projectId;
      if (!m[k]) m[k] = { project: s.project, n: 0, hours: 0 };
      m[k].n++;
      m[k].hours += s.hours || 0;
    });
    return Object.keys(m).map((k) => m[k]).sort((a, b) => b.n - a.n)
      .map((x) => ({ project: x.project, n: x.n, hours: Math.round(x.hours * 100) / 100 }));
  }

  function bodyByTeacher(sessions, T, byTeacher, ev, assignments, o, covFor, reasonFor, toMoveSet) {
    const tmSet = toMoveSet || {};
    return '<p class="muted" style="margin:-2px 0 10px">Vue synthese en lecture seule — modifier les affectations dans « Par seance » ou « Par projet ». Les seances « a deplacer » sont affichees mais ne comptent pas dans les totaux (seances / heures).</p>' +
      T.map((t) => {
        const mineAll = sessions.filter((s) => (assignments[s.id] || []).indexOf(t.id) !== -1);
        const mine = mineAll.filter((s) => !tmSet[s.id]); // comptes : hors « a deplacer »
        const nMove = mineAll.length - mine.length;
        const load = ev.load[t.id] || 0;
        const pp = perProject(mine);
        const tgtH = (ev.target && ev.target[t.id]) || 0;
        const ppLine = pp.length
          ? '<div class="muted" style="font-size:12px;margin:2px 0 6px">par projet : ' +
            pp.map((x) => U.esc(x.project) + ' — ' + x.n + ' seance' + (x.n > 1 ? 's' : '') + ' &middot; ' + fmtH(x.hours)).join(' &nbsp;|&nbsp; ') + '</div>'
          : '';
        return `<div class="grp-head"><span class="dot" style="background:${t.color}"></span> ${U.esc(t.name)}
          <span class="muted">— ${mine.length} seance(s) &middot; ${load} h &middot; cible &asymp; ${Math.round(tgtH / ((o && o.sessionHours) || 4))} (${tgtH} h)${nMove ? ' &middot; ' + nMove + ' à déplacer (non comptée' + (nMove > 1 ? 's' : '') + ')' : ''}</span></div>
          ${ppLine}
          ${mineAll.length ? `<div style="overflow:auto"><table class="grid">
            <thead><tr><th>Date</th><th>Horaire</th><th>Projet</th><th>Seance</th><th>Sa disponibilite</th></tr></thead>
            <tbody>${mineAll.map((s) => {
              if (tmSet[s.id]) {
                return `<tr class="tomove">
                  <td>${U.fmtDated(s.start)}</td><td>${U.fmtRange(s.start, s.end)}</td>
                  <td>${U.esc(s.project)}</td><td>${U.esc(s.label)}</td>
                  <td><span class="badge warn">à déplacer</span> <span class="muted">non comptée</span></td></tr>`;
              }
              if (teacherHasSessionInAgenda(t, s)) {
                return `<tr>
                  <td>${U.fmtDated(s.start)}</td><td>${U.fmtRange(s.start, s.end)}</td>
                  <td>${U.esc(s.project)}</td><td>${U.esc(s.label)}</td>
                  <td><span class="agenda-ok">✓ dans son agenda</span></td></tr>`;
              }
              const c = covFor(t.id, s);
              const rc = c.frac >= 1 - 1e-9 ? '' : (c.frac <= 1e-9 ? 'unfilled' : 'conflict');
              return `<tr class="${rc}">
                <td>${U.fmtDated(s.start)}</td><td>${U.fmtRange(s.start, s.end)}</td>
                <td>${U.esc(s.project)}</td><td>${U.esc(s.label)}</td>
                <td>${coverageBadge(c.frac, s.hours)}</td></tr>`;
            }).join('')}</tbody></table></div>`
            : '<p class="muted" style="margin:2px 0 10px">aucune seance affectee</p>'}`;
      }).join('') || '<p class="muted">Aucun encadrant.</p>';
  }

  function teacherRow(t, ev, maxLoad, sessions, assignments, o) {
    const sh = (o && o.sessionHours) || 4;
    const load = ev.load[t.id] || 0;
    const tmSet = PE.state.scheduling.toMove || {};
    const mine = sessions.filter((s) => !tmSet[s.id] && (assignments[s.id] || []).indexOf(t.id) !== -1);
    const count = mine.length;
    const pct = Math.round((load / maxLoad) * 100);
    const tgtH = (ev.target && ev.target[t.id]) || 0;
    const tgtS = Math.round(tgtH / sh);
    const tgtPct = Math.min(100, Math.round((tgtH / maxLoad) * 100));
    const offTarget = Math.abs(count - tgtS) >= 2;
    const byProj = {};
    mine.forEach((s) => {
      const k = s.project;
      if (!byProj[k]) byProj[k] = { n: 0, pid: s.projectId };
      byProj[k].n++;
    });
    const projKeys = Object.keys(byProj);
    const breakdown = projKeys.length >= 2
      ? '<div class="muted" style="font-size:12px;margin:2px 0 0">par projet : ' +
        projKeys.map((k) => {
          const ph = (ev.targetPair && ev.targetPair[byProj[k].pid + '::' + t.id]) || 0;
          return U.esc(k) + ' — ' + byProj[k].n + ' seance' + (byProj[k].n > 1 ? 's' : '') +
            (ph ? ' (cible ≈ ' + Math.round(ph / sh) + ')' : '');
        }).join(' &middot; ') + '</div>'
      : '';
    const periods = (t.preferred || []).map((p, i) => `
      <span class="period-tag" data-i="${i}">
        <input type="month" class="pp-from" value="${p.from || ''}" />
        <span>&#8594;</span>
        <input type="month" class="pp-to" value="${p.to || ''}" />
        <button class="pp-del" title="retirer">&times;</button>
      </span>`).join('');
    return `
      <div class="teacher-row" data-tid="${t.id}">
        <div class="spread">
          <div>
            <div class="row wrap-tight">
              <span class="dot" style="background:${t.color}"></span>
              <b>${U.esc(t.name)}</b>
              <span class="muted">${count} seance(s) &middot; ${load} h &middot; <span style="color:${offTarget ? 'var(--warn)' : 'inherit'}">cible &asymp; ${tgtS} (${tgtH} h)</span></span>
            </div>
            ${breakdown}
          </div>
          <label class="muted">plafond h
            <input type="number" class="t-max" min="0" step="4" value="${t.maxHours == null ? '' : t.maxHours}" style="width:70px" placeholder="—" />
          </label>
        </div>
        <div class="loadbar" style="margin:6px 0 8px"><span style="width:${pct}%"></span><i class="tgt" style="left:${tgtPct}%"></i></div>
        <div class="row wrap-tight">
          <span class="muted">periode(s) preferee(s) :</span>
          ${periods || '<span class="muted">aucune</span>'}
          <button class="small pp-add">+ periode</button>
        </div>
      </div>`;
  }

  function optionList(teachers, s, opts, covFor) {
    return teachers.map((t) => {
      if (opts.exclude && opts.exclude.has(t.id)) return '';
      const c = covFor(t.id, s);
      const pref = S.inPreferred(t.preferred, +new Date(s.start));
      const elig = PE.isEligible(s.projectId, t.id);
      const idg = S.indispoDegree(t.indispo || [], s);
      const inAgenda = teacherHasSessionInAgenda(t, s);
      let tag = '';
      if (inAgenda) tag = ' — dans son agenda';
      else if (idg === 2) tag = ' — indispo (recurrent)';
      else if (c.frac <= 1e-9) tag = ' — indispo';
      else if (c.frac < 1 - 1e-9) tag = ' — ' + fmtH(hoursOf(c.freeMs)) + ' seulement';
      if (!inAgenda && idg === 1) tag += ' — a eviter';
      if (!elig) tag += ' — hors equipe';
      return `<option value="${t.id}" ${t.id === opts.current ? 'selected' : ''}>${pref ? '★ ' : ''}${U.esc(t.name)}${tag}</option>`;
    }).join('');
  }

  function sessionRow(s, ev, byTeacher, T, assignments, o, covFor, reasonFor, toMoveSet) {
    const arr = assignments[s.id] || [];
    const partial = ev.partial[s.id] || [];
    const indispo = ev.indispo[s.id] || [];
    const oot = ev.outOfTeam[s.id] || [];
    const availFull = ev.availFull[s.id] || 0;
    const list = ev.availList[s.id] || [];
    const durWarn = Math.abs(s.hours - o.sessionHours) > 0.05;
    const isNoSup = (ev.noSup || []).indexOf(s.id) !== -1;
    const isToMove = !!(toMoveSet && toMoveSet[s.id]);
    const sch0 = PE.state.scheduling;
    const explicitNoSup = !!(sch0.noSup || {})[s.id];
    const isValidated = !!(sch0.validated || {})[s.id];
    const lockedArr = (sch0.locked || {})[s.id] || [];
    const altSup = String((sch0.altSup || {})[s.id] || '');
    const comment = String((sch0.comment || {})[s.id] || '');
    const reason = reasonFor || (() => '');

    const moveBtn = `<button type="button" class="small tomove-btn ${isToMove ? 'primary' : ''}" data-sid="${s.id}" title="marquer cette seance comme « a deplacer » (ignoree par l'affectation auto)">${isToMove ? '✓ a deplacer' : 'a deplacer'}</button>`;
    const commentBox = `<textarea class="sess-comment" data-sid="${s.id}" rows="1" placeholder="commentaire…">${U.esc(comment)}</textarea>`;
    const altBox = `<label class="alt-sup-lbl">autre encadrant <input class="alt-sup" data-sid="${s.id}" value="${U.esc(altSup)}" placeholder="hors liste" /></label>`;
    const validateBtn = `<button type="button" class="small validate-btn ${isValidated ? 'primary' : ''}" data-sid="${s.id}" title="verrouiller l'encadrement de cette seance : les encadrants ne bougent plus, meme apres un recalcul ou un rafraichissement des agendas">${isValidated ? '✓ encadrement validé' : 'encadrement validé'}</button>`;

    if (isToMove) {
      return `
        <tr class="tomove">
          <td>${U.fmtDated(s.start)}</td>
          <td>${U.fmtRange(s.start, s.end)}</td>
          <td>${s.hours} h</td>
          <td>${U.esc(s.project)}</td>
          <td>${U.esc(s.label)}${s.location ? '<br><span class="muted">' + U.esc(s.location) + '</span>' : ''}<br>${moveBtn}${commentBox}</td>
          <td class="muted" colspan="2" style="font-style:italic">séance mise de côté — non prise en compte par l'affectation automatique</td>
          <td><span class="badge warn">à déplacer</span></td>
        </tr>`;
    }

    // eligible encadrants blocked for this session (freeMs ~ 0), with the reason
    const shownIds = {};
    list.forEach((x) => { shownIds[x.tid] = 1; });
    const blocked = T.filter((t) => PE.isEligible(s.projectId, t.id) && !shownIds[t.id] && arr.indexOf(t.id) === -1)
      .map((t) => ({ t: t, why: reason(t.id, s) }))
      .filter((b) => b.why)
      .slice(0, 8);

    const dispoCell = (list.length ? list.map((x) => {
      const color = byTeacher[x.tid] ? byTeacher[x.tid].color : '#999';
      const slots = x.full ? '' : ' <span class="muted">' + fmtSlots(covFor(x.tid, s).free) + '</span>';
      const why = x.full ? '' : (reason(x.tid, s) ? ' <span class="muted">— ' + U.esc(reason(x.tid, s)) + '</span>' : '');
      const soft = x.soft ? ' <span class="muted">(a eviter)</span>' : '';
      return `<span class="avail-item ${x.full ? '' : 'part'}${x.soft ? ' soft' : ''}"><span class="dot" style="background:${color}"></span>${U.esc(x.name)}&nbsp;${fmtH(x.hours)}${x.full ? '' : ' ⚠' + slots}${why}${soft}</span>`;
    }).join('') : '<span class="muted">aucun encadrant eligible disponible</span>')
      + (blocked.length ? `<div class="avail-blocked muted">non dispo : ${blocked.map((b) => U.esc(b.t.name) + ' <span class="muted">(' + U.esc(b.why) + ')</span>').join(', ')}</div>` : '');

    const eligT = T.filter((t) => PE.isEligible(s.projectId, t.id));
    const nosupToggle = `<label class="nosup-tgl"><input type="checkbox" class="nosup-cb" data-sid="${s.id}" ${explicitNoSup ? 'checked' : ''} /> seance sans encadrant</label>`;

    if (isNoSup) {
      const addOptN = optionList(eligT, s, { exclude: new Set(arr), current: '' }, covFor);
      return `
        <tr class="nosup">
          <td>${U.fmtDated(s.start)}</td>
          <td>${U.fmtRange(s.start, s.end)}</td>
          <td>${s.hours} h ${durWarn ? '<span class="badge warn">&ne;' + o.sessionHours + 'h</span>' : ''}</td>
          <td>${U.esc(s.project)}</td>
          <td>${U.esc(s.label)}${s.location ? '<br><span class="muted">' + U.esc(s.location) + '</span>' : ''}<br>${moveBtn}${commentBox}</td>
          <td class="enc-cell">
            <div class="muted" style="font-style:italic">seance sans encadrant${explicitNoSup ? '' : ' (encadrement partiel du projet)'}</div>
            <span class="enc-line"><span class="dot" style="background:transparent"></span>
              <select class="add-teacher" data-sid="${s.id}"><option value="">+ affecter un encadrant…</option>${addOptN}</select></span>
            ${altBox}
            ${nosupToggle}
          </td>
          <td class="dispo-cell">${dispoCell}</td>
          <td><span class="badge" style="background:var(--bg);color:var(--muted)">sans encadrant</span></td>
        </tr>`;
    }

    // encadrants affectes dont l'agenda contient deja cette seance : leur nom est
    // surligne en vert fonce, et l'evenement d'agenda correspondant n'est plus
    // compte comme un conflit (ni ligne rouge, ni statut « indispo »).
    const matchedSet = {};
    arr.forEach((tid) => { if (teacherHasSessionInAgenda(byTeacher[tid], s)) matchedSet[tid] = 1; });
    const anyMatched = Object.keys(matchedSet).length > 0;
    const indispoEff = indispo.filter((tid) => !matchedSet[tid]);

    const altOne = altSup.trim() ? 1 : 0;
    const missing = Math.max(0, o.minPerSession - arr.length - altOne);
    const rowCls = isValidated ? 'validated'
      : ((missing || indispoEff.length) ? 'unfilled'
        : ((oot.length || partial.length) ? 'conflict'
          : (availFull >= 2 ? 'choice' : '')));

    const swaps = arr.map((tid) => {
      const pool = eligT.slice();
      if (!pool.find((t) => t.id === tid) && byTeacher[tid]) pool.push(byTeacher[tid]);
      const others = arr.filter((x) => x !== tid);
      const c = covFor(tid, s);
      const isMatched = !!matchedSet[tid];
      const cls = isMatched ? 'matched'
        : (indispo.indexOf(tid) !== -1 ? 'bad' : (partial.indexOf(tid) !== -1 || oot.indexOf(tid) !== -1 ? 'partial' : ''));
      const color = byTeacher[tid] ? byTeacher[tid].color : '#999';
      const opt = optionList(pool, s, { exclude: new Set(others), current: tid }, covFor);
      const isPart = !isMatched && c.frac > 1e-9 && c.frac < 1 - 1e-9;
      const why = (!isMatched && c.frac < 1 - 1e-9) ? reason(tid, s) : '';
      const note = isMatched ? 'cette séance figure déjà dans l\'agenda de ' + (byTeacher[tid] ? byTeacher[tid].name : 'l\'encadrant')
        : (c.frac <= 1e-9 ? ('indisponible sur cette seance' + (why ? ' — ' + why : ''))
          : (isPart ? 'disponible ' + fmtH(hoursOf(c.freeMs)) + ' sur ' + s.hours + ' h : ' + fmtSlots(c.free) + (why ? ' — ' + why : '') : 'disponible toute la seance'));
      const slotTag = isMatched ? ' <span class="agenda-ok">✓ dans son agenda</span>'
        : ((isPart || (c.frac <= 1e-9 && why))
          ? ` <span class="muted" style="font-size:11px">${isPart ? fmtSlots(c.free) + (why ? ' — ' : '') : ''}${why ? U.esc(why) : ''}</span>` : '');
      const lk = lockedArr.indexOf(tid) !== -1;
      return `<span class="enc-line">
        <span class="dot" style="background:${color}"></span>
        <select class="swap ${cls}" data-sid="${s.id}" data-old="${tid}" title="${U.esc(note)}">${opt}<option value="__rm__">&mdash; retirer &mdash;</option></select>${slotTag}
        <button type="button" class="enc-lock ${lk ? 'on' : ''}" data-sid="${s.id}" data-tid="${tid}" title="${lk ? 'encadrant validé (verrouillé) — cliquer pour déverrouiller' : 'valider / verrouiller cet encadrant'}">${lk ? '✓' : '○'}</button>
      </span>`;
    }).join('');

    const altLine = altSup.trim()
      ? `<span class="enc-line alt"><span class="dot" style="background:#94a3b8"></span>${U.esc(altSup)} <span class="muted">(hors liste)</span></span>`
      : '';
    const addOpt = optionList(eligT, s, { exclude: new Set(arr), current: '' }, covFor);
    const addSel = `<span class="enc-line"><span class="dot" style="background:transparent"></span>
      <select class="add-teacher" data-sid="${s.id}"><option value="">+ ajouter un encadrant…</option>${addOpt}</select></span>`;

    const baseStatus = missing
      ? `<span class="badge danger">manque ${missing}</span>`
      : (indispoEff.length ? `<span class="badge danger">indispo</span>`
        : (oot.length ? `<span class="badge warn">hors equipe</span>`
          : (partial.length ? `<span class="badge warn">partiel</span>`
            : (availFull >= 2 ? `<span class="badge" style="background:var(--accent-soft);color:var(--accent)">${availFull} dispo.</span>`
              : `<span class="badge ok">ok</span>`))));
    const marks = (anyMatched ? '<span class="badge ok" title="séance présente dans l\'agenda de l\'encadrant affecté">agenda&nbsp;✓</span> ' : '')
      + (isValidated ? '<span class="badge ok">validé</span> ' : '');
    const status = marks + baseStatus;

    return `
      <tr class="${rowCls}">
        <td>${U.fmtDated(s.start)}</td>
        <td>${U.fmtRange(s.start, s.end)}</td>
        <td>${s.hours} h ${durWarn ? '<span class="badge warn">&ne;' + o.sessionHours + 'h</span>' : ''}</td>
        <td>${U.esc(s.project)}</td>
        <td>${U.esc(s.label)}${s.location ? '<br><span class="muted">' + U.esc(s.location) + '</span>' : ''}<br>${moveBtn}${commentBox}</td>
        <td class="enc-cell">${swaps || '<span class="muted">&mdash;</span>'}${altLine}${addSel}${altBox}${nosupToggle}${validateBtn}</td>
        <td class="dispo-cell">${dispoCell}</td>
        <td>${status}</td>
      </tr>`;
  }

  function wire(root, sessions, T, visSessions) {
    const sch = PE.state.scheduling;
    const o = sch.options;

    const num = (id, key, min) => {
      const el = root.querySelector(id);
      if (!el) return;
      el.addEventListener('change', () => {
        let v = parseFloat(el.value);
        if (isNaN(v)) v = min;
        o[key] = v;
        PE.save();
        PE.rerender();
      });
    };
    num('#o-target', 'targetPerSession', 1);
    num('#o-min', 'minPerSession', 1);
    num('#o-sh', 'sessionHours', 4);
    num('#o-smax', 'sessionMaxH', 12);
    num('#o-wp', 'prefWeight', 0);
    root.querySelector('#o-max').addEventListener('change', (e) => { o.respectMaxHours = e.target.checked; PE.save(); PE.rerender(); });
    root.querySelector('#o-ad').addEventListener('change', (e) => { o.allDayBusy = e.target.checked; PE.save(); PE.rerender(); });

    root.querySelector('#o-run').addEventListener('click', () => {
      const r = S.run(sessions, T, schedOptions({ locked: sch.locked }));
      sch.lastResult = r;
      PE.save();
      PE.rerender();
      PE.toast(r.unfilled.length ? (r.unfilled.length + ' seance(s) sous le minimum') : 'Affectation calculee',
        r.unfilled.length ? 'err' : 'ok');
    });
    root.querySelector('#o-clear').addEventListener('click', () => {
      const a = {};
      Object.keys(sch.locked).forEach((k) => { a[k] = (sch.locked[k] || []).slice(); });
      sch.lastResult = { assignments: a };
      PE.save();
      PE.rerender();
    });
    root.querySelector('#o-reset').addEventListener('click', () => {
      sch.locked = {};
      sch.noSup = {};
      sch.toMove = {};
      sch.validated = {};
      sch.lastResult = null;
      PE.save();
      PE.rerender();
    });
    root.querySelector('#o-csv').addEventListener('click', () => exportCSV(sessions, T));
    root.querySelector('#o-ics').addEventListener('click', () => exportICS(sessions, T));
    root.querySelector('#o-pdf').addEventListener('click', async () => {
      const r = await window.api.savePdf({ html: reportHtml(sessions, T), defaultName: 'rapport-affectation.pdf' });
      if (r && r.ok) PE.toast('PDF enregistre', 'ok');
      else if (r && r.error) PE.toast(r.error, 'err');
    });
    const pdfVis = root.querySelector('#o-pdf-vis');
    if (pdfVis) {
      pdfVis.addEventListener('click', async () => {
        if (!(visSessions || []).length) { PE.toast('Aucune seance visible', 'err'); return; }
        const r = await window.api.savePdf({ html: reportHtml(visSessions, T), defaultName: 'rapport-projets.pdf' });
        if (r && r.ok) PE.toast('PDF enregistre', 'ok');
        else if (r && r.error) PE.toast(r.error, 'err');
      });
    }

    root.querySelectorAll('.viewbtn').forEach((b) => b.addEventListener('click', () => {
      sch.view = b.dataset.view;
      PE.save();
      PE.rerender();
    }));

    root.querySelectorAll('.bal-metric-btn').forEach((b) => b.addEventListener('click', () => {
      sch.balanceMetric = b.dataset.metric === 'sessions' ? 'sessions' : 'hours';
      PE.save();
      PE.rerender();
    }));

    // projets visibles dans "Repartition des seances"
    root.querySelectorAll('.projvis-btn').forEach((b) => b.addEventListener('click', () => {
      const pid = b.dataset.pid;
      const allIds = PE.sourcesOfType('project').map((p) => p.id);
      let vis = Array.isArray(sch.visibleProjects) ? sch.visibleProjects.slice() : allIds.slice();
      const i = vis.indexOf(pid);
      if (i === -1) vis.push(pid); else vis.splice(i, 1);
      sch.visibleProjects = (vis.length === allIds.length && allIds.every((x) => vis.indexOf(x) !== -1)) ? null : vis;
      PE.save();
      PE.rerender();
    }));
    const pvAll = root.querySelector('#projvis-all');
    if (pvAll) pvAll.addEventListener('click', () => { sch.visibleProjects = null; PE.save(); PE.rerender(); });
    const pvNone = root.querySelector('#projvis-none');
    if (pvNone) pvNone.addEventListener('click', () => { sch.visibleProjects = []; PE.save(); PE.rerender(); });
    const hardTgl = root.querySelector('#hardonly-tgl');
    if (hardTgl) hardTgl.addEventListener('change', (e) => { sch.hardOnly = e.target.checked; PE.save(); PE.rerender(); });

    // "a deplacer" toggle
    root.querySelectorAll('.tomove-btn').forEach((b) => b.addEventListener('click', () => {
      const sid = b.dataset.sid;
      sch.toMove = sch.toMove || {};
      if (sch.toMove[sid]) delete sch.toMove[sid]; else sch.toMove[sid] = true;
      PE.save();
      PE.rerender();
    }));

    // commentaire libre par seance
    root.querySelectorAll('.sess-comment').forEach((ta) => {
      ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; });
      ta.addEventListener('change', () => {
        sch.comment = sch.comment || {};
        const v = ta.value.trim();
        if (v) sch.comment[ta.dataset.sid] = v; else delete sch.comment[ta.dataset.sid];
        PE.save();
      });
    });

    // "autre encadrant" (hors liste)
    root.querySelectorAll('.alt-sup').forEach((inp) => inp.addEventListener('change', () => {
      sch.altSup = sch.altSup || {};
      const v = inp.value.trim();
      if (v) sch.altSup[inp.dataset.sid] = v; else delete sch.altSup[inp.dataset.sid];
      PE.save();
      PE.rerender();
    }));

    // valider / verrouiller un encadrant sur une seance
    root.querySelectorAll('.enc-lock').forEach((b) => b.addEventListener('click', () => {
      const { sid, tid } = b.dataset;
      if ((sch.locked[sid] || []).indexOf(tid) !== -1) unlock(sid, tid); else lock(sid, tid);
      PE.save();
      PE.rerender();
    }));

    // "encadrement validé" : verrouille tous les encadrants affectes + fige la seance
    root.querySelectorAll('.validate-btn').forEach((b) => b.addEventListener('click', () => {
      const sid = b.dataset.sid;
      sch.validated = sch.validated || {};
      if (sch.validated[sid]) {
        delete sch.validated[sid];
      } else {
        sch.validated[sid] = true;
        const a = ensureAssignments();
        (a[sid] || []).forEach((tid) => lock(sid, tid));
      }
      PE.save();
      PE.rerender();
    }));

    // team : "concerne" checkbox + relative weight
    root.querySelectorAll('.team-on').forEach((cb) => cb.addEventListener('change', () => {
      const { pid, tid } = cb.dataset;
      const cell = PE.teamCell(pid, tid);
      cell.on = cb.checked;
      if (cell.on && (cell.w == null || isNaN(+cell.w) || +cell.w <= 0)) cell.w = 1;
      PE.save();
      PE.rerender();
    }));
    root.querySelectorAll('.team-w').forEach((inp) => inp.addEventListener('change', () => {
      const { pid, tid } = inp.dataset;
      const cell = PE.teamCell(pid, tid);
      const n = parseFloat(inp.value);
      cell.w = (isNaN(n) || n < 0) ? 1 : n;
      PE.save();
      PE.rerender();
    }));

    // swap / remove proposed encadrant
    root.querySelectorAll('select.swap').forEach((sel) => sel.addEventListener('change', () => {
      const sid = sel.dataset.sid;
      const oldT = sel.dataset.old;
      const val = sel.value;
      const a = ensureAssignments();
      a[sid] = a[sid] || [];
      const pos = a[sid].indexOf(oldT);
      if (val === '__rm__') {
        if (pos !== -1) a[sid].splice(pos, 1);
        unlock(sid, oldT);
      } else if (val && val !== oldT) {
        if (a[sid].indexOf(val) === -1) {
          if (pos !== -1) a[sid][pos] = val; else a[sid].push(val);
        } else if (pos !== -1) {
          a[sid].splice(pos, 1);
        }
        unlock(sid, oldT);
        lock(sid, val);
      }
      PE.save();
      PE.rerender();
    }));

    // add encadrant
    root.querySelectorAll('select.add-teacher').forEach((sel) => sel.addEventListener('change', () => {
      const tid = sel.value;
      if (!tid) return;
      const sid = sel.dataset.sid;
      if (sch.noSup && sch.noSup[sid]) delete sch.noSup[sid];
      const a = ensureAssignments();
      a[sid] = a[sid] || [];
      if (a[sid].indexOf(tid) === -1) a[sid].push(tid);
      lock(sid, tid);
      PE.save();
      PE.rerender();
    }));

    // "seance sans encadrant" toggle
    root.querySelectorAll('.nosup-cb').forEach((cb) => cb.addEventListener('change', () => {
      setNoSup(cb.dataset.sid, cb.checked);
      PE.save();
      PE.rerender();
    }));

    // teacher settings
    root.querySelectorAll('.teacher-row').forEach((rowEl) => {
      const tid = rowEl.dataset.tid;
      const entry = PE.teacherEntry(tid);
      rowEl.querySelector('.t-max').addEventListener('change', (e) => {
        const v = e.target.value.trim();
        entry.maxHours = v === '' ? null : Number(v);
        PE.save();
        PE.rerender();
      });
      rowEl.querySelector('.pp-add').addEventListener('click', () => {
        const from = U.monthKey(new Date(PE.state.range.from));
        const to = U.monthKey(new Date(PE.state.range.to));
        entry.preferred.push({ from, to });
        PE.save();
        PE.rerender();
      });
      rowEl.querySelectorAll('.period-tag').forEach((tag) => {
        const i = +tag.dataset.i;
        tag.querySelector('.pp-from').addEventListener('change', (e) => { entry.preferred[i].from = e.target.value; PE.save(); PE.rerender(); });
        tag.querySelector('.pp-to').addEventListener('change', (e) => { entry.preferred[i].to = e.target.value; PE.save(); PE.rerender(); });
        tag.querySelector('.pp-del').addEventListener('click', () => { entry.preferred.splice(i, 1); PE.save(); PE.rerender(); });
      });
    });
  }

  function reportHtml(sessions, T) {
    const o = PE.state.scheduling.options;
    const a = ensureAssignments();
    const tmSet = PE.state.scheduling.toMove || {};
    const vSet = PE.state.scheduling.validated || {};
    const altMap = PE.state.scheduling.altSup || {};
    const cmtMap = PE.state.scheduling.comment || {};
    const altOf = (s) => String(altMap[s.id] || '').trim();
    // only projects that actually have a session in this (possibly filtered) set
    const projects = PE.sourcesOfType('project')
      .filter((s) => s.enabled !== false && sessions.some((x) => x.projectId === s.id));
    const byTeacher = {};
    T.forEach((t) => { byTeacher[t.id] = t; });
    const ev = S.evaluate(sessions, T, schedOptions(), a);
    const busyMap = {};
    T.forEach((t) => { busyMap[t.id] = S.teacherBusy(t.events, o.allDayBusy); });
    const ivsMap = {};
    T.forEach((t) => { ivsMap[t.id] = []; });
    sessions.forEach((s) => (a[s.id] || []).forEach((tid) => {
      if (ivsMap[tid]) ivsMap[tid].push({ start: +new Date(s.start), end: +new Date(s.end), sid: s.id });
    }));
    const covFor = (tid, s) => {
      const sMs = { start: +new Date(s.start), end: +new Date(s.end) };
      return S.coverage(busyMap[tid] || [], (ivsMap[tid] || []).filter((iv) => iv.sid !== s.id), sMs);
    };
    const noSupSet = {};
    (ev.noSup || []).forEach((id) => { noSupSet[id] = 1; });
    const unfSet = {};
    (ev.unfilled || []).forEach((id) => { unfSet[id] = 1; });

    const esc = U.esc;
    const range = PE.state.range;
    const nameOf = (tid) => (byTeacher[tid] ? byTeacher[tid].name : tid);
    const sh = o.sessionHours || 4;

    const covered = sessions.filter((s) => !noSupSet[s.id] && !tmSet[s.id] &&
      (vSet[s.id] || (a[s.id] || []).length + (altOf(s) ? 1 : 0) >= o.minPerSession)).length;
    const aDeplacer = (ev.toMove || []).length;
    const nValide = (ev.validated || []).length;
    const totalH = Math.round(T.reduce((x, t) => x + (ev.load[t.id] || 0), 0) * 10) / 10;

    const bilan = projects.map((p) => {
      // les seances « a deplacer » restent visibles (comptees dans « Seances »)
      // mais ne comptent ni comme couvertes, ni dans les heures affectees, ni
      // dans les totaux par encadrant.
      const all = sessions.filter((s) => s.projectId === p.id);
      const ps = all.filter((s) => !tmSet[s.id]);
      let hrs = 0;
      ps.forEach((s) => { hrs += (a[s.id] || []).length * s.hours; });
      return {
        name: p.name,
        sup: ev.supervisionOf[p.id] || (p.supervision === 'partial' ? 'partial' : 'full'),
        total: all.length,
        toMove: all.filter((s) => tmSet[s.id]).length,
        covered: ps.filter((s) => !noSupSet[s.id] &&
          (vSet[s.id] || (a[s.id] || []).length + (altOf(s) ? 1 : 0) >= o.minPerSession)).length,
        manque: ps.filter((s) => unfSet[s.id]).length,
        sansEnc: ps.filter((s) => noSupSet[s.id]).length,
        unsupH: Math.round((ev.unsupHours[p.id] || 0) * 10) / 10,
        unsupTarget: Math.round((ev.unsupTarget[p.id] || 0) * 10) / 10,
        partial: ps.filter((s) => (ev.partial[s.id] || []).length).length,
        hours: Math.round(hrs * 10) / 10
      };
    });

    const statusOf = (s) => {
      if (tmSet[s.id]) return { t: 'a deplacer', c: 'st-warn' };
      if (vSet[s.id]) return { t: 'validé', c: 'st-ok' };
      if (noSupSet[s.id]) return { t: 'sans encadrant', c: 'st-neutral' };
      const arr = a[s.id] || [];
      const missing = Math.max(0, o.minPerSession - arr.length - (altOf(s) ? 1 : 0));
      if (missing) return { t: 'manque ' + missing, c: 'st-bad' };
      if ((ev.indispo[s.id] || []).length) return { t: 'indispo', c: 'st-bad' };
      if ((ev.outOfTeam[s.id] || []).length) return { t: 'hors equipe', c: 'st-warn' };
      if ((ev.partial[s.id] || []).length) return { t: 'partiel', c: 'st-warn' };
      return { t: 'ok', c: 'st-ok' };
    };

    const teacherBlocks = T.map((t, i) => {
      const mineAll = sessions.filter((s) => (a[s.id] || []).indexOf(t.id) !== -1)
        .sort((x, y) => (x.start < y.start ? -1 : 1));
      const mine = mineAll.filter((s) => !tmSet[s.id]); // comptes : hors « a deplacer »
      const nMove = mineAll.length - mine.length;
      const load = ev.load[t.id] || 0;
      const tgtH = (ev.target && ev.target[t.id]) || 0;
      const pp = perProject(mine);
      return `<div class="tb${i > 0 ? ' pagebreak' : ''}">
        <h3><span class="sw" style="background:${t.color}"></span> ${esc(t.name)}</h3>
        <p class="sub">${mine.length} seance(s) &middot; ${load} h &middot; cible &asymp; ${Math.round(tgtH / sh)} (${tgtH} h)${nMove ? ' &middot; ' + nMove + ' a deplacer (non comptee' + (nMove > 1 ? 's' : '') + ')' : ''}</p>
        <table><thead><tr><th>Projet</th><th class="r">Seances</th><th class="r">Heures</th></tr></thead><tbody>
        ${pp.map((x) => `<tr><td>${esc(x.project)}</td><td class="r">${x.n}</td><td class="r">${x.hours} h</td></tr>`).join('')
          || '<tr><td colspan="3" class="muted">aucune seance affectee</td></tr>'}
        ${pp.length > 1 ? `<tr class="tot"><td>Total</td><td class="r">${mine.length}</td><td class="r">${Math.round(mine.reduce((x, s) => x + s.hours, 0) * 10) / 10} h</td></tr>` : ''}
        </tbody></table>
        ${mineAll.length ? `<table><thead><tr><th>Date</th><th>Horaire</th><th>Projet</th><th>Seance</th><th>Encadrement assure</th></tr></thead><tbody>
        ${mineAll.map((s) => {
          if (tmSet[s.id]) {
            return `<tr><td>${U.fmtDated(s.start)}</td><td>${U.fmtRange(s.start, s.end)}</td><td>${esc(s.project)}</td><td>${esc(s.label)}</td><td class="st-warn">a deplacer &mdash; non comptee</td></tr>`;
          }
          const c = covFor(t.id, s);
          let cov;
          let cls = '';
          if (c.frac >= 1 - 1e-9) { cov = 'toute la seance'; cls = 'st-ok'; }
          else if (c.frac <= 1e-9) { cov = 'indisponible'; cls = 'st-bad'; }
          else { cov = fmtH(hoursOf(c.freeMs)) + ' &middot; ' + fmtSlots(c.free); cls = 'st-warn'; }
          return `<tr><td>${U.fmtDated(s.start)}</td><td>${U.fmtRange(s.start, s.end)}</td><td>${esc(s.project)}</td><td>${esc(s.label)}</td><td class="${cls}">${cov}</td></tr>`;
        }).join('')}
        </tbody></table>` : ''}
      </div>`;
    }).join('');

    const encCell = (s) => {
      const arr = a[s.id] || [];
      const part = ev.partial[s.id] || [];
      const names = arr.map((tid) => {
        const nm = esc(nameOf(tid));
        return part.indexOf(tid) === -1 ? nm : nm + ' <span class="muted">(' + fmtSlots(covFor(tid, s).free) + ')</span>';
      });
      if (altOf(s)) names.push(esc(altOf(s)) + ' <span class="muted">(hors liste)</span>');
      return names.length ? names.join(', ') : '<span class="muted">—</span>';
    };
    const cmtLine = (s) => (cmtMap[s.id] ? '<br><span class="muted">💬 ' + esc(String(cmtMap[s.id])) + '</span>' : '');

    /* motif de (non-)disponibilite, meme logique que l'onglet Affectation */
    const reasonPdf = (tid, s) => {
      const sS = +new Date(s.start);
      const sE = +new Date(s.end);
      const clash = (ivsMap[tid] || []).find((iv) => iv.sid !== s.id && iv.start < sE && iv.end > sS);
      if (clash) {
        const cs = sessions.find((x) => x.id === clash.sid);
        return cs ? 'occupé : ' + cs.project + ' — ' + cs.label + ' ' + U.fmtRange(cs.start, cs.end) : 'occupé sur une autre séance';
      }
      const tm = byTeacher[tid];
      if (tm && S.indispoDegree(tm.indispo || [], s) === 2) return 'indisponible récurrent (demi-journée)';
      const evc = tm && (tm.events || []).find((e) => {
        if (e.allDay && !o.allDayBusy) return false;
        return +new Date(e.start) < sE && +new Date(e.end) > sS;
      });
      return evc ? 'agenda : ' + (evc.summary || 'occupé') + (evc.allDay ? ' (journée entière)' : ' ' + U.fmtRange(evc.start, evc.end)) : '';
    };

    /* Disponibilites : tous les encadrants eligibles et leur couverture de la
       seance — meme information que la colonne "Disponibilites" de l'onglet
       Affectation (vue Par seance), en texte simple pour le PDF. */
    const dispoCellPdf = (s) => {
      const list = ev.availList[s.id] || [];
      const shown = {};
      list.forEach((x) => { shown[x.tid] = 1; });
      const blocked = T.filter((t) => PE.isEligible(s.projectId, t.id) && !shown[t.id])
        .map((t) => ({ t: t, why: reasonPdf(t.id, s) })).filter((b) => b.why).slice(0, 8);
      const blockedTxt = blocked.length
        ? '<br><span class="muted">non dispo : ' + blocked.map((b) => esc(b.t.name) + ' (' + esc(b.why) + ')').join(', ') + '</span>'
        : '';
      if (!list.length) return (blockedTxt ? '' : '<span class="muted">aucun encadrant eligible disponible</span>') + blockedTxt;
      return list.map((x) => {
        const slots = x.full ? '' : ' (' + fmtSlots(covFor(x.tid, s).free) + ')';
        const why = x.full ? '' : (reasonPdf(x.tid, s) ? ' — ' + esc(reasonPdf(x.tid, s)) : '');
        return esc(x.name) + ' ' + fmtH(x.hours) + (x.full ? '' : ' ⚠' + slots + why);
      }).join(', ') + blockedTxt;
    };

    const allSessions = sessions.slice().sort((x, y) => (x.start < y.start ? -1 : 1));
    const projectColor = {};
    projects.forEach((p) => { projectColor[p.id] = p.color; });
    const bilanSeanceRows = allSessions.map((s) => {
      const st = statusOf(s);
      return `<tr>
        <td>${U.fmtDated(s.start)}</td><td>${U.fmtRange(s.start, s.end)}</td><td>${s.hours} h</td>
        <td><span class="sw" style="background:${projectColor[s.projectId] || '#999'}"></span> ${esc(s.project)}</td>
        <td>${esc(s.label)}${s.location ? '<br><span class="muted">' + esc(s.location) + '</span>' : ''}${cmtLine(s)}</td>
        <td>${encCell(s)}</td>
        <td>${dispoCellPdf(s)}</td>
        <td class="${st.c}">${st.t}</td></tr>`;
    }).join('');

    const projectsWithSessions = projects
      .map((p) => ({ p: p, ps: sessions.filter((s) => s.projectId === p.id).sort((x, y) => (x.start < y.start ? -1 : 1)) }))
      .filter((x) => x.ps.length);

    const sessBlocks = projectsWithSessions.map(({ p, ps }, i) => {
      return `<div class="tb${i > 0 ? ' pagebreak' : ''}"><h3><span class="sw" style="background:${p.color}"></span> ${esc(p.name)}</h3>
        <table><thead><tr><th>Date</th><th>Horaire</th><th>Duree</th><th>Seance</th><th>Encadrant(s)</th><th>Statut</th></tr></thead><tbody>
        ${ps.map((s) => {
          const st = statusOf(s);
          return `<tr><td>${U.fmtDated(s.start)}</td><td>${U.fmtRange(s.start, s.end)}</td><td>${s.hours} h</td><td>${esc(s.label)}${cmtLine(s)}</td><td>${encCell(s)}</td><td class="${st.c}">${st.t}</td></tr>`;
        }).join('')}
        </tbody></table></div>`;
    }).join('');

    const now = new Date();
    const editedOn = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeStyle: 'short' }).format(now);
    return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Rapport d'affectation</title>
    <style>
      @page { size: A4; margin: 14mm; }
      * { box-sizing: border-box; }
      body { font: 12px -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #1f2430; }
      h1 { font-size: 19px; margin: 0 0 2px; color: #1e3a8a; }
      h2 { font-size: 14px; margin: 22px 0 6px; color: #fff; background: #2563eb; padding: 4px 8px; border-radius: 4px;
        page-break-after: avoid; break-after: avoid; }
      h3 { font-size: 13px; margin: 12px 0 4px; page-break-after: avoid; break-after: avoid; }
      .edited { color: #b45309; font-weight: 600; margin: 0 0 2px; }
      p.meta { color: #666; margin: 0 0 12px; }
      p.sub { color: #666; margin: 0 0 4px; font-size: 11px; }
      table { border-collapse: collapse; width: 100%; margin: 4px 0 10px; font-size: 11px; }
      th, td { border: 1px solid #cbd5e1; padding: 3px 6px; text-align: left; vertical-align: top; }
      th { background: #e8f0fe; color: #1e3a8a; }
      td.r, th.r { text-align: right; }
      tr { page-break-inside: avoid; break-inside: avoid; }
      tbody tr:nth-child(even) td { background: #f7f9fc; }
      tr.tot td { font-weight: 700; background: #eef2f7; }
      .kpi { margin: 0 0 4px; }
      .kpi span { display: inline-block; margin-right: 8px; padding: 3px 9px; border-radius: 999px; background: #eef2f7; }
      .kpi span.bad { background: #fdecec; color: #b91c1c; }
      .kpi span.neutral { background: #eef0f3; color: #555; }
      /* chaque nouvelle section (et, dans "Repartition par encadrant" /
         "Seances par projet", chaque encadrant / projet a partir du 2e)
         demarre sur une page vierge - jamais a cheval sur la fin de la
         section precedente. */
      .pagebreak { page-break-before: always; break-before: page; }
      .muted { color: #888; }
      .sw { display: inline-block; width: 9px; height: 9px; border-radius: 2px; vertical-align: middle; }
      td.st-ok { background: #e7f6ec; color: #15803d; }
      td.st-bad { background: #fdecec; color: #b91c1c; font-weight: 600; }
      td.st-warn { background: #fdf0e0; color: #b45309; }
      td.st-neutral { background: #eef0f3; color: #555; }
    </style></head><body>
      <h1>Rapport d'affectation</h1>
      <p class="edited">Edite le ${esc(editedOn)}</p>
      <p class="meta">Plage analysee : ${esc(U.fmtShort(range.from))} &ndash; ${esc(U.fmtShort(range.to))}</p>
      <p class="kpi">
        <span><b>${sessions.length}</b> seances</span>
        <span><b>${covered}</b> couvertes</span>
        <span class="${(ev.unfilled || []).length ? 'bad' : ''}"><b>${(ev.unfilled || []).length}</b> manque encadrant</span>
        <span class="neutral"><b>${(ev.noSup || []).length}</b> sans encadrant</span>
        ${aDeplacer ? `<span class="neutral"><b>${aDeplacer}</b> a deplacer</span>` : ''}
        ${nValide ? `<span><b>${nValide}</b> validee(s)</span>` : ''}
        <span><b>${totalH} h</b> affectees</span>
      </p>

      <h2>Bilan par projet</h2>
      <table><thead><tr><th>Projet</th><th>Encadrement</th><th class="r">Seances</th><th class="r">Couvertes</th><th class="r">Manque</th><th class="r">Sans encadrant</th><th class="r">Partielles</th><th class="r">Heures affectees</th></tr></thead><tbody>
      ${bilan.map((b) => `<tr>
        <td><span class="sw" style="background:${(projects.find((p) => p.name === b.name) || {}).color || '#999'}"></span> ${esc(b.name)}</td>
        <td>${b.sup === 'partial' ? 'partiel' : 'total'}</td>
        <td class="r">${b.total}${b.toMove ? ' <span class="muted">(dont ' + b.toMove + ' à déplacer)</span>' : ''}</td><td class="r">${b.covered}</td>
        <td class="r ${b.manque ? 'st-bad' : ''}">${b.manque}</td>
        <td class="r ${b.sansEnc ? 'st-neutral' : ''}">${b.sansEnc}${(b.sup === 'partial' || b.unsupTarget > 0) ? ' (' + b.unsupH + ' h / ' + b.unsupTarget + ' h)' : ''}</td>
        <td class="r ${b.partial ? 'st-warn' : ''}">${b.partial}</td>
        <td class="r">${b.hours} h</td></tr>`).join('')}
      </tbody></table>

      <h2>Bilan par seance</h2>
      <table><thead><tr><th>Date</th><th>Horaire</th><th>Duree</th><th>Projet</th><th>Seance</th><th>Encadrant(s)</th><th>Disponibilites</th><th>Statut</th></tr></thead><tbody>
      ${bilanSeanceRows || '<tr><td colspan="8" class="muted">Aucune seance.</td></tr>'}
      </tbody></table>

      <h2 class="pagebreak">Repartition par encadrant</h2>
      ${teacherBlocks || '<p class="muted">Aucun encadrant.</p>'}

      <h2 class="pagebreak">Seances par projet</h2>
      ${sessBlocks || '<p class="muted">Aucune seance.</p>'}
    </body></html>`;
  }

  function rowsForExport(sessions, T) {
    const byId = {};
    T.forEach((t) => { byId[t.id] = t.name; });
    const a = ensureAssignments();
    const o = PE.state.scheduling.options;
    const sch = PE.state.scheduling;
    const ev = S.evaluate(sessions, T, schedOptions(), a);
    const nos = {};
    (ev.noSup || []).forEach((id) => { nos[id] = 1; });
    return sessions.map((s) => {
      const arr = a[s.id] || [];
      const names = arr.map((tid) => byId[tid] || tid);
      const alt = String((sch.altSup || {})[s.id] || '').trim();
      const comment = String((sch.comment || {})[s.id] || '');
      const missing = Math.max(0, o.minPerSession - arr.length - (alt ? 1 : 0));
      const status = (sch.toMove || {})[s.id] ? 'A DEPLACER'
        : (sch.validated || {})[s.id] ? 'VALIDE'
          : nos[s.id] ? 'SANS ENCADRANT'
            : missing ? ('MANQUE ' + missing)
              : (ev.indispo[s.id] || []).length ? 'INDISPO'
                : (ev.outOfTeam[s.id] || []).length ? 'HORS EQUIPE'
                  : (ev.partial[s.id] || []).length ? 'PARTIEL'
                    : (ev.availFull[s.id] || 0) >= 2 ? 'A ARBITRER' : 'OK';
      const dispo = (ev.availList[s.id] || []).map((x) => x.name + ' ' + fmtH(x.hours) + (x.full ? '' : ' (partiel)')).join(' ; ');
      return { s, names, alt, comment, status, dispo };
    });
  }

  async function exportCSV(sessions, T) {
    const rows = rowsForExport(sessions, T).map(({ s, names, alt, comment, status, dispo }) => [
      U.fmtDated(s.start), U.fmtTime(s.start), U.fmtTime(s.end), s.hours,
      s.project, s.label, s.location, names.join(' + '), alt, status, comment, dispo
    ]);
    const csv = PE.exp.toCSV(
      ['Date', 'Debut', 'Fin', 'Duree (h)', 'Projet', 'Seance', 'Lieu', 'Encadrant(s)', 'Autre encadrant', 'Statut', 'Commentaire', 'Disponibilites'], rows);
    const r = await window.api.saveText({ defaultName: 'affectation.csv', content: csv });
    if (r.ok) PE.toast('CSV enregistre', 'ok');
  }

  async function exportICS(sessions, T) {
    const events = rowsForExport(sessions, T).map(({ s, names, alt, comment, status }) => ({
      start: new Date(s.start), end: new Date(s.end),
      summary: s.project + ' — ' + s.label + (names.length || alt ? ' [' + names.concat(alt ? [alt] : []).join(', ') + ']' : ' [NON AFFECTE]'),
      description: 'Encadrant(s) : ' + (names.concat(alt ? [alt + ' (hors liste)'] : []).join(', ') || 'aucun') + ' — ' + status + (comment ? '\\nCommentaire : ' + comment : ''),
      location: s.location
    }));
    const ics = PE.exp.toICS('affectation', events);
    const r = await window.api.saveText({ defaultName: 'affectation.ics', content: ics });
    if (r.ok) PE.toast('ICS enregistre', 'ok');
  }

  PE.views.scheduling = {
    render: render,
    _report: function () { return reportHtml(PE.sessions(), teachersModel()); }
  };
})();
