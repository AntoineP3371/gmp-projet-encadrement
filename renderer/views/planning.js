(function () {
  'use strict';
  const PE = window.PE;
  const U = PE.util;

  function filtered() {
    const f = PE.state.planning;
    const from = +new Date(PE.state.range.from);
    const to = +new Date(PE.state.range.to + 'T23:59:59');
    const q = (f.q || '').toLowerCase();
    return PE.enabledEvents().filter((e) => {
      if (f.type !== 'all' && e.type !== f.type) return false;
      if (Array.isArray(f.sources) && f.sources.indexOf(e.sourceId) === -1) return false;
      const s = +new Date(e.start);
      if (s < from || s > to) return false;
      if (q && (e.summary + ' ' + e.location + ' ' + e.sourceName).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
  }

  const fmtH = (h) => (Math.round(h * 10) / 10).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' h';

  /* Totaux par agenda, d'après l'affectation courante (mêmes règles que l'onglet
     Affectation : les séances « à déplacer » ne comptent pas).
     - agenda enseignant : séances affectées + heures encadrées (+ cible) ;
     - agenda projet : séances + heures du projet, dont heures encadrées / en autonomie. */
  function totalsBySource(srcs) {
    const S = PE.scheduler;
    const sessions = PE.sessions();
    const assignments = PE.assignments();
    const T = PE.teacherModels();
    const sch = PE.state.scheduling;
    const toMove = sch.toMove || {};
    const ev = S.evaluate(sessions, T, PE.schedOptions(), assignments);
    const noSup = {}; (ev.noSup || []).forEach((id) => { noSup[id] = 1; });
    const sh = (sch.options && sch.options.sessionHours) || 4;
    const out = {};
    srcs.forEach((src) => {
      if (src.type === 'teacher') {
        const mine = sessions.filter((x) => !toMove[x.id] && (assignments[x.id] || []).indexOf(src.id) !== -1);
        const tgtH = (ev.target && ev.target[src.id]) || 0;
        out[src.id] = {
          n: mine.length, h: ev.load[src.id] || 0,
          detail: tgtH ? 'cible ≈ ' + Math.round(tgtH / sh) + ' séance(s) (' + fmtH(tgtH) + ')' : ''
        };
      } else if (src.type === 'project') {
        const ps = sessions.filter((x) => x.projectId === src.id && !toMove[x.id]);
        const nMove = sessions.filter((x) => x.projectId === src.id && toMove[x.id]).length;
        const hTot = ps.reduce((a, x) => a + x.hours, 0);
        const hEnc = ps.reduce((a, x) => a + (assignments[x.id] || []).length * x.hours, 0);
        const auto = ps.filter((x) => noSup[x.id]);
        const parts = [fmtH(hEnc) + ' encadrées (nb encadrants × durée)'];
        if (auto.length) parts.push(auto.length + ' en autonomie (' + fmtH(auto.reduce((a, x) => a + x.hours, 0)) + ')');
        if (nMove) parts.push(nMove + ' à déplacer (non comptée' + (nMove > 1 ? 's' : '') + ')');
        out[src.id] = { n: ps.length, h: hTot, detail: parts.join(' · ') };
      }
    });
    return out;
  }

  function render(root) {
    const f = PE.state.planning;
    const srcs = PE.sortedSources();
    const evs = filtered();
    const shownSrcs = srcs.filter((s) => s.enabled !== false
      && (f.type === 'all' || s.type === f.type)
      && (!Array.isArray(f.sources) || f.sources.indexOf(s.id) !== -1));
    const totals = totalsBySource(shownSrcs);
    const evCount = {}; evs.forEach((e) => { evCount[e.sourceId] = (evCount[e.sourceId] || 0) + 1; });
    const sumT = shownSrcs.filter((s) => s.type === 'teacher').reduce((a, s) => ({ n: a.n + totals[s.id].n, h: a.h + totals[s.id].h }), { n: 0, h: 0 });
    const sumP = shownSrcs.filter((s) => s.type === 'project').reduce((a, s) => ({ n: a.n + totals[s.id].n, h: a.h + totals[s.id].h }), { n: 0, h: 0 });

    const groups = {};
    evs.forEach((e) => {
      const k = U.dayKey(e.start);
      (groups[k] = groups[k] || []).push(e);
    });
    const keys = Object.keys(groups).sort();

    root.innerHTML = `
      <div class="view-head">
        <h1>Planning (liste)</h1>
        <span class="sub">${evs.length} evenement(s) · ${keys.length} jour(s)</span>
        <span class="spacer" style="flex:1"></span>
        <button id="pl-csv">Exporter CSV</button>
      </div>

      <div class="panel">
        <div class="row">
          <label>Type
            <select id="pl-type">
              <option value="all" ${f.type === 'all' ? 'selected' : ''}>Tous</option>
              <option value="teacher" ${f.type === 'teacher' ? 'selected' : ''}>Enseignants</option>
              <option value="project" ${f.type === 'project' ? 'selected' : ''}>Projets</option>
            </select>
          </label>
          <input id="pl-q" placeholder="Rechercher…" value="${U.esc(f.q || '')}" style="min-width:220px" />
          <span class="muted">Agendas :</span>
          <button class="small" id="pl-all">tout</button>
          <button class="small" id="pl-none">rien</button>
          ${srcs.map((s) => `
            <label class="period-tag">
              <input type="checkbox" class="pl-src" value="${s.id}"
                ${(!Array.isArray(f.sources) || f.sources.indexOf(s.id) !== -1) ? 'checked' : ''} />
              <span class="dot" style="background:${s.color}"></span>${U.esc(s.name)}
            </label>`).join('')}
        </div>
      </div>

      ${shownSrcs.length ? `<div class="panel">
        <h2>Totaux par agenda</h2>
        <div style="overflow:auto"><table class="grid">
          <thead><tr><th>Agenda</th><th style="text-align:right">Événements</th><th style="text-align:right">Séances</th><th style="text-align:right">Heures</th><th>Détail</th></tr></thead>
          <tbody>
          ${shownSrcs.map((s) => { const t = totals[s.id] || { n: 0, h: 0, detail: '' }; return `<tr>
            <td><span class="dot" style="background:${s.color}"></span> ${U.esc(s.name)} <span class="badge ${s.type}">${s.type === 'teacher' ? 'ens.' : 'proj.'}</span></td>
            <td style="text-align:right">${evCount[s.id] || 0}</td>
            <td style="text-align:right"><b>${t.n}</b></td>
            <td style="text-align:right"><b>${fmtH(t.h)}</b></td>
            <td class="muted">${t.detail}</td></tr>`; }).join('')}
          ${(sumT.n || sumP.n) && shownSrcs.some((s) => s.type === 'teacher') && shownSrcs.some((s) => s.type === 'project') ? `
          <tr style="font-weight:700;border-top:2px solid var(--border)"><td>Total enseignants (affecté)</td><td></td><td style="text-align:right">${sumT.n}</td><td style="text-align:right">${fmtH(sumT.h)}</td><td></td></tr>
          <tr style="font-weight:700"><td>Total projets</td><td></td><td style="text-align:right">${sumP.n}</td><td style="text-align:right">${fmtH(sumP.h)}</td><td></td></tr>` : ''}
          </tbody>
        </table></div>
        <p class="muted" style="margin:8px 0 0"><b>Enseignant</b> : séances de projet affectées et heures encadrées (affectation courante). <b>Projet</b> : séances du projet et leur durée totale. <b>Événements</b> : lignes de l'agenda visibles dans la liste ci-dessous.</p>
      </div>` : ''}

      <div id="pl-list">
        ${keys.length ? keys.map((k) => {
          const d = new Date(k + 'T00:00:00');
          return `<div class="day-group">
            <div class="day-head">${U.fmtDay(d)}</div>
            ${groups[k].map((e) => `
              <div class="ev-row">
                <span class="time">${e.allDay ? 'journee' : U.fmtRange(e.start, e.end)}</span>
                <span class="dot" style="background:${e.color}"></span>
                <span><span class="summary">${U.esc(e.summary)}</span>
                  <span class="meta">${U.esc(e.sourceName)}${e.location ? ' · ' + U.esc(e.location) : ''}</span></span>
                <span class="badge ${e.type}">${e.type === 'teacher' ? 'ens.' : 'proj.'}</span>
              </div>`).join('')}
          </div>`;
        }).join('') : '<p class="muted">Aucun evenement. Chargez des agendas et verifiez la plage de dates.</p>'}
      </div>`;

    root.querySelector('#pl-type').addEventListener('change', (e) => { f.type = e.target.value; PE.save(); PE.rerender(); });
    root.querySelector('#pl-q').addEventListener('input', (e) => { f.q = e.target.value; PE.save(); PE.rerender(); });
    root.querySelector('#pl-all').addEventListener('click', () => { f.sources = null; PE.save(); PE.rerender(); });
    root.querySelector('#pl-none').addEventListener('click', () => { f.sources = []; PE.save(); PE.rerender(); });
    root.querySelectorAll('.pl-src').forEach((cb) => {
      cb.addEventListener('change', () => {
        const on = Array.from(root.querySelectorAll('.pl-src')).filter((x) => x.checked).map((x) => x.value);
        f.sources = on;
        PE.save();
        PE.rerender();
      });
    });

    root.querySelector('#pl-csv').addEventListener('click', async () => {
      const rows = evs.map((e) => [
        U.fmtShort(e.start), e.allDay ? '' : U.fmtTime(e.start), e.allDay ? '' : U.fmtTime(e.end),
        e.type === 'teacher' ? 'Enseignant' : 'Projet', e.sourceName, e.summary, e.location
      ]);
      const csv = PE.exp.toCSV(['Date', 'Debut', 'Fin', 'Type', 'Agenda', 'Intitule', 'Lieu'], rows);
      const r = await window.api.saveText({ defaultName: 'planning.csv', content: csv });
      if (r.ok) PE.toast('CSV enregistre', 'ok');
    });
  }

  PE.views.planning = { render };
})();
