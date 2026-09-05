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

    // per (project, teacher) : sessions affected + sessions the teacher is
    // available for (complete vs partial coverage, team membership ignored).
    const pairCount = {};
    const pairAvail = {};
    projects.forEach((p) => {
      const ps = sessions.filter((s) => s.projectId === p.id);
      T.forEach((t) => {
        let full = 0;
        let part = 0;
        ps.forEach((s) => {
          const c = covFor(t.id, s);
          if (c.frac >= 1 - 1e-9) full++;
          else if (c.frac > 1e-9) part++;
        });
        pairAvail[p.id + '::' + t.id] = { full: full, part: part };
      });
    });
    sessions.forEach((s) => {
      (assignments[s.id] || []).forEach((tid) => {
        const k = s.projectId + '::' + tid;
        pairCount[k] = (pairCount[k] || 0) + 1;
      });
    });

    const unfilledSet = {};
    (ev.unfilled || []).forEach((id) => { unfilledSet[id] = 1; });
    const noSupSet = {};
    (ev.noSup || []).forEach((id) => { noSupSet[id] = 1; });

    const loads = T.map((t) => ev.load[t.id] || 0);
    const maxLoad = Math.max(1, ...loads);
    const covered = sessions.filter((s) => !noSupSet[s.id] && (assignments[s.id] || []).length >= o.minPerSession).length;
    const totalAssignedH = Math.round(loads.reduce((a, b) => a + b, 0) * 10) / 10;
    const arbitrer = sessions.filter((s) => !noSupSet[s.id] && (ev.availFull[s.id] || 0) >= 2).length;
    const partielles = sessions.filter((s) => (ev.partial[s.id] || []).length).length;
    const manque = (ev.unfilled || []).length;
    const sansEnc = (ev.noSup || []).length;

    // per-project balance sheet
    const round1 = (x) => Math.round(x * 10) / 10;
    const bilan = projects.map((p) => {
      const ps = sessions.filter((s) => s.projectId === p.id);
      let hours = 0;
      ps.forEach((s) => { hours += (assignments[s.id] || []).length * s.hours; });
      const sup = ev.supervisionOf[p.id] || (p.supervision === 'partial' ? 'partial' : 'full');
      return {
        p: p,
        supervision: sup,
        total: ps.length,
        covered: ps.filter((s) => !noSupSet[s.id] && (assignments[s.id] || []).length >= o.minPerSession).length,
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
      total: a.total + b.total, covered: a.covered + b.covered, manque: a.manque + b.manque,
      sansEnc: a.sansEnc + b.sansEnc, unsupH: round1(a.unsupH + b.unsupH), unsupTarget: round1(a.unsupTarget + b.unsupTarget),
      partial: a.partial + b.partial, arbitrer: a.arbitrer + b.arbitrer, hours: round1(a.hours + b.hours)
    }), { total: 0, covered: 0, manque: 0, sansEnc: 0, unsupH: 0, unsupTarget: 0, partial: 0, arbitrer: 0, hours: 0 });

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
                <span class="badge ${b.supervision === 'partial' ? 'warn' : 'ok'}" style="margin-left:6px">${b.supervision === 'partial' ? 'partiel' : 'total'}</span></td>
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
        <p class="muted" style="margin:8px 0 0"><b>total / partiel</b> : mode d'encadrement du projet (defini a l'onglet Agendas). <b>Manque</b> : seances sous le minimum d'encadrants alors qu'un encadrement est attendu (rouge). <b>Sans encadrant</b> : seances laissees sans encadrant — volontairement, ou par manque de disponibilite sur un projet en encadrement partiel ; pour ces projets, heures effectives / cible. <b>Partielles</b> : au moins un encadrant affecte n'est libre que sur une partie de la seance. <b>A arbitrer</b> : au moins 2 encadrants eligibles libres sur toute la seance. <b>Heures affectees</b> : somme (nb encadrants &times; duree).</p>
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
        <div class="spread" style="align-items:center;margin-bottom:8px">
          <h2 style="margin:0">Repartition des seances (${sessions.length})</h2>
          <div class="row wrap-tight">
            <span class="muted">Vue :</span>
            <button class="small viewbtn ${view === 'session' ? 'primary' : ''}" data-view="session">Par seance</button>
            <button class="small viewbtn ${view === 'project' ? 'primary' : ''}" data-view="project">Par projet</button>
            <button class="small viewbtn ${view === 'teacher' ? 'primary' : ''}" data-view="teacher">Par encadrant</button>
          </div>
        </div>
        <p class="muted" style="margin:0 0 8px">
          <span class="swatch" style="background:var(--danger-soft)"></span> non couverte / encadrant indisponible &nbsp;
          <span class="swatch" style="background:var(--warn-soft)"></span> disponibilite partielle / hors equipe &nbsp;
          <span class="swatch" style="background:var(--accent-soft)"></span> plusieurs encadrants disponibles sur toute la seance
        </p>
        ${!sessions.length ? '<p class="muted">Aucune seance. Ajoutez un agenda « projet » puis rafraichissez.</p>'
          : view === 'teacher' ? bodyByTeacher(sessions, T, byTeacher, ev, assignments, o, covFor)
            : view === 'project' ? bodyByProject(sessions, projects, ev, byTeacher, T, assignments, o, covFor)
              : bodyBySession(sessions, ev, byTeacher, T, assignments, o, covFor)}
      </div>`;

    wire(root, sessions, T);
  }

  const SESSION_HEAD = `<thead><tr>
    <th>Date</th><th>Horaire</th><th>Duree</th><th>Projet</th><th>Seance</th>
    <th>Encadrant(s)</th><th>Disponibilites</th><th>Statut</th>
  </tr></thead>`;

  function bodyBySession(sessions, ev, byTeacher, T, assignments, o, covFor) {
    return `<div style="overflow:auto"><table class="grid">${SESSION_HEAD}<tbody>
      ${sessions.map((s) => sessionRow(s, ev, byTeacher, T, assignments, o, covFor)).join('')}
    </tbody></table></div>`;
  }

  function bodyByProject(sessions, projects, ev, byTeacher, T, assignments, o, covFor) {
    const unf = {};
    (ev.unfilled || []).forEach((id) => { unf[id] = 1; });
    const nos = {};
    (ev.noSup || []).forEach((id) => { nos[id] = 1; });
    return projects.map((p) => {
      const ps = sessions.filter((s) => s.projectId === p.id);
      if (!ps.length) return '';
      const sup = ev.supervisionOf[p.id] || (p.supervision === 'partial' ? 'partial' : 'full');
      const cov = ps.filter((s) => !nos[s.id] && (assignments[s.id] || []).length >= o.minPerSession).length;
      const mq = ps.filter((s) => unf[s.id]).length;
      const se = ps.filter((s) => nos[s.id]).length;
      const par = ps.filter((s) => (ev.partial[s.id] || []).length).length;
      let hrs = 0;
      ps.forEach((s) => { hrs += (assignments[s.id] || []).length * s.hours; });
      const unsupH = Math.round((ev.unsupHours[p.id] || 0) * 10) / 10;
      const tgt = Math.round((ev.unsupTarget[p.id] || 0) * 10) / 10;
      return `<div class="grp-head"><span class="dot" style="background:${p.color}"></span> ${U.esc(p.name)}
        <span class="badge ${sup === 'partial' ? 'warn' : 'ok'}" style="margin-left:6px">${sup === 'partial' ? 'partiel' : 'total'}</span>
        <span class="muted">— ${ps.length} seance(s) &middot; ${cov} couverte(s)${mq ? ' &middot; ' + mq + ' manque(nt)' : ''}${se ? ' &middot; ' + se + ' sans encadrant (' + unsupH + ' h' + (sup === 'partial' ? ' / ' + tgt + ' h cible' : '') + ')' : ''}${par ? ' &middot; ' + par + ' partielle(s)' : ''} &middot; ${Math.round(hrs * 10) / 10} h affectees</span></div>
        <div style="overflow:auto"><table class="grid">${SESSION_HEAD}<tbody>
        ${ps.map((s) => sessionRow(s, ev, byTeacher, T, assignments, o, covFor)).join('')}
        </tbody></table></div>`;
    }).join('') || '<p class="muted">Aucun projet.</p>';
  }

  function coverageBadge(frac, sHours) {
    if (frac >= 1 - 1e-9) return '<span class="badge ok">complete</span>';
    if (frac <= 1e-9) return '<span class="badge danger">indispo</span>';
    return '<span class="badge warn">' + fmtH(frac * sHours) + ' / ' + sHours + ' h</span>';
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

  function bodyByTeacher(sessions, T, byTeacher, ev, assignments, o, covFor) {
    return '<p class="muted" style="margin:-2px 0 10px">Vue synthese en lecture seule — modifier les affectations dans « Par seance » ou « Par projet ».</p>' +
      T.map((t) => {
        const mine = sessions.filter((s) => (assignments[s.id] || []).indexOf(t.id) !== -1);
        const load = ev.load[t.id] || 0;
        const pp = perProject(mine);
        const tgtH = (ev.target && ev.target[t.id]) || 0;
        const ppLine = pp.length
          ? '<div class="muted" style="font-size:12px;margin:2px 0 6px">par projet : ' +
            pp.map((x) => U.esc(x.project) + ' — ' + x.n + ' seance' + (x.n > 1 ? 's' : '') + ' &middot; ' + fmtH(x.hours)).join(' &nbsp;|&nbsp; ') + '</div>'
          : '';
        return `<div class="grp-head"><span class="dot" style="background:${t.color}"></span> ${U.esc(t.name)}
          <span class="muted">— ${mine.length} seance(s) &middot; ${load} h &middot; cible &asymp; ${Math.round(tgtH / ((o && o.sessionHours) || 4))} (${tgtH} h)</span></div>
          ${ppLine}
          ${mine.length ? `<div style="overflow:auto"><table class="grid">
            <thead><tr><th>Date</th><th>Horaire</th><th>Projet</th><th>Seance</th><th>Sa disponibilite</th></tr></thead>
            <tbody>${mine.map((s) => {
              const c = covFor(t.id, s);
              const rc = c.frac >= 1 - 1e-9 ? '' : (c.frac <= 1e-9 ? 'unfilled' : 'conflict');
              return `<tr class="${rc}">
                <td>${U.fmtShort(s.start)}</td><td>${U.fmtRange(s.start, s.end)}</td>
                <td>${U.esc(s.project)}</td><td>${U.esc(s.label)}</td>
                <td>${coverageBadge(c.frac, s.hours)}</td></tr>`;
            }).join('')}</tbody></table></div>`
            : '<p class="muted" style="margin:2px 0 10px">aucune seance affectee</p>'}`;
      }).join('') || '<p class="muted">Aucun encadrant.</p>';
  }

  function teacherRow(t, ev, maxLoad, sessions, assignments, o) {
    const sh = (o && o.sessionHours) || 4;
    const load = ev.load[t.id] || 0;
    const mine = sessions.filter((s) => (assignments[s.id] || []).indexOf(t.id) !== -1);
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
      let tag = '';
      if (c.frac <= 1e-9) tag = ' — indispo';
      else if (c.frac < 1 - 1e-9) tag = ' — ' + fmtH(hoursOf(c.freeMs)) + ' seulement';
      if (!elig) tag += ' — hors equipe';
      return `<option value="${t.id}" ${t.id === opts.current ? 'selected' : ''}>${pref ? '★ ' : ''}${U.esc(t.name)}${tag}</option>`;
    }).join('');
  }

  function sessionRow(s, ev, byTeacher, T, assignments, o, covFor) {
    const arr = assignments[s.id] || [];
    const partial = ev.partial[s.id] || [];
    const indispo = ev.indispo[s.id] || [];
    const oot = ev.outOfTeam[s.id] || [];
    const availFull = ev.availFull[s.id] || 0;
    const list = ev.availList[s.id] || [];
    const durWarn = Math.abs(s.hours - o.sessionHours) > 0.05;
    const isNoSup = (ev.noSup || []).indexOf(s.id) !== -1;
    const explicitNoSup = !!(PE.state.scheduling.noSup || {})[s.id];

    const dispoCell = (list.length ? list.map((x) => {
      const color = byTeacher[x.tid] ? byTeacher[x.tid].color : '#999';
      const slots = x.full ? '' : ' <span class="muted">' + fmtSlots(covFor(x.tid, s).free) + '</span>';
      return `<span class="avail-item ${x.full ? '' : 'part'}"><span class="dot" style="background:${color}"></span>${U.esc(x.name)}&nbsp;${fmtH(x.hours)}${x.full ? '' : ' ⚠' + slots}</span>`;
    }).join('') : '<span class="muted">aucun encadrant eligible disponible</span>');

    const eligT = T.filter((t) => PE.isEligible(s.projectId, t.id));
    const nosupToggle = `<label class="nosup-tgl"><input type="checkbox" class="nosup-cb" data-sid="${s.id}" ${explicitNoSup ? 'checked' : ''} /> seance sans encadrant</label>`;

    if (isNoSup) {
      const addOptN = optionList(eligT, s, { exclude: new Set(arr), current: '' }, covFor);
      return `
        <tr class="nosup">
          <td>${U.fmtShort(s.start)}</td>
          <td>${U.fmtRange(s.start, s.end)}</td>
          <td>${s.hours} h ${durWarn ? '<span class="badge warn">&ne;' + o.sessionHours + 'h</span>' : ''}</td>
          <td>${U.esc(s.project)}</td>
          <td>${U.esc(s.label)}${s.location ? '<br><span class="muted">' + U.esc(s.location) + '</span>' : ''}</td>
          <td class="enc-cell">
            <div class="muted" style="font-style:italic">seance sans encadrant${explicitNoSup ? '' : ' (encadrement partiel du projet)'}</div>
            <span class="enc-line"><span class="dot" style="background:transparent"></span>
              <select class="add-teacher" data-sid="${s.id}"><option value="">+ affecter un encadrant…</option>${addOptN}</select></span>
            ${nosupToggle}
          </td>
          <td class="dispo-cell">${dispoCell}</td>
          <td><span class="badge" style="background:var(--bg);color:var(--muted)">sans encadrant</span></td>
        </tr>`;
    }

    const missing = Math.max(0, o.minPerSession - arr.length);
    const rowCls = (missing || indispo.length) ? 'unfilled'
      : ((oot.length || partial.length) ? 'conflict'
        : (availFull >= 2 ? 'choice' : ''));

    const swaps = arr.map((tid) => {
      const pool = eligT.slice();
      if (!pool.find((t) => t.id === tid) && byTeacher[tid]) pool.push(byTeacher[tid]);
      const others = arr.filter((x) => x !== tid);
      const c = covFor(tid, s);
      const cls = indispo.indexOf(tid) !== -1 ? 'bad' : (partial.indexOf(tid) !== -1 || oot.indexOf(tid) !== -1 ? 'partial' : '');
      const color = byTeacher[tid] ? byTeacher[tid].color : '#999';
      const opt = optionList(pool, s, { exclude: new Set(others), current: tid }, covFor);
      const isPart = c.frac > 1e-9 && c.frac < 1 - 1e-9;
      const note = c.frac <= 1e-9 ? 'indisponible sur cette seance'
        : (isPart ? 'disponible ' + fmtH(hoursOf(c.freeMs)) + ' sur ' + s.hours + ' h : ' + fmtSlots(c.free) : 'disponible toute la seance');
      const slotTag = isPart ? ` <span class="muted" style="font-size:11px">${fmtSlots(c.free)}</span>` : '';
      return `<span class="enc-line">
        <span class="dot" style="background:${color}"></span>
        <select class="swap ${cls}" data-sid="${s.id}" data-old="${tid}" title="${note}">${opt}<option value="__rm__">&mdash; retirer &mdash;</option></select>${slotTag}
      </span>`;
    }).join('');

    const addOpt = optionList(eligT, s, { exclude: new Set(arr), current: '' }, covFor);
    const addSel = `<span class="enc-line"><span class="dot" style="background:transparent"></span>
      <select class="add-teacher" data-sid="${s.id}"><option value="">+ ajouter un encadrant…</option>${addOpt}</select></span>`;

    const status = missing
      ? `<span class="badge danger">manque ${missing}</span>`
      : (indispo.length ? `<span class="badge danger">indispo</span>`
        : (oot.length ? `<span class="badge warn">hors equipe</span>`
          : (partial.length ? `<span class="badge warn">partiel</span>`
            : (availFull >= 2 ? `<span class="badge" style="background:var(--accent-soft);color:var(--accent)">${availFull} dispo.</span>`
              : `<span class="badge ok">ok</span>`))));

    return `
      <tr class="${rowCls}">
        <td>${U.fmtShort(s.start)}</td>
        <td>${U.fmtRange(s.start, s.end)}</td>
        <td>${s.hours} h ${durWarn ? '<span class="badge warn">&ne;' + o.sessionHours + 'h</span>' : ''}</td>
        <td>${U.esc(s.project)}</td>
        <td>${U.esc(s.label)}${s.location ? '<br><span class="muted">' + U.esc(s.location) + '</span>' : ''}</td>
        <td class="enc-cell">${swaps || '<span class="muted">&mdash;</span>'}${addSel}${nosupToggle}</td>
        <td class="dispo-cell">${dispoCell}</td>
        <td>${status}</td>
      </tr>`;
  }

  function wire(root, sessions, T) {
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

    root.querySelectorAll('.viewbtn').forEach((b) => b.addEventListener('click', () => {
      sch.view = b.dataset.view;
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
    const projects = PE.sourcesOfType('project').filter((s) => s.enabled !== false);
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

    const covered = sessions.filter((s) => !noSupSet[s.id] && (a[s.id] || []).length >= o.minPerSession).length;
    const totalH = Math.round(T.reduce((x, t) => x + (ev.load[t.id] || 0), 0) * 10) / 10;

    const bilan = projects.map((p) => {
      const ps = sessions.filter((s) => s.projectId === p.id);
      let hrs = 0;
      ps.forEach((s) => { hrs += (a[s.id] || []).length * s.hours; });
      return {
        name: p.name,
        sup: ev.supervisionOf[p.id] || (p.supervision === 'partial' ? 'partial' : 'full'),
        total: ps.length,
        covered: ps.filter((s) => !noSupSet[s.id] && (a[s.id] || []).length >= o.minPerSession).length,
        manque: ps.filter((s) => unfSet[s.id]).length,
        sansEnc: ps.filter((s) => noSupSet[s.id]).length,
        unsupH: Math.round((ev.unsupHours[p.id] || 0) * 10) / 10,
        unsupTarget: Math.round((ev.unsupTarget[p.id] || 0) * 10) / 10,
        partial: ps.filter((s) => (ev.partial[s.id] || []).length).length,
        hours: Math.round(hrs * 10) / 10
      };
    });

    const statusOf = (s) => {
      if (noSupSet[s.id]) return { t: 'sans encadrant', c: 'st-neutral' };
      const arr = a[s.id] || [];
      const missing = Math.max(0, o.minPerSession - arr.length);
      if (missing) return { t: 'manque ' + missing, c: 'st-bad' };
      if ((ev.indispo[s.id] || []).length) return { t: 'indispo', c: 'st-bad' };
      if ((ev.outOfTeam[s.id] || []).length) return { t: 'hors equipe', c: 'st-warn' };
      if ((ev.partial[s.id] || []).length) return { t: 'partiel', c: 'st-warn' };
      return { t: 'ok', c: 'st-ok' };
    };

    const teacherBlocks = T.map((t, i) => {
      const mine = sessions.filter((s) => (a[s.id] || []).indexOf(t.id) !== -1)
        .sort((x, y) => (x.start < y.start ? -1 : 1));
      const load = ev.load[t.id] || 0;
      const tgtH = (ev.target && ev.target[t.id]) || 0;
      const pp = perProject(mine);
      return `<div class="tb${i > 0 ? ' pagebreak' : ''}">
        <h3><span class="sw" style="background:${t.color}"></span> ${esc(t.name)}</h3>
        <p class="sub">${mine.length} seance(s) &middot; ${load} h &middot; cible &asymp; ${Math.round(tgtH / sh)} (${tgtH} h)</p>
        <table><thead><tr><th>Projet</th><th class="r">Seances</th><th class="r">Heures</th></tr></thead><tbody>
        ${pp.map((x) => `<tr><td>${esc(x.project)}</td><td class="r">${x.n}</td><td class="r">${x.hours} h</td></tr>`).join('')
          || '<tr><td colspan="3" class="muted">aucune seance affectee</td></tr>'}
        ${pp.length > 1 ? `<tr class="tot"><td>Total</td><td class="r">${mine.length}</td><td class="r">${Math.round(mine.reduce((x, s) => x + s.hours, 0) * 10) / 10} h</td></tr>` : ''}
        </tbody></table>
        ${mine.length ? `<table><thead><tr><th>Date</th><th>Horaire</th><th>Projet</th><th>Seance</th><th>Encadrement assure</th></tr></thead><tbody>
        ${mine.map((s) => {
          const c = covFor(t.id, s);
          let cov;
          let cls = '';
          if (c.frac >= 1 - 1e-9) { cov = 'toute la seance'; cls = 'st-ok'; }
          else if (c.frac <= 1e-9) { cov = 'indisponible'; cls = 'st-bad'; }
          else { cov = fmtH(hoursOf(c.freeMs)) + ' &middot; ' + fmtSlots(c.free); cls = 'st-warn'; }
          return `<tr><td>${U.fmtShort(s.start)}</td><td>${U.fmtRange(s.start, s.end)}</td><td>${esc(s.project)}</td><td>${esc(s.label)}</td><td class="${cls}">${cov}</td></tr>`;
        }).join('')}
        </tbody></table>` : ''}
      </div>`;
    }).join('');

    const encCell = (s) => {
      const arr = a[s.id] || [];
      if (!arr.length) return '<span class="muted">—</span>';
      const part = ev.partial[s.id] || [];
      return arr.map((tid) => {
        const nm = esc(nameOf(tid));
        if (part.indexOf(tid) === -1) return nm;
        return nm + ' <span class="muted">(' + fmtSlots(covFor(tid, s).free) + ')</span>';
      }).join(', ');
    };

    /* Disponibilites : tous les encadrants eligibles et leur couverture de la
       seance — meme information que la colonne "Disponibilites" de l'onglet
       Affectation (vue Par seance), en texte simple pour le PDF. */
    const dispoCellPdf = (s) => {
      const list = ev.availList[s.id] || [];
      if (!list.length) return '<span class="muted">aucun encadrant eligible disponible</span>';
      return list.map((x) => {
        const slots = x.full ? '' : ' (' + fmtSlots(covFor(x.tid, s).free) + ')';
        return esc(x.name) + ' ' + fmtH(x.hours) + (x.full ? '' : ' ⚠' + slots);
      }).join(', ');
    };

    const allSessions = sessions.slice().sort((x, y) => (x.start < y.start ? -1 : 1));
    const projectColor = {};
    projects.forEach((p) => { projectColor[p.id] = p.color; });
    const bilanSeanceRows = allSessions.map((s) => {
      const st = statusOf(s);
      return `<tr>
        <td>${U.fmtShort(s.start)}</td><td>${U.fmtRange(s.start, s.end)}</td><td>${s.hours} h</td>
        <td><span class="sw" style="background:${projectColor[s.projectId] || '#999'}"></span> ${esc(s.project)}</td>
        <td>${esc(s.label)}${s.location ? '<br><span class="muted">' + esc(s.location) + '</span>' : ''}</td>
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
          return `<tr><td>${U.fmtShort(s.start)}</td><td>${U.fmtRange(s.start, s.end)}</td><td>${s.hours} h</td><td>${esc(s.label)}</td><td>${encCell(s)}</td><td class="${st.c}">${st.t}</td></tr>`;
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
        <span><b>${totalH} h</b> affectees</span>
      </p>

      <h2>Bilan par projet</h2>
      <table><thead><tr><th>Projet</th><th>Encadrement</th><th class="r">Seances</th><th class="r">Couvertes</th><th class="r">Manque</th><th class="r">Sans encadrant</th><th class="r">Partielles</th><th class="r">Heures affectees</th></tr></thead><tbody>
      ${bilan.map((b) => `<tr>
        <td><span class="sw" style="background:${(projects.find((p) => p.name === b.name) || {}).color || '#999'}"></span> ${esc(b.name)}</td>
        <td>${b.sup === 'partial' ? 'partiel' : 'total'}</td>
        <td class="r">${b.total}</td><td class="r">${b.covered}</td>
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
    const ev = S.evaluate(sessions, T, schedOptions(), a);
    const nos = {};
    (ev.noSup || []).forEach((id) => { nos[id] = 1; });
    return sessions.map((s) => {
      const arr = a[s.id] || [];
      const names = arr.map((tid) => byId[tid] || tid);
      const missing = Math.max(0, o.minPerSession - arr.length);
      const status = nos[s.id] ? 'SANS ENCADRANT'
        : (missing ? ('MANQUE ' + missing)
          : ((ev.indispo[s.id] || []).length ? 'INDISPO'
            : ((ev.outOfTeam[s.id] || []).length ? 'HORS EQUIPE'
              : ((ev.partial[s.id] || []).length ? 'PARTIEL'
                : ((ev.availFull[s.id] || 0) >= 2 ? 'A ARBITRER' : 'OK')))));
      const dispo = (ev.availList[s.id] || []).map((x) => x.name + ' ' + fmtH(x.hours) + (x.full ? '' : ' (partiel)')).join(' ; ');
      return { s, names, status, dispo };
    });
  }

  async function exportCSV(sessions, T) {
    const rows = rowsForExport(sessions, T).map(({ s, names, status, dispo }) => [
      U.fmtShort(s.start), U.fmtTime(s.start), U.fmtTime(s.end), s.hours,
      s.project, s.label, s.location, names.join(' + '), status, dispo
    ]);
    const csv = PE.exp.toCSV(
      ['Date', 'Debut', 'Fin', 'Duree (h)', 'Projet', 'Seance', 'Lieu', 'Encadrant(s)', 'Statut', 'Disponibilites'], rows);
    const r = await window.api.saveText({ defaultName: 'affectation.csv', content: csv });
    if (r.ok) PE.toast('CSV enregistre', 'ok');
  }

  async function exportICS(sessions, T) {
    const events = rowsForExport(sessions, T).map(({ s, names, status }) => ({
      start: new Date(s.start), end: new Date(s.end),
      summary: s.project + ' — ' + s.label + (names.length ? ' [' + names.join(', ') + ']' : ' [NON AFFECTE]'),
      description: 'Encadrant(s) : ' + (names.join(', ') || 'aucun') + ' — ' + status,
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
