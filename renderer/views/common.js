(function () {
  'use strict';
  const P4 = window.P4;
  const U = P4.util;
  const FB = P4.fb;
  const DAYS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

  function busyOf(src) {
    return P4.scheduler.teacherBusy(src.events || [], true);
  }

  function compute() {
    const c = P4.state.common;
    const chosen = P4.state.sources.filter((s) => c.selected.indexOf(s.id) !== -1 && s.enabled !== false);
    if (chosen.length < 2) return { error: 'Selectionnez au moins 2 agendas.' };

    const wStart = +new Date(P4.state.range.from);
    const wEnd = +new Date(P4.state.range.to + 'T23:59:59');
    const grid = FB.workingWindow(wStart, wEnd, c.work.startH, c.work.endH, c.work.days);
    if (!grid.length) return { error: 'La fenetre de travail est vide (jours / heures).' };

    let res;
    if (c.mode === 'busy') {
      res = FB.intersectMany(chosen.map(busyOf));
      res = FB.intersectMany([res, grid]);
    } else {
      const allBusy = FB.normalize([].concat.apply([], chosen.map(busyOf)));
      res = [];
      grid.forEach((slot) => {
        FB.invert(allBusy, slot.start, slot.end).forEach((x) => res.push(x));
      });
      res = FB.normalize(res);
    }
    return { intervals: res, names: chosen.map((s) => s.name) };
  }

  function render(root) {
    const c = P4.state.common;
    const srcs = P4.state.sources;

    root.innerHTML = `
      <div class="view-head">
        <h1>Periodes communes</h1>
        <span class="sub">Comparer plusieurs agendas pour trouver les creneaux ou tout le monde est libre — ou occupe.</span>
      </div>

      <div class="panel">
        <div class="row" style="align-items:flex-start">
          <div class="stack">
            <span class="muted">Agendas a comparer</span>
            ${srcs.map((s) => `
              <label class="period-tag">
                <input type="checkbox" class="cm-src" value="${s.id}" ${c.selected.indexOf(s.id) !== -1 ? 'checked' : ''} />
                <span class="dot" style="background:${s.color}"></span>${U.esc(s.name)}
                <span class="badge ${s.type}">${s.type === 'teacher' ? 'ens.' : 'proj.'}</span>
              </label>`).join('')}
          </div>
          <div class="stack" style="min-width:240px">
            <label>Resultat
              <select id="cm-mode">
                <option value="free" ${c.mode === 'free' ? 'selected' : ''}>Creneaux libres communs</option>
                <option value="busy" ${c.mode === 'busy' ? 'selected' : ''}>Creneaux occupes communs</option>
              </select>
            </label>
            <label>Heures : de
              <input type="number" id="cm-h1" min="0" max="23" value="${c.work.startH}" style="width:56px" /> a
              <input type="number" id="cm-h2" min="1" max="24" value="${c.work.endH}" style="width:56px" />
            </label>
            <div class="row wrap-tight">
              ${[1, 2, 3, 4, 5, 6, 0].map((d) => `
                <label class="period-tag"><input type="checkbox" class="cm-day" value="${d}"
                  ${c.work.days.indexOf(d) !== -1 ? 'checked' : ''} />${DAYS[d]}</label>`).join('')}
            </div>
            <button class="primary" id="cm-run">Calculer</button>
          </div>
        </div>
      </div>

      <div id="cm-out"></div>`;

    root.querySelectorAll('.cm-src').forEach((cb) => cb.addEventListener('change', () => {
      c.selected = Array.from(root.querySelectorAll('.cm-src')).filter((x) => x.checked).map((x) => x.value);
      P4.save();
    }));
    root.querySelector('#cm-mode').addEventListener('change', (e) => { c.mode = e.target.value; P4.save(); });
    root.querySelector('#cm-h1').addEventListener('change', (e) => { c.work.startH = +e.target.value; P4.save(); });
    root.querySelector('#cm-h2').addEventListener('change', (e) => { c.work.endH = +e.target.value; P4.save(); });
    root.querySelectorAll('.cm-day').forEach((cb) => cb.addEventListener('change', () => {
      c.work.days = Array.from(root.querySelectorAll('.cm-day')).filter((x) => x.checked).map((x) => +x.value);
      P4.save();
    }));
    root.querySelector('#cm-run').addEventListener('click', () => {
      c.result = compute();
      P4.save();
      paint(root.querySelector('#cm-out'));
    });

    if (c.result) paint(root.querySelector('#cm-out'));
  }

  function paint(out) {
    const r = P4.state.common.result;
    if (!r) { out.innerHTML = ''; return; }
    if (r.error) { out.innerHTML = `<div class="panel"><span class="badge danger">${U.esc(r.error)}</span></div>`; return; }

    const groups = {};
    r.intervals.forEach((iv) => {
      const k = U.dayKey(iv.start);
      (groups[k] = groups[k] || []).push(iv);
    });
    const keys = Object.keys(groups).sort();
    const total = Math.round(FB.totalHours(r.intervals) * 10) / 10;

    out.innerHTML = `
      <div class="panel">
        <div class="spread">
          <h2 style="margin:0">${P4.state.common.mode === 'free' ? 'Libres ensemble' : 'Occupes ensemble'} — ${U.esc(r.names.join(', '))}</h2>
          <div class="row">
            <span class="badge ok">${total} h</span>
            <span class="badge">${r.intervals.length} creneau(x)</span>
            <button class="small" id="cm-csv">CSV</button>
          </div>
        </div>
        ${keys.length ? keys.map((k) => {
          const d = new Date(k + 'T00:00:00');
          return `<div class="day-group">
            <div class="day-head">${U.fmtDay(d)}</div>
            ${groups[k].map((iv) => {
              const h = Math.round((iv.end - iv.start) / 360000) / 10;
              return `<div class="ev-row" style="grid-template-columns:180px 1fr">
                <span class="time">${U.fmtRange(iv.start, iv.end)}</span>
                <span class="meta">${h} h</span></div>`;
            }).join('')}
          </div>`;
        }).join('') : '<p class="muted">Aucun creneau commun sur la plage et la fenetre horaire choisies.</p>'}
      </div>`;

    const csvBtn = out.querySelector('#cm-csv');
    if (csvBtn) csvBtn.addEventListener('click', async () => {
      const rows = r.intervals.map((iv) => [
        U.fmtShort(iv.start), U.fmtTime(iv.start), U.fmtTime(iv.end),
        Math.round((iv.end - iv.start) / 360000) / 10
      ]);
      const csv = P4.exp.toCSV(['Date', 'Debut', 'Fin', 'Duree (h)'], rows);
      const rr = await window.api.saveText({ defaultName: 'periodes-communes.csv', content: csv });
      if (rr.ok) P4.toast('CSV enregistre', 'ok');
    });
  }

  P4.views.common = { render };
})();
