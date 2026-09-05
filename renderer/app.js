/* Store, helpers, tab navigation. Views register into PE.views. */
(function () {
  'use strict';
  window.PE = window.PE || {};
  const PE = window.PE;
  PE.views = {};

  /* ---------------- utilities ---------------- */
  const PALETTE = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2',
    '#db2777', '#65a30d', '#ea580c', '#4f46e5', '#0d9488', '#9333ea'];

  const dayFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const timeFmt = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const shortFmt = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });

  PE.util = {
    uid() { return 's-' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4); },
    esc(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
      ));
    },
    color(i) { return PALETTE[i % PALETTE.length]; },
    fmtDay(d) { return dayFmt.format(d instanceof Date ? d : new Date(d)); },
    fmtTime(d) { return timeFmt.format(d instanceof Date ? d : new Date(d)); },
    fmtShort(d) { return shortFmt.format(d instanceof Date ? d : new Date(d)); },
    fmtRange(a, b) { return PE.util.fmtTime(a) + '–' + PE.util.fmtTime(b); },
    hours(a, b) { return (+new Date(b) - +new Date(a)) / 3600000; },
    monthKey(d) {
      d = d instanceof Date ? d : new Date(d);
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    },
    monthLabel(mk) {
      const [y, m] = mk.split('-').map(Number);
      return new Intl.DateTimeFormat('fr-FR', { month: 'short', year: 'numeric' })
        .format(new Date(y, m - 1, 1));
    },
    dayKey(d) {
      d = d instanceof Date ? d : new Date(d);
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
  };

  /* ---------------- state ---------------- */
  function defaultRange() {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(now.getFullYear(), now.getMonth() + 9, 0);
    return { from: PE.util.dayKey(from), to: PE.util.dayKey(to) };
  }

  PE.DEFAULT_STATE = function () {
    return {
      version: 1,
      range: defaultRange(),
      sources: [],
      scheduling: {
        options: {
          targetPerSession: 1,
          minPerSession: 1,
          sessionHours: 4,
          sessionMaxH: 12,
          prefWeight: 1,
          respectMaxHours: false,
          allDayBusy: true
        },
        teachers: {},         // sourceId -> { preferred: [{from,to}], maxHours: number|null }
        teams: {},            // projectSourceId -> { teacherSourceId: {on,w} }  (aucune coche = tous eligibles)
        locked: {},           // sessionId -> [sourceId]
        noSup: {},            // sessionId -> true  (seance declaree "sans encadrant")
        view: 'session',      // 'session' | 'project' | 'teacher' -- vue de la repartition
        lastResult: null      // { assignments, unfilled, conflicts, load } cached for display
      },
      common: {
        selected: [],         // sourceId[]
        mode: 'free',          // 'free' | 'busy'
        work: { days: [1, 2, 3, 4, 5], startH: 8, endH: 20 },
        result: null
      },
      planning: { sources: null, type: 'all', q: '' },
      assistant: { log: [] },
      ui: { tab: 'sources' }
    };
  };

  PE.migrate = function (data) {
    data = data || {};
    const s = PE.DEFAULT_STATE();

    if (data.version != null) s.version = data.version;
    if (Array.isArray(data.sources)) s.sources = data.sources;
    s.sources.forEach((src) => PE.normalizeSource(src));
    if (data.range && typeof data.range === 'object') s.range = Object.assign(s.range, data.range);

    const dsch = data.scheduling || {};
    s.scheduling.options = Object.assign(s.scheduling.options, dsch.options || {});
    ['bufferMin', 'tolMin', 'balanceWeight'].forEach((k) => { delete s.scheduling.options[k]; });
    if (dsch.teachers && typeof dsch.teachers === 'object') s.scheduling.teachers = dsch.teachers;
    if (dsch.locked && typeof dsch.locked === 'object') s.scheduling.locked = dsch.locked;
    if (dsch.noSup && typeof dsch.noSup === 'object') s.scheduling.noSup = dsch.noSup;
    if (['session', 'project', 'teacher'].indexOf(dsch.view) !== -1) s.scheduling.view = dsch.view;
    if (dsch.lastResult) s.scheduling.lastResult = dsch.lastResult;
    s.scheduling.teams = (dsch.teams && typeof dsch.teams === 'object' && !Array.isArray(dsch.teams)) ? dsch.teams : {};
    // teams cell = { on: bool, w: number }. Accept the older forms too :
    //   [tid, ...]            (array of members)
    //   { tid: weightNumber } (weight, 0 = not a member)
    Object.keys(s.scheduling.teams).forEach((pid) => {
      const v = s.scheduling.teams[pid];
      const m = {};
      if (Array.isArray(v)) {
        v.forEach((tid) => { m[tid] = { on: true, w: 1 }; });
      } else if (v && typeof v === 'object') {
        Object.keys(v).forEach((tid) => {
          const c = v[tid];
          if (typeof c === 'number') m[tid] = { on: c > 0, w: c > 0 ? c : 1 };
          else if (c && typeof c === 'object') {
            m[tid] = { on: !!c.on, w: (c.w == null || isNaN(+c.w)) ? 1 : +c.w };
          }
        });
      }
      s.scheduling.teams[pid] = m;
    });

    const dc = data.common || {};
    s.common = Object.assign(s.common, dc);
    s.common.work = Object.assign(PE.DEFAULT_STATE().common.work, dc.work || {});
    s.planning = Object.assign(s.planning, data.planning || {});
    if (data.assistant && Array.isArray(data.assistant.log)) s.assistant.log = data.assistant.log.slice(-24);
    s.ui = Object.assign(s.ui, data.ui || {});
    return s;
  };

  PE.state = PE.DEFAULT_STATE();

  PE.serialize = function () { return JSON.parse(JSON.stringify(PE.state)); };

  let saveTimer = null;
  PE.save = function () {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { window.api.saveProject(PE.serialize()); }, 350);
  };

  /* ---------------- derived data ---------------- */
  /* Alphabetical by name (accent- and case-insensitive, natural number
     order). Every list of encadrants / projets in the app is displayed
     through sourcesOfType / sortedSources, so ordering lives here rather
     than in each view. `PE.state.sources` itself keeps insertion order. */
  PE.byName = function (a, b) {
    return String((a && a.name) || '').localeCompare(
      String((b && b.name) || ''), 'fr', { sensitivity: 'base', numeric: true });
  };
  PE.sourcesOfType = function (type) {
    return PE.state.sources.filter((s) => s.type === type).sort(PE.byName);
  };
  PE.sortedSources = function () {
    return PE.state.sources.slice().sort(PE.byName);
  };

  /* Remove every source of a given type ("teacher" or "project") and clean
     up everything in scheduling state that could reference their id :
     per-teacher settings, team-matrix cells (as a teacher column or, for a
     removed project, the whole project row), locked picks pointing at a
     removed teacher or at a session that no longer exists once its project
     is gone, and stray "sans encadrant" flags on those same sessions. The
     cached lastResult is dropped so the next render/run recomputes cleanly
     from this now-consistent state. Returns how many sources were removed. */
  PE.removeAllOfType = function (type) {
    const targets = PE.sourcesOfType(type);
    if (!targets.length) return 0;
    const ids = new Set(targets.map((s) => s.id));
    PE.state.sources = PE.state.sources.filter((s) => !ids.has(s.id));

    const sch = PE.state.scheduling;
    ids.forEach((id) => { delete sch.teachers[id]; delete sch.teams[id]; });
    Object.keys(sch.teams).forEach((pid) => {
      const team = sch.teams[pid];
      ids.forEach((id) => { delete team[id]; });
    });

    const validSessionIds = new Set(PE.sessions().map((s) => s.id));
    Object.keys(sch.locked).forEach((sid) => {
      if (!validSessionIds.has(sid)) { delete sch.locked[sid]; return; }
      sch.locked[sid] = (sch.locked[sid] || []).filter((tid) => !ids.has(tid));
      if (!sch.locked[sid].length) delete sch.locked[sid];
    });
    Object.keys(sch.noSup || {}).forEach((sid) => { if (!validSessionIds.has(sid)) delete sch.noSup[sid]; });
    sch.lastResult = null;
    return ids.size;
  };

  /* Each source (encadrant or projet) can now carry several iCal feeds
     (ex. agenda personnel + agenda etablissement) : `src.feeds` = [{ id,
     url, pasted, events, error, lastSync }]. `normalizeSource` migrates the
     old single url/pasted/events shape into a one-feed array (called from
     `migrate`, so it runs once on load for every persisted source), and
     `recomputeSourceEvents` keeps `src.events`/`error`/`lastSync` in sync as
     the merge of every feed — every other view still just reads
     `src.events`, unaware feeds even exist. */
  PE.normalizeSource = function (src) {
    if (!Array.isArray(src.feeds) || !src.feeds.length) {
      src.feeds = [{
        id: PE.util.uid(),
        url: src.url || '',
        pasted: src.pasted || '',
        events: Array.isArray(src.events) ? src.events : [],
        error: src.error || null,
        lastSync: src.lastSync || null
      }];
    }
    src.feeds.forEach((f) => {
      if (!f.id) f.id = PE.util.uid();
      if (!Array.isArray(f.events)) f.events = [];
    });
    delete src.url;
    delete src.pasted;
    PE.recomputeSourceEvents(src);
    return src;
  };

  PE.recomputeSourceEvents = function (src) {
    const all = [];
    (src.feeds || []).forEach((f) => { (f.events || []).forEach((e) => all.push(e)); });
    src.events = all;
    const errs = (src.feeds || []).filter((f) => f.error).map((f) => f.error);
    src.error = errs.length ? errs.join(' · ') : null;
    let last = null;
    (src.feeds || []).forEach((f) => { if (f.lastSync && (!last || f.lastSync > last)) last = f.lastSync; });
    src.lastSync = last;
    return src;
  };

  PE.enabledEvents = function () {
    const out = [];
    PE.state.sources.forEach((src, i) => {
      if (src.enabled === false) return;
      (src.events || []).forEach((e) => {
        out.push({
          sourceId: src.id, sourceName: src.name, type: src.type,
          color: src.color || PE.util.color(i),
          summary: e.summary, location: e.location, allDay: e.allDay,
          start: e.start, end: e.end
        });
      });
    });
    out.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
    return out;
  };

  /* Total (non all-day) session hours currently loaded for a project source. */
  PE.projectHours = function (src) {
    return (src && src.events || []).filter((e) => !e.allDay)
      .reduce((a, e) => a + PE.util.hours(e.start, e.end), 0);
  };

  /* Target unsupervised hours for a project source. Two ways to express it :
       - supMode 'percent' : supPercent % of the hours are supervised
         -> unsupervised = H x (1 - supPercent/100)
       - supMode 'hours' (default) : heures totales - heures encadrees, else
         the legacy `unsupHours` field.
     Only meaningful for a partially-supervised project. A "sans encadrant"
     weight in the team matrix still overrides this (handled in the scheduler). */
  PE.projectUnsupTarget = function (src) {
    if (!src || src.supervision !== 'partial') return 0;
    if (src.supMode === 'percent') {
      const H = PE.projectHours(src);
      const pct = Math.max(0, Math.min(100, src.supPercent == null ? 100 : +src.supPercent));
      return Math.round(H * (1 - pct / 100) * 100) / 100;
    }
    if (src.totalHours != null && src.supervisedHours != null) {
      return Math.max(0, Math.round((+src.totalHours - +src.supervisedHours) * 100) / 100);
    }
    return +src.unsupHours || 0;
  };

  /* Project sessions = every event coming from a project calendar, except
     all-day items and blocks longer than `sessionMaxH` h (Pronote emits school
     holidays / multi-day markers as ordinary timed events — those are not
     sessions). */
  PE.sessions = function () {
    const list = [];
    const maxH = (+PE.state.scheduling.options.sessionMaxH) || 12;
    PE.sourcesOfType('project').forEach((src) => {
      if (src.enabled === false) return;
      const supervision = src.supervision === 'partial' ? 'partial' : 'full';
      const unsupTarget = PE.projectUnsupTarget(src);
      (src.events || []).forEach((e) => {
        if (e.allDay) return;
        const hrs = Math.round(PE.util.hours(e.start, e.end) * 100) / 100;
        if (hrs <= 0 || hrs > maxH + 1e-9) return;
        const id = src.id + '::' + e.start + '::' + (e.uid || e.summary || '');
        list.push({
          id, projectId: src.id, project: src.name,
          label: e.summary || '(seance)', location: e.location || '',
          start: e.start, end: e.end,
          hours: hrs,
          supervision: supervision,
          unsupTarget: unsupTarget
        });
      });
    });
    list.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
    return list;
  };

  PE.teacherEntry = function (sourceId) {
    const t = PE.state.scheduling.teachers;
    if (!t[sourceId]) t[sourceId] = { preferred: [], maxHours: null };
    if (!Array.isArray(t[sourceId].preferred)) t[sourceId].preferred = [];
    return t[sourceId];
  };

  /* Scheduling helpers shared by the Affectation and Assistant views. */
  PE.teacherModels = function () {
    return PE.sourcesOfType('teacher')
      .filter((s) => s.enabled !== false)
      .map((s) => {
        const e = PE.teacherEntry(s.id);
        return { id: s.id, name: s.name, color: s.color, events: s.events || [], preferred: e.preferred, maxHours: e.maxHours };
      });
  };

  PE.schedOptions = function (extra) {
    const sch = PE.state.scheduling;
    return Object.assign({}, sch.options, { teams: sch.teams, noSup: sch.noSup || {} }, extra || {});
  };

  /* Live assignment map (created from the locked picks if no run yet). */
  PE.assignments = function () {
    const sch = PE.state.scheduling;
    if (!sch.lastResult || !sch.lastResult.assignments) {
      const a = {};
      Object.keys(sch.locked || {}).forEach((k) => { a[k] = (sch.locked[k] || []).slice(); });
      sch.lastResult = Object.assign({}, sch.lastResult, { assignments: a });
    }
    return sch.lastResult.assignments;
  };

  /* Team = { teacherId: { on: bool, w: number } } for a project.
     No teacher checked ("on") on a project => every teacher eligible, weight 1. */
  PE.projectTeam = function (projectId) {
    const teams = PE.state.scheduling.teams;
    if (!teams[projectId] || typeof teams[projectId] !== 'object' || Array.isArray(teams[projectId])) {
      teams[projectId] = {};
    }
    return teams[projectId];
  };

  PE.teamCell = function (projectId, teacherId) {
    const team = PE.projectTeam(projectId);
    if (!team[teacherId] || typeof team[teacherId] !== 'object') team[teacherId] = { on: false, w: 1 };
    if (team[teacherId].w == null || isNaN(+team[teacherId].w)) team[teacherId].w = 1;
    return team[teacherId];
  };

  PE.NOSUP_KEY = '__nosup__';

  PE.teamDefined = function (projectId) {
    const t = PE.state.scheduling.teams[projectId];
    return !!t && Object.keys(t).some((k) => k !== PE.NOSUP_KEY && t[k] && t[k].on === true);
  };

  PE.isEligible = function (projectId, teacherId) {
    if (!PE.teamDefined(projectId)) return true;
    const c = PE.state.scheduling.teams[projectId][teacherId];
    return !!(c && c.on === true);
  };

  PE.projectWeight = function (projectId, teacherId) {
    if (!PE.teamDefined(projectId)) return 1;
    const c = PE.state.scheduling.teams[projectId][teacherId];
    return (c && c.on) ? ((c.w == null || isNaN(+c.w)) ? 1 : +c.w) : 0;
  };

  /* ---------------- toast ---------------- */
  let toastTimer = null;
  PE.toast = function (msg, kind) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = kind ? kind : '';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'hidden'; }, 3200);
  };

  /* ---------------- rendering ---------------- */
  PE.rerender = function () {
    const c = document.getElementById('view');
    c.innerHTML = '';
    document.querySelectorAll('.tab').forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === PE.state.ui.tab);
    });
    const view = PE.views[PE.state.ui.tab] || PE.views.sources;
    view.render(c);
  };

  PE.setTab = function (tab) {
    PE.state.ui.tab = tab;
    PE.save();
    PE.rerender();
  };

  /* ---------------- iCal loading ---------------- */
  async function loadFeed(f, range) {
    const res = await window.api.loadIcal({
      url: f.url, text: f.pasted || '',
      rangeStart: range.from, rangeEnd: range.to + 'T23:59:59'
    });
    if (res.ok) { f.events = res.events; f.error = null; f.lastSync = new Date().toISOString(); }
    else { f.error = res.error; }
  }

  PE.refreshSource = async function (id) {
    const src = PE.state.sources.find((s) => s.id === id);
    if (!src) return;
    PE.normalizeSource(src);
    const feeds = src.feeds.filter((f) => f.url || f.pasted);
    if (!feeds.length) { PE.recomputeSourceEvents(src); PE.save(); PE.rerender(); return; }
    src.loading = true;
    PE.rerender();
    await Promise.all(feeds.map((f) => loadFeed(f, PE.state.range)));
    src.loading = false;
    PE.recomputeSourceEvents(src);
    PE.save();
    PE.rerender();
  };

  PE.refreshAll = async function () {
    PE.state.sources.forEach((s) => PE.normalizeSource(s));
    const targets = PE.state.sources.filter((s) => s.enabled !== false && s.feeds.some((f) => f.url || f.pasted));
    if (!targets.length) { PE.toast('Aucun agenda a charger'); return; }
    PE.toast('Chargement de ' + targets.length + ' agenda(s)…');
    for (const s of targets) {
      s.loading = true;
    }
    PE.rerender();
    await Promise.all(targets.map(async (src) => {
      const feeds = src.feeds.filter((f) => f.url || f.pasted);
      await Promise.all(feeds.map((f) => loadFeed(f, PE.state.range)));
      src.loading = false;
      PE.recomputeSourceEvents(src);
    }));
    PE.save();
    PE.rerender();
    const bad = targets.filter((s) => s.error).length;
    PE.toast(bad ? (bad + ' agenda(s) en erreur') : 'Agendas a jour', bad ? 'err' : 'ok');
  };

  /* ---------------- top bar ---------------- */
  PE.wireTopBar = function () {
    document.querySelectorAll('.tab').forEach((b) => {
      b.addEventListener('click', () => PE.setTab(b.dataset.tab));
    });
    const rf = document.getElementById('range-from');
    const rt = document.getElementById('range-to');
    rf.value = PE.state.range.from;
    rt.value = PE.state.range.to;
    rf.addEventListener('change', () => { PE.state.range.from = rf.value; PE.save(); });
    rt.addEventListener('change', () => { PE.state.range.to = rt.value; PE.save(); });

    document.getElementById('btn-refresh').addEventListener('click', PE.refreshAll);

    document.getElementById('btn-export-proj').addEventListener('click', async () => {
      const r = await window.api.exportProject(PE.serialize());
      if (r.ok) PE.toast('Projet exporte', 'ok');
    });
    document.getElementById('btn-import-proj').addEventListener('click', async () => {
      const r = await window.api.importProject();
      if (r.ok && r.data) {
        PE.state = PE.migrate(r.data);
        document.getElementById('range-from').value = PE.state.range.from;
        document.getElementById('range-to').value = PE.state.range.to;
        PE.save();
        PE.rerender();
        PE.toast('Projet importe', 'ok');
      }
    });
  };

  PE.boot = async function () {
    const r = await window.api.loadProject();
    if (r.ok && r.data) PE.state = PE.migrate(r.data);
    PE.wireTopBar();
    PE.rerender();
  };
})();
