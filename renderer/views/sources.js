(function () {
  'use strict';
  const P4 = window.P4;
  const U = P4.util;

  function feedRow(f, total) {
    return `
      <div class="feed-row" data-fid="${f.id}">
        <div class="row wrap-tight">
          <input class="f-url" placeholder="URL iCal (https://…/agenda.ics)" value="${U.esc(f.url || '')}" style="flex:1;min-width:220px" />
          ${total > 1 ? '<button type="button" class="small danger f-del" title="Retirer cet agenda">retirer</button>' : ''}
        </div>
        <details ${f.pasted ? 'open' : ''}>
          <summary class="muted" style="cursor:pointer">…ou coller le contenu .ics</summary>
          <textarea class="f-paste" rows="3" placeholder="BEGIN:VCALENDAR…">${U.esc(f.pasted || '')}</textarea>
        </details>
        ${f.error ? `<div class="badge danger">Erreur : ${U.esc(f.error)}</div>` : ''}
      </div>`;
  }

  function card(src, idx) {
    const ev = (src.events || []).length;
    const sync = src.lastSync ? U.fmtShort(src.lastSync) + ' ' + U.fmtTime(src.lastSync) : 'jamais';
    const feeds = src.feeds || [];
    return `
      <div class="src-card ${src.error ? 'err' : ''}" data-id="${src.id}">
        <div class="spread">
          <div class="row wrap-tight">
            <span class="dot" style="background:${src.color || U.color(idx)}"></span>
            <input class="s-name" value="${U.esc(src.name)}" style="width:220px" />
            <select class="s-type">
              <option value="teacher" ${src.type === 'teacher' ? 'selected' : ''}>Enseignant</option>
              <option value="project" ${src.type === 'project' ? 'selected' : ''}>Projet</option>
            </select>
            <label><input type="checkbox" class="s-enabled" ${src.enabled === false ? '' : 'checked'} /> actif</label>
          </div>
          <div class="row wrap-tight">
            <span class="badge ${src.type}">${src.type === 'teacher' ? 'enseignant' : 'projet'}</span>
            <span class="muted">${ev} evt${ev > 1 ? 's' : ''} · ${feeds.length} agenda${feeds.length > 1 ? 's' : ''} · maj ${sync}</span>
            <button class="small s-reload" ${src.loading ? 'disabled' : ''}>${src.loading ? '…' : '&#8635; recharger'}</button>
            <button class="small danger s-del">supprimer</button>
          </div>
        </div>
        <div class="stack feeds" style="margin-top:8px">
          ${feeds.map((f) => feedRow(f, feeds.length)).join('')}
          <button type="button" class="small f-add">+ ajouter un agenda</button>
          ${src.type === 'project' ? `
          <div class="row wrap-tight" style="margin-top:2px">
            <label>Encadrement
              <select class="s-sup">
                <option value="full" ${src.supervision !== 'partial' ? 'selected' : ''}>total (toute seance encadree)</option>
                <option value="partial" ${src.supervision === 'partial' ? 'selected' : ''}>partiel (seances sans encadrant admises)</option>
              </select>
            </label>
            <span class="s-part-wrap" ${src.supervision === 'partial' ? '' : 'hidden'}>
              <label>Repartition
                <select class="s-supmode">
                  <option value="hours" ${src.supMode === 'percent' ? '' : 'selected'}>en heures</option>
                  <option value="percent" ${src.supMode === 'percent' ? 'selected' : ''}>en % de seances encadrees</option>
                </select>
              </label>
              <span class="s-mode-hours" ${src.supMode === 'percent' ? 'hidden' : ''}>
                <label>Heures totales <input type="number" class="s-total" min="0" step="1" value="${src.totalHours == null ? '' : src.totalHours}" style="width:70px" placeholder="—" /></label>
                <label>Heures encadrees <input type="number" class="s-sup-h" min="0" step="1" value="${src.supervisedHours == null ? '' : src.supervisedHours}" style="width:70px" placeholder="—" /></label>
              </span>
              <span class="s-mode-pct" ${src.supMode === 'percent' ? '' : 'hidden'}>
                <label>% de seances encadrees <input type="number" class="s-pct" min="0" max="100" step="5" value="${src.supPercent == null ? 100 : src.supPercent}" style="width:64px" /></label>
              </span>
              <span class="muted">&rarr; ${P4.projectUnsupTarget(src)} h non encadrees (cible)</span>
            </span>
          </div>` : ''}
        </div>
      </div>`;
  }

  function render(root) {
    const s = P4.state;
    const teachers = P4.sourcesOfType('teacher');
    const projects = P4.sourcesOfType('project');

    root.innerHTML = `
      <div class="view-head">
        <h1>Agendas</h1>
        <span class="sub">Ajoutez les URL iCal des enseignants et des projets. Le telechargement passe par l'application : pas de blocage CORS.</span>
      </div>

      <div class="panel">
        <h2>Ajouter un agenda</h2>
        <div class="row">
          <input id="add-name" placeholder="Nom (ex : Dupont, ou Projet Web S5)" style="width:260px" />
          <select id="add-type">
            <option value="teacher">Enseignant</option>
            <option value="project">Projet</option>
          </select>
          <input id="add-url" placeholder="URL iCal" style="flex:1;min-width:260px" />
          <button class="primary" id="add-btn">Ajouter</button>
        </div>
        <div class="row" style="margin-top:10px">
          <span class="muted">Import en lot :</span>
          <button id="dl-template">&#8681; Telecharger le modele Excel</button>
          <button id="imp-xlsx">&#8682; Importer un tableau (.xlsx)</button>
        </div>
        <p class="muted" style="margin:8px 0 0">Le modele contient les colonnes <i>Nom, Projet ou encadrant, Encadrement (total / partiel), Heures totales, Heures encadrees, % seances encadrees, Adresse iCal 1, Adresse iCal 2, Adresse iCal 3</i> — jusqu'a 3 agendas par ligne (ex. agenda personnel + agenda etablissement), d'autres colonnes <i>Adresse iCal 4</i>, etc. sont aussi reconnues si besoin. Pour un projet partiel : renseigner <i>Heures totales</i> + <i>Heures encadrees</i> (repartition en heures), <b>ou</b> <i>% seances encadrees</i> (repartition en pourcentage). A l'import, une ligne dont le nom existe deja met a jour l'agenda correspondant : les adresses iCal supplementaires sont ajoutees aux siennes (aucune n'est supprimee). La plage analysee (barre du haut) borne les evenements recurrents charges.</p>
        <div id="imp-warn" class="panel" style="margin:8px 0 0;border-color:#eecece;background:var(--danger-soft)" hidden></div>
      </div>

      <div class="grid2">
        <div class="panel">
          <h2>Enseignants (${teachers.length})</h2>
          <div id="list-teacher">${teachers.map((t) => card(t, P4.state.sources.indexOf(t))).join('') || '<p class="muted">Aucun.</p>'}</div>
        </div>
        <div class="panel">
          <h2>Projets (${projects.length})</h2>
          <div id="list-project">${projects.map((p) => card(p, P4.state.sources.indexOf(p))).join('') || '<p class="muted">Aucun.</p>'}</div>
        </div>
      </div>`;

    root.querySelector('#add-btn').addEventListener('click', () => {
      const name = root.querySelector('#add-name').value.trim();
      const url = root.querySelector('#add-url').value.trim();
      const type = root.querySelector('#add-type').value;
      if (!name) { P4.toast('Nom requis', 'err'); return; }
      const src = {
        id: U.uid(), name, type, enabled: true,
        color: U.color(P4.state.sources.length),
        feeds: [{ id: U.uid(), url, pasted: '', events: [], error: null, lastSync: null }],
        events: [], error: null, lastSync: null
      };
      P4.state.sources.push(src);
      P4.save();
      P4.rerender();
      if (url) P4.refreshSource(src.id);
    });

    root.querySelector('#dl-template').addEventListener('click', async () => {
      const r = await window.api.downloadTemplate();
      if (r && r.ok) P4.toast('Modele enregistre', 'ok');
      else if (r && r.error) P4.toast(r.error, 'err');
    });

    root.querySelector('#imp-xlsx').addEventListener('click', async () => {
      const r = await window.api.importXlsx();
      if (!r || r.canceled) return;
      if (!r.ok) { P4.toast(r.error || 'Import impossible', 'err'); return; }
      let created = 0;
      let updated = 0;
      let skipped = 0;
      let addedFeeds = 0;
      const warns = [];
      (r.rows || []).forEach((row) => {
        if (!row.name) { skipped++; return; }
        const urls = row.urls || [];
        let src = P4.state.sources.find((x) => x.name.trim().toLowerCase() === row.name.trim().toLowerCase());
        if (!src) {
          src = {
            id: U.uid(), name: row.name, type: row.type, enabled: true,
            color: U.color(P4.state.sources.length),
            feeds: urls.length ? urls.map((u) => ({ id: U.uid(), url: u, pasted: '', events: [], error: null, lastSync: null }))
              : [{ id: U.uid(), url: '', pasted: '', events: [], error: null, lastSync: null }],
            events: [], error: null, lastSync: null
          };
          P4.state.sources.push(src);
          created++;
        } else {
          updated++;
          P4.normalizeSource(src);
          const known = new Set(src.feeds.map((f) => (f.url || '').trim()).filter(Boolean));
          urls.forEach((u) => {
            if (!known.has(u)) {
              src.feeds.push({ id: U.uid(), url: u, pasted: '', events: [], error: null, lastSync: null });
              known.add(u);
              addedFeeds++;
            }
          });
        }
        src.name = row.name;
        src.type = row.type;
        if (row.type === 'project') {
          src.supervision = row.supervision;
          src.supMode = row.supMode === 'percent' ? 'percent' : 'hours';
          if (row.supMode === 'percent') {
            src.supPercent = row.supPercent;
          } else {
            src.totalHours = row.totalHours;
            src.supervisedHours = row.supervisedHours;
          }
        }
        (row.warnings || []).forEach((w) => warns.push('Ligne ' + row.row + ' (' + (row.name || '?') + ') : ' + w));
      });
      P4.save();
      P4.rerender();
      P4.toast(created + ' cree(s) · ' + updated + ' mis a jour' + (addedFeeds ? ' · +' + addedFeeds + ' agenda(s) ajoute(s)' : '') + (skipped ? ' · ' + skipped + ' ignore(s)' : '') + (warns.length ? ' · ' + warns.length + ' avertissement(s)' : ''), warns.length ? 'err' : 'ok');
      if (warns.length) {
        const box = document.getElementById('imp-warn');
        if (box) { box.innerHTML = '<b>Avertissements d\'import :</b><ul>' + warns.map((w) => '<li>' + P4.util.esc(w) + '</li>').join('') + '</ul>'; box.hidden = false; }
      }
      P4.refreshAll();
    });

    root.querySelectorAll('.src-card').forEach((cardEl) => {
      const id = cardEl.dataset.id;
      const src = P4.state.sources.find((x) => x.id === id);
      const q = (sel) => cardEl.querySelector(sel);

      q('.s-name').addEventListener('change', (e) => { src.name = e.target.value; P4.save(); });
      q('.s-type').addEventListener('change', (e) => { src.type = e.target.value; P4.save(); P4.rerender(); });
      q('.s-enabled').addEventListener('change', (e) => { src.enabled = e.target.checked; P4.save(); P4.rerender(); });

      cardEl.querySelectorAll('.feed-row').forEach((row) => {
        const fid = row.dataset.fid;
        const feed = (src.feeds || []).find((f) => f.id === fid);
        if (!feed) return;
        row.querySelector('.f-url').addEventListener('change', (e) => { feed.url = e.target.value.trim(); P4.save(); });
        row.querySelector('.f-paste').addEventListener('change', (e) => { feed.pasted = e.target.value; P4.save(); });
        const delBtn = row.querySelector('.f-del');
        if (delBtn) {
          delBtn.addEventListener('click', () => {
            src.feeds = src.feeds.filter((f) => f.id !== fid);
            P4.recomputeSourceEvents(src);
            P4.save();
            P4.rerender();
          });
        }
      });
      q('.f-add').addEventListener('click', () => {
        src.feeds.push({ id: U.uid(), url: '', pasted: '', events: [], error: null, lastSync: null });
        P4.save();
        P4.rerender();
      });
      if (q('.s-sup')) {
        q('.s-sup').addEventListener('change', (e) => {
          src.supervision = e.target.value === 'partial' ? 'partial' : 'full';
          P4.save();
          P4.rerender();
        });
      }
      if (q('.s-supmode')) {
        q('.s-supmode').addEventListener('change', (e) => {
          src.supMode = e.target.value === 'percent' ? 'percent' : 'hours';
          if (src.supMode === 'percent' && src.supPercent == null) src.supPercent = 100;
          P4.save();
          P4.rerender();
        });
      }
      const numField = (sel, key, allowNull) => {
        const el = q(sel);
        if (!el) return;
        el.addEventListener('change', (e) => {
          const v = e.target.value.trim();
          const n = parseFloat(v.replace(',', '.'));
          if (v === '' || isNaN(n) || n < 0) src[key] = allowNull ? null : 0;
          else src[key] = n;
          P4.save();
          P4.rerender();
        });
      };
      numField('.s-total', 'totalHours', true);
      numField('.s-sup-h', 'supervisedHours', true);
      if (q('.s-pct')) {
        q('.s-pct').addEventListener('change', (e) => {
          const n = parseFloat(String(e.target.value).replace(',', '.'));
          src.supPercent = isNaN(n) ? 100 : Math.max(0, Math.min(100, n));
          P4.save();
          P4.rerender();
        });
      }
      q('.s-reload').addEventListener('click', () => P4.refreshSource(id));
      q('.s-del').addEventListener('click', () => {
        if (!confirm('Supprimer « ' + src.name +' » ?')) return;
        P4.state.sources = P4.state.sources.filter((x) => x.id !== id);
        delete P4.state.scheduling.teachers[id];
        P4.save();
        P4.rerender();
      });
    });
  }

  P4.views.sources = { render };
})();
