(function () {
  'use strict';
  const PE = window.PE;
  const U = PE.util;
  const FB = PE.fb;
  const DAYS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

  function busyOf(src) {
    return PE.scheduler.teacherBusy(src.events || [], true);
  }

  /* plages horaires actives, nettoyees */
  function activeRanges(c) {
    const rs = (c.work.ranges || [])
      .map((r) => ({ from: +r.from, to: +r.to }))
      .filter((r) => r.to > r.from);
    return rs.length ? rs : [{ from: +c.work.startH || 8, to: +c.work.endH || 20 }];
  }

  function fmtHour(h) {
    const hh = Math.floor(h);
    const mm = Math.round((h % 1) * 60);
    return mm ? hh + ' h ' + String(mm).padStart(2, '0') : hh + ' h';
  }

  function compute() {
    const c = PE.state.common;
    const chosen = PE.state.sources.filter((s) => c.selected.indexOf(s.id) !== -1 && s.enabled !== false).sort(PE.byName);
    if (chosen.length < 2) return { error: 'Selectionnez au moins 2 agendas.' };

    const wStart = +new Date(PE.state.range.from);
    const wEnd = +new Date(PE.state.range.to + 'T23:59:59');
    const ranges = activeRanges(c);
    const grid = FB.workingWindowRanges(wStart, wEnd, ranges, c.work.days);
    if (!grid.length) return { error: 'La fenetre de recherche est vide (jours / plages horaires).' };

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

    // filtre duree min / max (0 = pas de limite)
    const minMs = Math.max(0, +c.work.durMin || 0) * 3600000;
    const maxMs = Math.max(0, +c.work.durMax || 0) * 3600000;
    if (minMs > 0 || maxMs > 0) {
      res = res.filter((iv) => {
        const d = iv.end - iv.start;
        return d >= minMs - 1e-6 && (maxMs <= 0 || d <= maxMs + 1e-6);
      });
    }

    return {
      intervals: res,
      names: chosen.map((s) => s.name),
      criteria: {
        days: c.work.days.slice(),
        ranges: ranges,
        durMin: Math.max(0, +c.work.durMin || 0),
        durMax: Math.max(0, +c.work.durMax || 0)
      }
    };
  }

  function render(root) {
    const c = PE.state.common;
    const srcs = PE.sortedSources();

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
          <div class="stack" style="min-width:260px">
            <label>Resultat
              <select id="cm-mode">
                <option value="free" ${c.mode === 'free' ? 'selected' : ''}>Creneaux libres communs</option>
                <option value="busy" ${c.mode === 'busy' ? 'selected' : ''}>Creneaux occupes communs</option>
              </select>
            </label>

            <span class="muted">Plages horaires de recherche</span>
            <div id="cm-ranges">
              ${activeRanges(c).map((r, i) => `
                <div class="cm-range row wrap-tight" data-i="${i}">
                  de <input type="number" class="cm-r-from" min="0" max="23.5" step="0.5" value="${r.from}" style="width:60px" />
                  a <input type="number" class="cm-r-to" min="0.5" max="24" step="0.5" value="${r.to}" style="width:60px" />
                  <button class="small cm-r-del" title="retirer cette plage" ${activeRanges(c).length > 1 ? '' : 'disabled'}>&times;</button>
                </div>`).join('')}
            </div>
            <button class="small" id="cm-r-add" ${activeRanges(c).length >= 4 ? 'disabled' : ''}>+ ajouter une plage</button>

            <label>Duree du creneau : min
              <input type="number" id="cm-dmin" min="0" step="0.25" value="${c.work.durMin || 0}" style="width:60px" /> h &nbsp; max
              <input type="number" id="cm-dmax" min="0" step="0.25" value="${c.work.durMax || 0}" style="width:60px" /> h
            </label>
            <span class="muted" style="font-size:11px">0 = pas de limite. Le max exclut les creneaux plus longs.</span>

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
      PE.save();
    }));
    root.querySelector('#cm-mode').addEventListener('change', (e) => { c.mode = e.target.value; PE.save(); });

    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, isNaN(v) ? lo : v));
    const resyncSpan = () => {
      const rs = activeRanges(c);
      c.work.startH = Math.min.apply(null, rs.map((r) => r.from));
      c.work.endH = Math.max.apply(null, rs.map((r) => r.to));
    };
    const ensureRanges = () => {
      if (!Array.isArray(c.work.ranges) || !c.work.ranges.length) {
        c.work.ranges = [{ from: +c.work.startH || 8, to: +c.work.endH || 20 }];
      }
    };
    root.querySelectorAll('.cm-range').forEach((el) => {
      const i = +el.dataset.i;
      el.querySelector('.cm-r-from').addEventListener('change', (e) => {
        ensureRanges();
        c.work.ranges[i].from = clamp(+e.target.value, 0, 23.5);
        if (c.work.ranges[i].to <= c.work.ranges[i].from) c.work.ranges[i].to = Math.min(24, c.work.ranges[i].from + 0.5);
        resyncSpan(); PE.save(); PE.rerender();
      });
      el.querySelector('.cm-r-to').addEventListener('change', (e) => {
        ensureRanges();
        c.work.ranges[i].to = clamp(+e.target.value, 0.5, 24);
        if (c.work.ranges[i].to <= c.work.ranges[i].from) c.work.ranges[i].from = Math.max(0, c.work.ranges[i].to - 0.5);
        resyncSpan(); PE.save(); PE.rerender();
      });
      el.querySelector('.cm-r-del').addEventListener('click', () => {
        ensureRanges();
        if (c.work.ranges.length > 1) c.work.ranges.splice(i, 1);
        resyncSpan(); PE.save(); PE.rerender();
      });
    });
    root.querySelector('#cm-r-add').addEventListener('click', () => {
      ensureRanges();
      if (c.work.ranges.length < 4) {
        const last = c.work.ranges[c.work.ranges.length - 1];
        const from = Math.min(22, (last ? last.to : 8));
        c.work.ranges.push({ from: from, to: Math.min(24, from + 2) });
      }
      resyncSpan(); PE.save(); PE.rerender();
    });
    root.querySelector('#cm-dmin').addEventListener('change', (e) => { c.work.durMin = Math.max(0, +e.target.value || 0); PE.save(); });
    root.querySelector('#cm-dmax').addEventListener('change', (e) => { c.work.durMax = Math.max(0, +e.target.value || 0); PE.save(); });

    root.querySelectorAll('.cm-day').forEach((cb) => cb.addEventListener('change', () => {
      c.work.days = Array.from(root.querySelectorAll('.cm-day')).filter((x) => x.checked).map((x) => +x.value);
      PE.save();
    }));
    root.querySelector('#cm-run').addEventListener('click', () => {
      c.result = compute();
      PE.save();
      paint(root.querySelector('#cm-out'));
    });

    if (c.result) paint(root.querySelector('#cm-out'));
  }

  function paint(out) {
    const r = PE.state.common.result;
    if (!r) { out.innerHTML = ''; return; }
    if (r.error) { out.innerHTML = `<div class="panel"><span class="badge danger">${U.esc(r.error)}</span></div>`; return; }

    const groups = {};
    r.intervals.forEach((iv) => {
      const k = U.dayKey(iv.start);
      (groups[k] = groups[k] || []).push(iv);
    });
    const keys = Object.keys(groups).sort();
    const total = Math.round(FB.totalHours(r.intervals) * 10) / 10;

    const cr = r.criteria;
    let crLine = '';
    if (cr) {
      const dayTxt = cr.days.slice().sort((a, b) => ((a === 0 ? 7 : a) - (b === 0 ? 7 : b))).map((d) => DAYS[d]).join(', ');
      const rgTxt = cr.ranges.map((x) => fmtHour(x.from) + '–' + fmtHour(x.to)).join(' · ');
      const durTxt = (cr.durMin || cr.durMax)
        ? ' · duree ' + (cr.durMin ? '≥ ' + cr.durMin + ' h' : '') + (cr.durMin && cr.durMax ? ' et ' : '') + (cr.durMax ? '≤ ' + cr.durMax + ' h' : '')
        : '';
      crLine = `<div class="muted" style="font-size:12px;margin:2px 0 8px">${U.esc(dayTxt)} · ${U.esc(rgTxt)}${durTxt}</div>`;
    }

    out.innerHTML = `
      <div class="panel">
        <div class="spread">
          <h2 style="margin:0">${PE.state.common.mode === 'free' ? 'Libres ensemble' : 'Occupes ensemble'} — ${U.esc(r.names.join(', '))}</h2>
          <div class="row">
            <span class="badge ok">${total} h</span>
            <span class="badge">${r.intervals.length} creneau(x)</span>
            <button class="small" id="cm-csv">CSV</button>
          </div>
        </div>
        ${crLine}
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
        }).join('') : '<p class="muted">Aucun creneau commun avec ces jours, plages horaires et duree.</p>'}
      </div>`;

    const csvBtn = out.querySelector('#cm-csv');
    if (csvBtn) csvBtn.addEventListener('click', async () => {
      const rows = r.intervals.map((iv) => [
        U.fmtShort(iv.start), U.fmtTime(iv.start), U.fmtTime(iv.end),
        Math.round((iv.end - iv.start) / 360000) / 10
      ]);
      const csv = PE.exp.toCSV(['Date', 'Debut', 'Fin', 'Duree (h)'], rows);
      const rr = await window.api.saveText({ defaultName: 'periodes-communes.csv', content: csv });
      if (rr.ok) PE.toast('CSV enregistre', 'ok');
    });
  }

  PE.views.common = { render };
})();
