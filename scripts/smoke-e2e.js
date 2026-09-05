'use strict';

/* End-to-end smoke test, run inside the real app with `electron . --smoke`
   (see README > Verification). Exercises every tab and feature through the
   real IPC + renderer, headless. Kept out of main.js so the production
   window-creation code stays short; this module is only ever require()'d
   when --smoke is passed. */

const path = require('path');
const fs = require('fs');
const APP_ROOT = path.join(__dirname, '..');

function attach(win, deps) {
  const app = deps.app;
  const BrowserWindow = deps.BrowserWindow;

  win.webContents.on('console-message', (_e, lvl, msg) => {
    if (lvl >= 2) console.log('SMOKE-CONSOLE[' + lvl + '] ' + msg);
  });
  win.webContents.once('did-finish-load', async () => {
    try {
      await new Promise((r) => setTimeout(r, 2000));
      const probe = await win.webContents.executeJavaScript(
        'JSON.stringify({ hasPE: !!window.PE, tab: window.PE && window.PE.state && window.PE.state.ui.tab,' +
        ' views: window.PE && Object.keys(window.PE.views || {}),' +
        ' viewChildren: document.getElementById("view").children.length,' +
        ' tabsWired: document.querySelectorAll(".tab").length, errors: window.__errors })'
      );
      console.log('SMOKE-PROBE ' + probe);
      // exercise each tab
      for (const t of ['planning', 'common', 'scheduling', 'sources']) {
        await win.webContents.executeJavaScript('window.PE.setTab(' + JSON.stringify(t) + ')');
        await new Promise((r) => setTimeout(r, 250));
        const st = await win.webContents.executeJavaScript(
          'JSON.stringify({ tab: ' + JSON.stringify(t) + ', children: document.getElementById("view").children.length, errors: window.__errors.length })'
        );
        console.log('SMOKE-TAB ' + st);
      }
      // end-to-end: feed the sample calendars through the real IPC + views
      const rd = (f) => fs.readFileSync(path.join(APP_ROOT, 'samples', f), 'utf8');
      const e2e = {
        martin: rd('enseignant-martin.ics'),
        durand: rd('enseignant-durand.ics'),
        projet: rd('projet-encadrement.ics')
      };
      await win.webContents.executeJavaScript(`(async () => {
        const PE = window.PE;
        PE.state.range.from = '2026-09-01'; PE.state.range.to = '2027-01-31';
        const mk = (name, type, txt, i) => ({ id: PE.util.uid(), name, type,
          enabled: true, color: PE.util.color(i),
          feeds: [{ id: PE.util.uid(), url: '', pasted: txt, events: [], error: null, lastSync: null }],
          events: [], error: null, lastSync: null });
        PE.state.sources = [
          mk('Martin', 'teacher', ${JSON.stringify(e2e.martin)}, 0),
          mk('Durand', 'teacher', ${JSON.stringify(e2e.durand)}, 1),
          mk('Projet projet-encadrement', 'project', ${JSON.stringify(e2e.projet)}, 2)
        ];
        await PE.refreshAll();
      })()`);
      await new Promise((r) => setTimeout(r, 800));
      const e2eProbe = await win.webContents.executeJavaScript(
        'JSON.stringify({ evTotal: window.PE.enabledEvents().length,' +
        ' sessions: window.PE.sessions().length,' +
        ' srcErrors: window.PE.state.sources.map((s) => s.error).filter(Boolean) })'
      );
      console.log('SMOKE-E2E-LOAD ' + e2eProbe);
      await win.webContents.executeJavaScript('window.PE.setTab("scheduling")');
      await new Promise((r) => setTimeout(r, 300));
      const auto = await win.webContents.executeJavaScript(
        'document.querySelector("#o-run").click();' +
        'new Promise((res) => setTimeout(() => res(JSON.stringify({' +
        ' rows: document.querySelectorAll("table.grid:last-of-type tbody tr").length,' +
        ' unfilled: document.querySelectorAll("table.grid:last-of-type tbody tr.unfilled").length,' +
        ' choice: document.querySelectorAll("table.grid:last-of-type tbody tr.choice").length,' +
        ' load: window.PE.state.scheduling.lastResult && window.PE.state.scheduling.lastResult.load,' +
        ' errors: window.__errors.length })), 400))'
      );
      console.log('SMOKE-E2E-AUTO ' + auto);

      // per-project team: tick only Durand's checkbox via the UI, re-run, expect gaps
      const team = await win.webContents.executeJavaScript(`(() => {
        const PE = window.PE;
        const durand = PE.state.sources.find((s) => s.name === 'Durand');
        const cb = document.querySelector('.team-on[data-tid="' + durand.id + '"]');
        const before = { checkboxes: document.querySelectorAll('.team-on').length,
          wDisabledBefore: (document.querySelector('.team-w[data-tid="' + durand.id + '"]') || {}).disabled };
        cb.checked = true; cb.dispatchEvent(new Event('change'));
        return new Promise((res) => setTimeout(() => {
          document.querySelector('#o-run').click();
          setTimeout(() => {
            const lr = PE.state.scheduling.lastResult;
            const asg = Object.values(lr.assignments);
            res(JSON.stringify(Object.assign(before, {
              wEnabledAfter: !(document.querySelector('.team-w[data-tid="' + durand.id + '"]') || {}).disabled,
              onlyDurand: asg.every((a) => a.every((t) => t === durand.id)),
              unfilled: lr.unfilled.length,
              errors: window.__errors.length
            })));
          }, 400);
        }, 200));
      })()`);
      console.log('SMOKE-E2E-TEAM ' + team);

      // swap the proposed encadrant on the first still-filled row
      const swap = await win.webContents.executeJavaScript(`(() => {
        const PE = window.PE;
        PE.state.scheduling.teams = {};
        PE.rerender();
        document.querySelector('#o-run').click();
        return new Promise((res) => setTimeout(() => {
          const sel = document.querySelector('table.grid:last-of-type select.swap');
          if (!sel) return res(JSON.stringify({ found: false }));
          const before = sel.value;
          const alt = Array.from(sel.options).map((o) => o.value)
            .find((v) => v && v !== before && v !== '__rm__');
          let changed = false;
          if (alt) { sel.value = alt; sel.dispatchEvent(new Event('change')); changed = true; }
          setTimeout(() => res(JSON.stringify({ found: true, before, alt, changed, errors: window.__errors.length })), 300);
        }, 400));
      })()`);
      console.log('SMOKE-E2E-SWAP ' + swap);

      // repartition view switch: par projet / par encadrant
      const views = await win.webContents.executeJavaScript(`(async () => {
        const out = {};
        for (const v of ['project', 'teacher', 'session']) {
          const btn = document.querySelector('.viewbtn[data-view="' + v + '"]');
          btn.click();
          await new Promise((r) => setTimeout(r, 200));
          out[v] = { groups: document.querySelectorAll('.grp-head').length,
            tables: document.querySelectorAll('.panel table.grid').length,
            stored: window.PE.state.scheduling.view };
        }
        out.errors = window.__errors.length;
        return JSON.stringify(out);
      })()`);
      console.log('SMOKE-E2E-VIEWS ' + views);

      // per-project balance sheet (still on the scheduling tab)
      const bilan = await win.webContents.executeJavaScript(`(() => {
        const t = Array.from(document.querySelectorAll('h2')).find((h) => h.textContent.indexOf('Bilan par projet') !== -1);
        const table = t ? t.parentElement.querySelector('table.grid') : null;
        const rows = table ? Array.from(table.querySelectorAll('tbody tr'))
          .map((tr) => Array.from(tr.children).map((td) => td.textContent.replace(/\\s+/g, ' ').trim())) : null;
        return JSON.stringify({ hasBilan: !!t, rows: rows, errors: window.__errors.length });
      })()`);
      console.log('SMOKE-E2E-BILAN ' + bilan);

      // weight-driven distribution + "sans encadrant" weight column (fully-free team)
      const weights = await win.webContents.executeJavaScript(`(() => {
        const PE = window.PE;
        const proj = PE.state.sources.find((s) => s.type === 'project');
        const M = PE.state.sources.find((s) => s.name === 'Martin');
        const D = PE.state.sources.find((s) => s.name === 'Durand');
        // free both teachers so the weights actually drive the split
        M.feeds[0].pasted = 'BEGIN:VCALENDAR\\nVERSION:2.0\\nPRODID:-//x//EN\\nEND:VCALENDAR';
        D.feeds[0].pasted = M.feeds[0].pasted; M.events = []; D.events = [];
        PE.state.scheduling.teams = { [proj.id]: {
          [M.id]: { on: true, w: 3 }, [D.id]: { on: true, w: 1 }, __nosup__: { on: true, w: 2 }
        } };
        PE.rerender();
        const nosupCell = document.querySelector('.team-on[data-tid="__nosup__"]');
        document.querySelector('#o-run').click();
        return new Promise((res) => setTimeout(() => {
          const lr = PE.state.scheduling.lastResult;
          const asg = Object.values(lr.assignments);
          const m = asg.filter((a) => a[0] === M.id).length;
          const d = asg.filter((a) => a[0] === D.id).length;
          res(JSON.stringify({
            nosupColumn: !!nosupCell,
            nosupCount: (lr.noSup || []).length,
            unsupHours: lr.unsupHours && lr.unsupHours[proj.id],
            targetM: lr.target && Math.round(lr.target[M.id] || 0),
            targetD: lr.target && Math.round(lr.target[D.id] || 0),
            staffed: { M: m, D: d },
            mAboutTripleD: m >= d * 2 && m + d === 6,
            errors: window.__errors.length
          }));
        }, 500));
      })()`);
      console.log('SMOKE-E2E-WEIGHTS ' + weights);
      await win.webContents.executeJavaScript(`(async () => {
        const PE = window.PE;
        PE.state.scheduling.teams = {}; PE.state.scheduling.lastResult = null;
        const M = PE.state.sources.find((s) => s.name === 'Martin');
        const D = PE.state.sources.find((s) => s.name === 'Durand');
        M.feeds[0].pasted = ${JSON.stringify(e2e.martin)}; D.feeds[0].pasted = ${JSON.stringify(e2e.durand)};
        await PE.refreshAll();
      })()`);

      // partial supervision + explicit "sans encadrant"
      const nosup = await win.webContents.executeJavaScript(`(() => {
        const PE = window.PE;
        const proj = PE.state.sources.find((s) => s.type === 'project');
        proj.supervision = 'partial';
        proj.unsupHours = 8;
        PE.state.scheduling.view = 'session';
        PE.rerender();
        document.querySelector('#o-run').click();
        return new Promise((res) => setTimeout(() => {
          const lr = PE.state.scheduling.lastResult;
          const before = { autoNoSup: (lr.noSup || []).length, unfilled: lr.unfilled.length };
          const cb = document.querySelector('.nosup-cb');
          const sid = cb.dataset.sid;
          cb.checked = true; cb.dispatchEvent(new Event('change'));
          setTimeout(() => {
            res(JSON.stringify(Object.assign(before, {
              declaredSid: sid,
              nosupRows: document.querySelectorAll('table.grid tr.nosup').length,
              explicitStored: !!PE.state.scheduling.noSup[sid],
              errors: window.__errors.length
            })));
          }, 350);
        }, 400));
      })()`);
      console.log('SMOKE-E2E-NOSUP ' + nosup);

      await win.webContents.executeJavaScript('window.PE.setTab("common")');
      await new Promise((r) => setTimeout(r, 200));
      const common = await win.webContents.executeJavaScript(`(() => {
        const c = window.PE.state.common;
        c.selected = window.PE.state.sources.filter((s) => s.type === 'teacher').map((s) => s.id);
        c.mode = 'free';
        document.querySelector('#cm-run') && document.querySelector('#cm-run').click();
        return JSON.stringify({ hasResult: !!c.result, intervals: c.result && c.result.intervals && c.result.intervals.length });
      })()`);
      console.log('SMOKE-E2E-COMMON ' + common);

      const imp = await win.webContents.executeJavaScript(`(() => {
        const PE = window.PE;
        PE.setTab('sources');
        const proj = PE.state.sources.find((s) => s.type === 'project');
        proj.supervision = 'partial'; proj.supMode = 'percent'; proj.supPercent = 75;
        PE.rerender();
        const sel = document.querySelector('.src-card[data-id="' + proj.id + '"] .s-supmode');
        const pctIn = document.querySelector('.src-card[data-id="' + proj.id + '"] .s-pct');
        const target = PE.projectUnsupTarget(proj); // 8 sessions x 4h = 32h ; 75% -> 8h
        return JSON.stringify({
          dlBtn: !!document.querySelector('#dl-template'),
          impBtn: !!document.querySelector('#imp-xlsx'),
          apiDl: typeof window.api.downloadTemplate === 'function',
          apiImp: typeof window.api.importXlsx === 'function',
          modeSelect: !!sel, modeValue: sel && sel.value, pctInput: !!pctIn, pctValue: pctIn && pctIn.value,
          unsupTargetH: target,
          errors: window.__errors.length
        });
      })()`);
      console.log('SMOKE-E2E-IMPORT ' + imp);

      // multiple iCal feeds per encadrant, added/removed directly in the app
      const feeds = await win.webContents.executeJavaScript(`(() => {
        const PE = window.PE;
        const M = PE.state.sources.find((s) => s.name === 'Martin');
        const before = M.feeds.length;
        const card = () => document.querySelector('.src-card[data-id="' + M.id + '"]');
        card().querySelector('.f-add').click();
        const afterAdd = M.feeds.length;
        const rows = card().querySelectorAll('.feed-row');
        const urlInput = rows[rows.length - 1].querySelector('.f-url');
        urlInput.value = 'https://exemple.fr/martin-etab.ics';
        urlInput.dispatchEvent(new Event('change'));
        const savedUrl = M.feeds[1].url;
        const mergedEvents = PE.teacherModels().find((t) => t.id === M.id).events.length;
        const feedRows = card().querySelectorAll('.feed-row');
        const delBtn = feedRows[feedRows.length - 1].querySelector('.f-del');
        const hasDel = !!delBtn;
        if (delBtn) delBtn.click();
        const afterDel = M.feeds.length;
        return JSON.stringify({ before, afterAdd, savedUrl, mergedEvents, hasDel, afterDel, errors: window.__errors.length });
      })()`);
      console.log('SMOKE-E2E-FEEDS ' + feeds);
      try {
        // force a partially-available encadrant so the report shows supervision slots
        await win.webContents.executeJavaScript(`(async () => {
          const PE = window.PE;
          const D = PE.state.sources.find((s) => s.name === 'Durand');
          // Durand busy 13:00-15:00 on 25/09 -> partial cover of that 13-17 session
          D.feeds[0].pasted = 'BEGIN:VCALENDAR\\nVERSION:2.0\\nPRODID:-//x//EN\\nBEGIN:VEVENT\\nUID:pp1\\nDTSTAMP:20260101T000000Z\\nDTSTART;TZID=Europe/Paris:20260925T130000\\nDTEND;TZID=Europe/Paris:20260925T150000\\nSUMMARY:reunion\\nEND:VEVENT\\nEND:VCALENDAR';
          PE.state.scheduling.teams = {}; PE.state.scheduling.locked = {}; PE.state.scheduling.noSup = {};
          await PE.refreshAll();
          PE.setTab('scheduling');
        })()`);
        await new Promise((r) => setTimeout(r, 400));
        // pin Durand on the 25/09 session (he only covers 15:00-17:00)
        await win.webContents.executeJavaScript(`(() => {
          const PE = window.PE;
          const D = PE.state.sources.find((s) => s.name === 'Durand');
          const s = PE.sessions().find((x) => x.start.indexOf('2026-09-25') !== -1);
          PE.state.scheduling.locked[s.id] = [D.id];
          PE.state.scheduling.lastResult = null;
          PE.rerender();
          document.querySelector('#o-run').click();
        })()`);
        await new Promise((r) => setTimeout(r, 400));
        const html = await win.webContents.executeJavaScript('window.PE.views.scheduling._report()');
        const rw = new BrowserWindow({ show: false, width: 900, height: 1400, webPreferences: { javascript: false } });
        const rt = path.join(app.getPath('temp'), 'projet-encadrement-smoke-report-' + Date.now() + '.html');
        fs.writeFileSync(rt, html, 'utf8');
        await rw.loadFile(rt);
        await new Promise((r) => setTimeout(r, 250));
        const rbuf = await rw.webContents.printToPDF({ pageSize: 'A4', printBackground: true });
        const rpng = await rw.webContents.capturePage();
        rw.destroy();
        try { fs.unlinkSync(rt); } catch (_) { /* ignore */ }
        const shotA = process.argv.find((a) => a.startsWith('--shot='));
        if (shotA) {
          try { fs.writeFileSync(shotA.slice(7).replace(/\.png$/, '') + '-report.png', rpng.toPNG()); } catch (_) { /* ignore */ }
          try { fs.writeFileSync(shotA.slice(7).replace(/\.png$/, '') + '-report.pdf', rbuf); } catch (_) { /* ignore */ }
        }
        console.log('SMOKE-E2E-PDF ' + JSON.stringify({
          htmlLen: html.length,
          hasEdite: /Edite le /.test(html),
          hasPerEncadrant: html.indexOf('Repartition par encadrant') !== -1,
          hasHeuresParProjet: /<th class="r">Heures<\/th>/.test(html),
          hasColours: html.indexOf('st-ok') !== -1 && html.indexOf('background: #2563eb') !== -1,
          hasSlots: /\d\d:\d\d.\d\d:\d\d/.test(html),
          hasBilanSeance: html.indexOf('Bilan par seance') !== -1 && html.indexOf('<th>Disponibilites</th>') !== -1,
          hasPageBreaks: (html.match(/class="tb pagebreak"/g) || []).length > 0,
          pdfBytes: rbuf.length,
          isPdf: rbuf.slice(0, 5).toString('latin1') === '%PDF-'
        }));
      } catch (e) {
        console.log('SMOKE-E2E-PDF FAIL ' + ((e && e.stack) || e));
      }
      try {
        const XL = require(path.join(APP_ROOT, 'lib', 'xlsx'));
        const b = await XL.buildTemplateBuffer();
        console.log('SMOKE-E2E-XLSX ' + JSON.stringify({ bytes: Buffer.from(b).length, pk: Buffer.from(b).slice(0, 2).toString('latin1') === 'PK' }));
      } catch (e) {
        console.log('SMOKE-E2E-XLSX FAIL ' + (e && e.message));
      }

      const assist = await win.webContents.executeJavaScript(`(() => {
        const PE = window.PE;
        // ensure a plain auto assignment so loads exist
        PE.state.scheduling.teams = {}; PE.state.scheduling.locked = {}; PE.state.scheduling.noSup = {};
        PE.state.scheduling.lastResult = null; PE.rerender();
        document.querySelector('#o-run') && document.querySelector('#o-run').click();
        const A = PE.views.assistant;
        const r1 = A._answer('seances ou Martin peut remplacer Durand');
        const r2 = A._answer('reequilibrer les heures entre Martin et Durand');
        const r3 = A._answer('creneaux libres communs de Martin et Durand');
        const r4 = A._answer('charge de Martin');
        const r5 = A._answer('qui est libre le 25/09 apres-midi');
        PE.setTab('assistant');
        const hasTab = !!document.querySelector('.tab[data-tab="assistant"]');
        const hasForm = !!document.querySelector('#as-form');
        return JSON.stringify({
          hasTab: hasTab, hasForm: hasForm,
          replace: /peut la remplacer|peut en reprendre|Remplacer|encadre aucune/.test(r1.html),
          balance: /rééquilibr|transfert|écart|Appliquer|rien à rééquilibrer/i.test(r2.html),
          common: /Créneaux libres communs|Aucun créneau/.test(r3.html),
          load: /Cible|Affecté/.test(r4.html),
          date: /Disponibilités le/.test(r5.html),
          errors: window.__errors.length
        });
      })()`);
      console.log('SMOKE-E2E-ASSISTANT ' + assist);

      // recurring half-day unavailability, added directly in the Agendas tab
      const indispo = await win.webContents.executeJavaScript(`(async () => {
        const PE = window.PE;
        PE.state.scheduling.teams = {}; PE.state.scheduling.locked = {};
        PE.state.scheduling.noSup = {}; PE.state.scheduling.lastResult = null;
        const D = PE.state.sources.find((s) => s.name === 'Durand');
        PE.setTab('sources'); PE.rerender();
        const card = document.querySelector('.src-card[data-id="' + D.id + '"]');
        const hasBlock = !!card.querySelector('.indispo-block');
        card.querySelector('.id-add').click();
        // sessions of the sample project are all Friday afternoons -> slot 9
        const row = document.querySelector('.src-card[data-id="' + D.id + '"] .indispo-row');
        const setSel = (sel, v) => { const el = row.querySelector(sel); el.value = String(v); el.dispatchEvent(new Event('change')); };
        setSel('.id-from', 9); setSel('.id-to', 9); setSel('.id-deg', 2);
        const stored = JSON.stringify(PE.state.scheduling.teachers[D.id].indispo);
        PE.setTab('scheduling');
        document.querySelector('#o-run').click();
        return new Promise((res) => setTimeout(() => {
          const lr = PE.state.scheduling.lastResult;
          const asg = Object.values(lr.assignments);
          res(JSON.stringify({
            hasBlock: hasBlock,
            stored: stored,
            durandStaffed: asg.filter((a) => a.indexOf(D.id) !== -1).length,
            errors: window.__errors.length
          }));
        }, 500));
      })()`);
      console.log('SMOKE-E2E-INDISPO ' + indispo);

      const shotArg = process.argv.find((a) => a.startsWith('--shot='));
      if (shotArg) {
        await win.webContents.executeJavaScript('window.PE.setTab("sources")');
        await new Promise((r) => setTimeout(r, 300));
        win.setContentSize(1440, 1200);
        await new Promise((r) => setTimeout(r, 300));
        const im = await win.webContents.capturePage();
        fs.writeFileSync(shotArg.slice(7).replace(/\.png$/, '') + '-indispo.png', im.toPNG());
        console.log('SMOKE-SHOT ' + shotArg.slice(7).replace(/\.png$/, '') + '-indispo.png');
      }
      if (shotArg) {
        await win.webContents.executeJavaScript(`(() => {
          const PE = window.PE;
          const A = PE.views.assistant;
          PE.state.assistant.log = [];
          const ask = (q) => { PE.state.assistant.log.push({ role: 'user', text: q }); PE.state.assistant.log.push({ role: 'bot', html: A._answer(q).html }); };
          ask('seances ou Martin peut remplacer Durand');
          ask('reequilibrer les heures entre Martin et Durand');
          PE.setTab('assistant');
        })()`);
        await new Promise((r) => setTimeout(r, 500));
        win.setContentSize(1440, 1700);
        await new Promise((r) => setTimeout(r, 400));
        const img = await win.webContents.capturePage();
        fs.writeFileSync(shotArg.slice(7), img.toPNG());
        console.log('SMOKE-SHOT ' + shotArg.slice(7));
      }

      // "supprimer tous les encadrants" / "supprimer tous les projets" —
      // run last : leaves the app (and its real persisted project.json,
      // --smoke uses the same userData path) with an empty project once the
      // suite finishes, and every earlier test above still ran against the
      // full Martin/Durand/Projet projet-encadrement fixture.
      const wipe = await win.webContents.executeJavaScript(`(() => {
        window.confirm = () => true; // auto-accept the confirmation dialogs
        const PE = window.PE;
        PE.setTab('sources');
        PE.rerender();
        const before = { teachers: PE.sourcesOfType('teacher').length, projects: PE.sourcesOfType('project').length };
        document.querySelector('#del-all-teachers').click();
        const afterTeachers = { teachers: PE.sourcesOfType('teacher').length, teacherBtn: !!document.querySelector('#del-all-teachers') };
        document.querySelector('#del-all-projects').click();
        const afterProjects = { projects: PE.sourcesOfType('project').length, projectBtn: !!document.querySelector('#del-all-projects') };
        return JSON.stringify({
          before, afterTeachers, afterProjects,
          sourcesEmpty: PE.state.sources.length === 0,
          teamsEmpty: Object.keys(PE.state.scheduling.teams).length === 0,
          lockedEmpty: Object.keys(PE.state.scheduling.locked).length === 0,
          errors: window.__errors.length
        });
      })()`);
      console.log('SMOKE-E2E-WIPE ' + wipe);
      await new Promise((r) => setTimeout(r, 500)); // let the debounced PE.save() flush to disk

      const finalErrors = await win.webContents.executeJavaScript('JSON.stringify(window.__errors)');
      console.log('SMOKE-ERRORS ' + finalErrors);
      app.exit(finalErrors === '[]' ? 0 : 1);
    } catch (err) {
      console.log('SMOKE-FAIL ' + ((err && err.stack) || err));
      app.exit(2);
    }
  });
}

module.exports = { attach };
