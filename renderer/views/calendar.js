(function () {
  'use strict';
  const PE = window.PE;
  const U = PE.util;
  const S = PE.scheduler;

  const fmtH = (h) => (Math.round(h * 10) / 10).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' h';
  const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  const SLOTLBL = ['lun. matin', 'lun. après-midi', 'mar. matin', 'mar. après-midi', 'mer. matin', 'mer. après-midi',
    'jeu. matin', 'jeu. après-midi', 'ven. matin', 'ven. après-midi'];

  function isoWeek(d) {
    const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7)); // Thursday of this week
    const w1 = new Date(t.getFullYear(), 0, 4);
    const n = 1 + Math.round(((t - w1) / 86400000 - 3 + ((w1.getDay() + 6) % 7)) / 7);
    return { n: n, y: t.getFullYear(), key: t.getFullYear() + '-' + String(n).padStart(2, '0') };
  }
  function mondayOf(d) {
    const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
    return m;
  }
  function weekLabel(monday) {
    const fri = new Date(monday); fri.setDate(fri.getDate() + 4);
    const sameM = monday.getMonth() === fri.getMonth();
    return monday.getDate() + (sameM ? '' : ' ' + MONTHS[monday.getMonth()]) + '–' + fri.getDate() + ' ' + MONTHS[fri.getMonth()];
  }
  /* demi-journée « principale » d'une séance (index 0..9, lun. matin → ven. a-m),
     = celle où elle passe le plus de temps ; -1 si hors lun.–ven. */
  function primarySlot(start, end) {
    const a = +new Date(start);
    const b = +new Date(end);
    const cur = new Date(a); cur.setHours(0, 0, 0, 0);
    let best = -1;
    let bestOv = 0;
    let guard = 0;
    while (cur.getTime() < b && guard++ < 40) {
      const dow = cur.getDay();
      if (dow >= 1 && dow <= 5) {
        const d0 = cur.getTime();
        const noon = d0 + 12 * 3600000;
        const d1 = d0 + 24 * 3600000;
        const amOv = Math.max(0, Math.min(b, noon) - Math.max(a, d0));
        const pmOv = Math.max(0, Math.min(b, d1) - Math.max(a, noon));
        if (amOv > bestOv) { bestOv = amOv; best = (dow - 1) * 2; }
        if (pmOv > bestOv) { bestOv = pmOv; best = (dow - 1) * 2 + 1; }
      }
      cur.setTime(cur.getTime() + 24 * 3600000);
      cur.setHours(0, 0, 0, 0);
    }
    return best;
  }

  function render(root) {
    const sch = PE.state.scheduling;
    const o = sch.options;
    const cal = PE.state.calendar || (PE.state.calendar = { hiddenWeeks: [] });
    const T = PE.teacherModels();
    const byT = {}; T.forEach((t) => { byT[t.id] = t; });
    const projects = PE.sourcesOfType('project').filter((s) => s.enabled !== false);

    // portée = comme la Répartition (projets visibles)
    const vp = Array.isArray(sch.visibleProjects) ? sch.visibleProjects : null;
    let visProjects = vp ? projects.filter((p) => vp.indexOf(p.id) !== -1) : projects.slice();
    if (vp && vp.length && !visProjects.length && projects.length) visProjects = projects.slice();
    const visIds = {}; visProjects.forEach((p) => { visIds[p.id] = 1; });

    const allSessions = PE.sessions();
    const sessions = allSessions.filter((s) => visIds[s.projectId]);

    const assignments = PE.assignments();
    Object.keys(assignments).forEach((k) => { if (!allSessions.find((s) => s.id === k)) delete assignments[k]; });
    const ev = S.evaluate(allSessions, T, PE.schedOptions(), assignments);

    const busyMap = {}; T.forEach((t) => { busyMap[t.id] = S.teacherBusy(t.events, o.allDayBusy); });
    const ivsMap = {}; T.forEach((t) => { ivsMap[t.id] = []; });
    allSessions.forEach((s) => (assignments[s.id] || []).forEach((tid) => {
      if (ivsMap[tid]) ivsMap[tid].push({ start: +new Date(s.start), end: +new Date(s.end), sid: s.id });
    }));
    const covFor = (tid, s) => {
      const sMs = { start: +new Date(s.start), end: +new Date(s.end) };
      return S.coverage(busyMap[tid] || [], (ivsMap[tid] || []).filter((iv) => iv.sid !== s.id), sMs);
    };
    const idgOf = (tid, s) => S.indispoDegree((byT[tid] && byT[tid].indispo) || [], s);
    function reasonFor(tid, s) {
      const sS = +new Date(s.start);
      const sE = +new Date(s.end);
      const clash = (ivsMap[tid] || []).find((iv) => iv.sid !== s.id && iv.start < sE && iv.end > sS);
      if (clash) {
        const cs = allSessions.find((x) => x.id === clash.sid);
        return cs ? 'occupé : ' + cs.project + ' — ' + cs.label + ' ' + U.fmtRange(cs.start, cs.end)
          : 'occupé sur une autre séance';
      }
      if (idgOf(tid, s) === 2) return 'indisponible récurrent (demi-journée)';
      const tm = byT[tid];
      const evc = tm && (tm.events || []).find((e) => {
        if (e.allDay && !o.allDayBusy) return false;
        return +new Date(e.start) < sE && +new Date(e.end) > sS;
      });
      return evc ? 'agenda : ' + (evc.summary || 'occupé') + (evc.allDay ? ' (journée entière)' : ' ' + U.fmtRange(evc.start, evc.end)) : '';
    }

    function statusOf(s) {
      if ((sch.validated || {})[s.id]) return { t: 'validé', c: 'ok' };
      if ((ev.noSup || []).indexOf(s.id) !== -1) return { t: 'en autonomie', c: 'neutral' };
      const arr = assignments[s.id] || [];
      const alt = String((sch.altSup || {})[s.id] || '').trim();
      const missing = Math.max(0, o.minPerSession - arr.length - (alt ? 1 : 0));
      if (missing) return { t: 'manque ' + missing, c: 'danger' };
      if ((ev.indispo[s.id] || []).length) return { t: 'indispo', c: 'danger' };
      if ((ev.outOfTeam[s.id] || []).length) return { t: 'hors équipe', c: 'warn' };
      if ((ev.partial[s.id] || []).length) return { t: 'partiel', c: 'warn' };
      if ((ev.availFull[s.id] || 0) >= 2) return { t: (ev.availFull[s.id]) + ' dispos', c: 'accent' };
      return { t: 'ok', c: 'plain' };
    }

    // semaines de la plage analysée
    const weeks = [];
    const seen = {};
    const to = new Date(PE.state.range.to + 'T23:59:59');
    const cur = mondayOf(new Date(PE.state.range.from + 'T00:00:00'));
    let guard = 0;
    while (cur <= to && guard++ < 400) {
      const w = isoWeek(cur);
      if (!seen[w.key]) { seen[w.key] = 1; weeks.push({ key: w.key, n: w.n, monday: new Date(cur), label: weekLabel(cur) }); }
      cur.setDate(cur.getDate() + 7);
    }
    const hidden = {}; (cal.hiddenWeeks || []).forEach((k) => { hidden[k] = 1; });
    const visWeeks = weeks.filter((w) => !hidden[w.key]);

    // rangement séance -> case[weekKey][slot]
    const cell = {};
    let offGrid = 0;
    sessions.forEach((s) => {
      const sl = primarySlot(s.start, s.end);
      if (sl < 0) { offGrid++; return; }
      const wk = isoWeek(new Date(s.start)).key;
      (cell[wk] = cell[wk] || {});
      (cell[wk][sl] = cell[wk][sl] || []).push(s);
    });

    function addOptions(s) {
      const arr = assignments[s.id] || [];
      return T.filter((t) => PE.isEligible(s.projectId, t.id) && arr.indexOf(t.id) === -1).map((t) => {
        const c = covFor(t.id, s);
        const idg = idgOf(t.id, s);
        let tag = '';
        if (idg === 2) tag = ' — indispo (récurrent)';
        else if (c.frac <= 1e-9) tag = ' — indispo';
        else if (c.frac < 1 - 1e-9) tag = ' — ' + fmtH(c.freeMs / 3600000) + ' seulement';
        if (idg === 1) tag += ' — à éviter';
        return `<option value="${t.id}">${U.esc(t.name)}${tag}</option>`;
      }).join('');
    }

    function blockHTML(s) {
      const st = statusOf(s);
      const arr = assignments[s.id] || [];
      const alt = String((sch.altSup || {})[s.id] || '').trim();
      const comment = String((sch.comment || {})[s.id] || '');
      const isValid = !!(sch.validated || {})[s.id];
      const isAuto = !!(sch.noSup || {})[s.id];

      const list = ev.availList[s.id] || [];
      const shown = {}; list.forEach((x) => { shown[x.tid] = 1; });
      const avail = list.map((x) => {
        const col = byT[x.tid] ? byT[x.tid].color : '#999';
        const why = x.full ? '' : reasonFor(x.tid, s);
        return `<span class="cx-av ${x.full ? '' : 'part'}"${why ? ' title="' + U.esc(why) + '"' : ''}>`
          + `<span class="dot" style="background:${col}"></span>${U.esc(x.name)} ${fmtH(x.hours)}${x.full ? '' : ' ⚠'}</span>`;
      }).join('');
      const blocked = T.filter((t) => PE.isEligible(s.projectId, t.id) && !shown[t.id] && arr.indexOf(t.id) === -1)
        .map((t) => ({ t: t, why: reasonFor(t.id, s) })).filter((b) => b.why).slice(0, 6)
        .map((b) => `<span class="cx-av bad" title="${U.esc(b.why)}"><span class="dot" style="background:${b.t.color}"></span>${U.esc(b.t.name)}</span>`).join('');

      const encChips = arr.map((tid) => {
        const t = byT[tid];
        const col = t ? t.color : '#999';
        const nm = t ? t.name : tid;
        return `<span class="cx-enc-chip"><span class="dot" style="background:${col}"></span>${U.esc(nm)}`
          + `<button type="button" class="cx-enc-rm" data-sid="${s.id}" data-tid="${tid}" title="retirer">&times;</button></span>`;
      }).join('') + (alt ? `<span class="cx-enc-chip alt"><span class="dot" style="background:#94a3b8"></span>${U.esc(alt)} <span class="muted">(hors liste)</span></span>` : '');

      const pc = (PE.sourcesOfType('project').find((p) => p.id === s.projectId) || {}).color || '#999';
      return `<div class="cxblk cx-${st.c}">
        <div class="t" title="${U.esc(s.project + ' — ' + s.label)}"><span class="dot" style="background:${pc}"></span>${U.esc(s.label)} <span class="badge ${st.c === 'ok' ? 'ok' : st.c === 'danger' ? 'danger' : st.c === 'warn' ? 'warn' : ''}">${st.t}</span></div>
        <div class="m">${U.esc(s.location || 'salle ?')} · ${U.fmtRange(s.start, s.end)}${comment ? ' · 💬' : ''}</div>
        <div class="cx-disp">${avail || '<span class="muted">aucun encadrant éligible disponible</span>'}${blocked ? ' <span class="muted">— indispo :</span> ' + blocked : ''}</div>
        <div class="cx-enc">${encChips || '<span class="muted">—</span>'}
          <select class="cx-add" data-sid="${s.id}"><option value="">+ encadrant…</option>${addOptions(s)}</select></div>
        <div class="cx-ctrls">
          <button type="button" class="small cx-valid ${isValid ? 'primary' : ''}" data-sid="${s.id}" title="verrouiller l'encadrement : les encadrants ne bougent plus, même après un recalcul ou un rafraîchissement">${isValid ? '✓ validé' : 'valider'}</button>
          <button type="button" class="small cx-auto ${isAuto ? 'primary' : ''}" data-sid="${s.id}" title="séance en autonomie : les étudiants travaillent seuls, aucun encadrant placé">${isAuto ? '✓ en autonomie' : 'en autonomie'}</button>
        </div>
      </div>`;
    }

    function gridHTML() {
      return '<div class="cxc-scroll"><div class="cxc">' + visWeeks.map((w) => {
        const col = cell[w.key] || {};
        return `<div class="cxw">
          <div class="cxw-h"><span><b>S${w.n}</b> ${w.label}</span>
            <button type="button" class="cxw-hide" data-k="${w.key}" title="masquer cette semaine">&times;</button></div>
          ${SLOTLBL.map((lb, si) => `<div class="cxh">
            <div class="cxh-lab">${lb}</div>
            <div class="cxh-cells">${(col[si] || []).map(blockHTML).join('')}</div>
          </div>`).join('')}
        </div>`;
      }).join('') + '</div></div>';
    }

    root.innerHTML = `
      <div class="view-head">
        <h1>Calendrier</h1>
        <span class="sub">Une ligne par demi-journée (lun.–ven.) &middot; une colonne par semaine &middot; d'après l'affectation courante</span>
      </div>
      <div class="panel">
        <div class="row wrap-tight" style="margin-bottom:8px">
          ${projects.length ? `<span class="muted">Projets :</span>
            ${projects.map((p) => `<button class="small projvis-btn ${visIds[p.id] ? 'primary' : ''}" data-pid="${p.id}"><span class="dot" style="background:${p.color}"></span> ${U.esc(p.name)}</button>`).join('')}
            <button class="small" id="cx-proj-all">tous</button>` : ''}
          <span class="spacer" style="flex:1"></span>
          ${weeks.length ? `<details class="cx-weeks"><summary>Semaines affichées (${visWeeks.length}/${weeks.length})</summary>
            <div class="cx-weeks-list">
              <button class="small" id="cx-wk-all">tout afficher</button>
              ${weeks.map((w) => `<label><input type="checkbox" class="cx-wk" data-k="${w.key}" ${hidden[w.key] ? '' : 'checked'} /> S${w.n} <span class="muted">${w.label}</span></label>`).join('')}
            </div></details>` : ''}
        </div>
        <p class="muted" style="margin:0 0 8px">
          <span class="swatch" style="background:var(--ok-soft)"></span> validé &nbsp;
          <span class="swatch" style="background:var(--danger-soft)"></span> manque / indispo &nbsp;
          <span class="swatch" style="background:var(--warn-soft)"></span> partiel / hors équipe &nbsp;
          <span class="swatch" style="background:var(--accent-soft)"></span> plusieurs encadrants dispos &nbsp;
          <span class="swatch" style="background:repeating-linear-gradient(45deg,#fff,#fff 4px,#e9ebef 4px,#e9ebef 8px)"></span> en autonomie
        </p>
        ${!projects.length ? '<p class="muted">Ajoutez un agenda « projet ».</p>'
        : !sessions.length ? '<p class="muted">Aucune séance pour les projets cochés.</p>'
          : !visWeeks.length ? '<p class="muted">Toutes les semaines sont masquées.</p>'
            : gridHTML()}
        ${offGrid ? `<p class="muted" style="margin-top:8px">${offGrid} séance(s) hors lun.–ven. non affichée(s) ici.</p>` : ''}
      </div>`;

    wire(root);
  }

  function wire(root) {
    const sch = PE.state.scheduling;
    const cal = PE.state.calendar || (PE.state.calendar = { hiddenWeeks: [] });
    const done = () => { PE.save(); PE.rerender(); };

    root.querySelectorAll('.projvis-btn').forEach((b) => b.addEventListener('click', () => {
      const pid = b.dataset.pid;
      const allIds = PE.sourcesOfType('project').map((p) => p.id);
      let vis = Array.isArray(sch.visibleProjects) ? sch.visibleProjects.slice() : allIds.slice();
      const i = vis.indexOf(pid);
      if (i === -1) vis.push(pid); else vis.splice(i, 1);
      sch.visibleProjects = (vis.length === allIds.length && allIds.every((x) => vis.indexOf(x) !== -1)) ? null : vis;
      done();
    }));
    const pa = root.querySelector('#cx-proj-all');
    if (pa) pa.addEventListener('click', () => { sch.visibleProjects = null; done(); });

    const toggleWeek = (k, hide) => {
      cal.hiddenWeeks = cal.hiddenWeeks || [];
      const i = cal.hiddenWeeks.indexOf(k);
      if (hide && i === -1) cal.hiddenWeeks.push(k);
      if (!hide && i !== -1) cal.hiddenWeeks.splice(i, 1);
    };
    root.querySelectorAll('.cx-wk').forEach((cb) => cb.addEventListener('change', () => { toggleWeek(cb.dataset.k, !cb.checked); done(); }));
    root.querySelectorAll('.cxw-hide').forEach((b) => b.addEventListener('click', () => { toggleWeek(b.dataset.k, true); done(); }));
    const wa = root.querySelector('#cx-wk-all');
    if (wa) wa.addEventListener('click', () => { cal.hiddenWeeks = []; done(); });

    root.querySelectorAll('.cx-add').forEach((sel) => sel.addEventListener('change', () => {
      if (!sel.value) return;
      PE.sched.addTeacher(sel.dataset.sid, sel.value);
      done();
    }));
    root.querySelectorAll('.cx-enc-rm').forEach((b) => b.addEventListener('click', () => {
      PE.sched.removeTeacher(b.dataset.sid, b.dataset.tid);
      done();
    }));
    root.querySelectorAll('.cx-valid').forEach((b) => b.addEventListener('click', () => {
      PE.sched.toggleValidated(b.dataset.sid);
      done();
    }));
    root.querySelectorAll('.cx-auto').forEach((b) => b.addEventListener('click', () => {
      const sid = b.dataset.sid;
      PE.sched.setAutonome(sid, !(sch.noSup || {})[sid]);
      done();
    }));
  }

  PE.views.calendar = { render: render };
})();
