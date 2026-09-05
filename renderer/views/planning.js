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

  function render(root) {
    const f = PE.state.planning;
    const srcs = PE.sortedSources();
    const evs = filtered();

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
