/* Teacher <-> project-session assignment.
   - a teacher is a candidate as soon as they are free for PART of the session ;
     the auto-assign strongly prefers teachers free for the WHOLE session and
     only falls back to partial availability when no full one is left.
   - per project, each teacher can carry a relative weight (team matrix) ; the
     score also rewards a matching preferred month.
   Pure module, depends only on PE.fb. */
(function () {
  'use strict';
  window.PE = window.PE || {};
  const FB = window.PE.fb;

  function ms(x) { return +new Date(x); }

  function monthKey(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  function inPreferred(preferred, whenMs) {
    if (!preferred || !preferred.length) return false;
    const mk = monthKey(new Date(whenMs));
    return preferred.some((p) => p && p.from && p.to && p.from <= mk && mk <= p.to);
  }

  /* Weekly half-day slots, Mon..Fri x {AM, PM} -> index 0..9
     (0 = lun. matin, 1 = lun. apres-midi, ... 8 = ven. matin, 9 = ven. apres-midi).
     AM/PM split at 12:00 local. A session usually touches one slot, two if it
     straddles noon, more if it spans several days. */
  function sessionSlots(s) {
    const a = ms(s.start);
    const b = ms(s.end);
    const out = {};
    let cur = new Date(a);
    cur.setHours(0, 0, 0, 0);
    let guard = 0;
    while (cur.getTime() < b && guard++ < 60) {
      const dow = cur.getDay(); // 0 Sun .. 6 Sat
      if (dow >= 1 && dow <= 5) {
        const d0 = cur.getTime();
        const noon = d0 + 12 * 3600000;
        const d1 = d0 + 24 * 3600000;
        if (Math.min(b, noon) > Math.max(a, d0)) out[(dow - 1) * 2] = 1;
        if (Math.min(b, d1) > Math.max(a, noon)) out[(dow - 1) * 2 + 1] = 1;
      }
      cur = new Date(cur.getTime() + 24 * 3600000);
      cur.setHours(0, 0, 0, 0);
    }
    return Object.keys(out).map(Number);
  }

  /* Recurring half-day unavailability for a teacher, as a degree for a given
     session : 0 = none, 1 = soft (place a session there only as a last
     resort), 2 = hard (never place a session there). `indispo` is a list of
     { slot, degree } single weekly half-days (0..9, see sessionSlots) ; a
     legacy { from, to, degree } range is still accepted. */
  function indispoDegree(indispo, s) {
    if (!indispo || !indispo.length) return 0;
    const slots = sessionSlots(s);
    if (!slots.length) return 0;
    let deg = 0;
    for (const e of indispo) {
      const d = +(e && e.degree);
      if (d !== 1 && d !== 2 || d <= deg) continue;
      if (e && e.slot != null && !isNaN(+e.slot)) {
        const sl0 = Math.round(+e.slot);
        for (const sl of slots) if (sl === sl0) { deg = d; break; }
      } else if (e && e.from != null && e.to != null) {
        const lo = Math.min(+e.from, +e.to);
        const hi = Math.max(+e.from, +e.to);
        for (const sl of slots) if (sl >= lo && sl <= hi) { deg = d; break; }
      }
    }
    return deg;
  }

  /* Busy intervals for a teacher, from their calendar events. */
  function teacherBusy(events, allDayBusy) {
    const out = [];
    for (const e of events || []) {
      let s = ms(e.start);
      let en = ms(e.end);
      if (e.allDay) {
        if (!allDayBusy) continue;
        const d1 = new Date(s); d1.setHours(0, 0, 0, 0); s = d1.getTime();
        const d2 = new Date(en);
        if (d2.getHours() || d2.getMinutes() || d2.getSeconds()) { d2.setHours(24, 0, 0, 0); }
        en = d2.getTime();
      }
      if (en > s) out.push({ start: s, end: en });
    }
    return FB.normalize(out);
  }

  /* How much of [sMs.start, sMs.end] is free, given calendar `busy` plus the
     teacher's other assigned-session intervals `otherIv`. */
  function coverage(busy, otherIv, sMs) {
    const total = sMs.end - sMs.start;
    if (total <= 0) return { frac: 0, freeMs: 0, free: [] };
    const blocking = FB.normalize((busy || []).concat(otherIv || []));
    const free = FB.invert(blocking, sMs.start, sMs.end);
    const freeMs = free.reduce((a, i) => a + (i.end - i.start), 0);
    return { frac: freeMs / total, freeMs: freeMs, free: free };
  }

  function teamOf(teams, s) {
    return teams && s && s.projectId != null ? teams[s.projectId] : null;
  }
  /* a team cell is { on, w } ; older projects may hold a bare weight number */
  function cellOn(c) {
    if (typeof c === 'number') return c > 0;
    return !!(c && typeof c === 'object' && c.on === true);
  }
  function cellW(c) {
    if (typeof c === 'number') return c;
    if (c && typeof c === 'object' && c.w != null && !isNaN(+c.w)) return +c.w;
    return 1;
  }
  function teamDefined(team) {
    if (!team || Array.isArray(team)) return false;
    return Object.keys(team).some((k) => k !== '__nosup__' && cellOn(team[k]));
  }
  function eligibleFor(teams, s, tid) {
    const team = teamOf(teams, s);
    if (!teamDefined(team)) return true;
    return cellOn(team[tid]);
  }
  function weightFor(teams, s, tid) {
    const team = teamOf(teams, s);
    if (!teamDefined(team)) return 1;
    return cellOn(team[tid]) ? cellW(team[tid]) : 0;
  }

  const FULL = 1 - 1e-9;

  function buildTeachers(teachers, allDayBusy) {
    return teachers.map((t) => ({
      id: t.id,
      name: t.name,
      busy: teacherBusy(t.events, allDayBusy),
      preferred: t.preferred || [],
      indispo: t.indispo || [],
      maxHours: (t.maxHours == null || t.maxHours === '') ? null : Number(t.maxHours),
      load: 0,
      ivs: [],            // { start, end, sid }
      _rnd: Math.random() * 1e-4
    }));
  }

  function otherIvs(t, sid) { return t.ivs.filter((iv) => iv.sid !== sid); }

  var NOSUP_KEY = '__nosup__';

  /* Target supervision hours per teacher (and per project x teacher), derived
     from the team weights. Within a project the weight pool is
     { each eligible encadrant : w }  +  { "sans encadrant" : w0 }.
       - unsupervised hours of the project = H x w0 / Sum(w)
       - encadrant e target              = H x targetPerSession x w_e / Sum(w)
     H = total session hours of the project. So the same weight scale compares
     encadrants within a project, "sans encadrant" against them, and (because a
     teacher on several projects sums a target from each) projects between
     themselves. When no "sans encadrant" weight is set, the unsupervised target
     falls back to the project's own hours (heures totales - heures encadrees). */
  function computeTargets(sessions, allIds, o) {
    const byTeacher = {};
    const byPair = {};
    const unsupByProject = {};
    allIds.forEach((id) => { byTeacher[id] = 0; });

    const tps = o.targetPerSession || 1;
    const toMoveSet = o.toMove || {};
    const proj = {};
    sessions.forEach((s) => {
      if (s.projectId == null || toMoveSet[s.id]) return;
      (proj[s.projectId] = proj[s.projectId] || []).push(s);
    });

    Object.keys(proj).forEach((pid) => {
      const ps = proj[pid];
      const H = ps.reduce((a, s) => a + (s.hours || 0), 0);
      const team = o.teams && o.teams[pid];
      const hasTeam = team && Object.keys(team).some((k) => k !== NOSUP_KEY && cellOn(team[k]));

      let entries = hasTeam
        ? Object.keys(team).filter((k) => k !== NOSUP_KEY && cellOn(team[k]) && byTeacher[k] != null)
          .map((k) => [k, Math.max(0, cellW(team[k]))])
        : allIds.map((id) => [id, 1]);
      let wi = entries.reduce((a, e) => a + e[1], 0);
      if (wi <= 0 && entries.length) { entries = entries.map((e) => [e[0], 1]); wi = entries.length; }

      const w0 = (team && cellOn(team[NOSUP_KEY])) ? Math.max(0, cellW(team[NOSUP_KEY])) : null;

      if (w0 != null) {
        const total = wi + w0;
        unsupByProject[pid] = total > 0 ? H * (w0 / total) : 0;
        if (total > 0) entries.forEach((e) => {
          const h = H * tps * (e[1] / total);
          byTeacher[e[0]] += h;
          byPair[pid + '::' + e[0]] = h;
        });
      } else {
        const unsupH = Math.max(0, Math.min(H, +ps[0].unsupTarget || 0));
        unsupByProject[pid] = unsupH;
        const supH = H - unsupH;
        if (wi > 0) entries.forEach((e) => {
          const h = supH * tps * (e[1] / wi);
          byTeacher[e[0]] += h;
          byPair[pid + '::' + e[0]] = h;
        });
      }
    });

    const r1 = (x) => Math.round(x * 100) / 100;
    Object.keys(byTeacher).forEach((k) => { byTeacher[k] = r1(byTeacher[k]); });
    Object.keys(byPair).forEach((k) => { byPair[k] = r1(byPair[k]); });
    Object.keys(unsupByProject).forEach((k) => { unsupByProject[k] = r1(unsupByProject[k]); });
    return { byTeacher: byTeacher, byPair: byPair, unsupByProject: unsupByProject };
  }

  function summarise(sessions, T, byId, o) {
    const noSupSet = o.noSup || {};
    const toMoveSet = o.toMove || {};
    const validatedSet = o.validated || {};
    const altSupMap = o.altSup || {};
    const hasAlt = (s) => !!(altSupMap[s.id] && String(altSupMap[s.id]).trim());
    const availList = {};
    const availFull = {};
    const partial = {};
    const indispo = {};
    const outOfTeam = {};
    const unfilled = [];
    const noSup = [];
    const toMove = [];      // sessions "a deplacer" : mises de cote
    const validated = [];   // sessions "encadrement valide"
    const unsupHours = {};   // projectId -> heures de seances sans encadrant
    const unsupTarget = {};  // projectId -> cible d'heures non encadrees
    const supervisionOf = {}; // projectId -> 'full' | 'partial'

    const targets = o._targets || computeTargets(sessions, T.map((t) => t.id), o);

    sessions.forEach((s) => {
      const sMs = { start: ms(s.start), end: ms(s.end) };
      const arr = (o.assignments[s.id] || []);
      const sup = s.supervision === 'partial' ? 'partial' : 'full';
      if (s.projectId != null) {
        supervisionOf[s.projectId] = sup;
        if (unsupTarget[s.projectId] == null) {
          unsupTarget[s.projectId] = targets.unsupByProject[s.projectId] != null
            ? targets.unsupByProject[s.projectId] : (+s.unsupTarget || 0);
        }
      }

      // "a deplacer" : la seance est mise de cote (pas d'affectation auto, pas
      // comptee comme un manque). On ne calcule rien d'autre pour elle.
      if (toMoveSet[s.id]) {
        toMove.push(s.id);
        availList[s.id] = []; availFull[s.id] = 0;
        partial[s.id] = []; indispo[s.id] = []; outOfTeam[s.id] = [];
        return;
      }

      const list = [];
      T.forEach((t) => {
        if (!eligibleFor(o.teams, s, t.id)) return;
        const idg = indispoDegree(t.indispo, s);
        if (idg === 2) return;
        const c = coverage(t.busy, otherIvs(t, s.id), sMs);
        if (c.freeMs > 1000) {
          list.push({ tid: t.id, name: t.name, hours: Math.round(c.freeMs / 3600) / 1000, full: c.frac >= FULL, soft: idg === 1 });
        }
      });
      list.sort((a, b) => (a.soft - b.soft) || (b.hours - a.hours));
      availList[s.id] = list;
      availFull[s.id] = list.filter((x) => x.full && !x.soft).length;
      partial[s.id] = [];
      indispo[s.id] = [];
      outOfTeam[s.id] = [];

      // a session is "sans encadrant" when explicitly declared, or when it
      // belongs to a partially-supervised project and has no encadrant (ni
      // un "autre encadrant" saisi a la main).
      const isNoSup = !!noSupSet[s.id] || (sup === 'partial' && arr.length === 0 && !hasAlt(s));
      if (isNoSup) {
        noSup.push(s.id);
        if (s.projectId != null) unsupHours[s.projectId] = (unsupHours[s.projectId] || 0) + (s.hours || 0);
        return;
      }

      if (validatedSet[s.id]) validated.push(s.id);

      arr.forEach((tid) => {
        const t = byId[tid];
        if (!t) return;
        if (!eligibleFor(o.teams, s, tid)) outOfTeam[s.id].push(tid);
        if (indispoDegree(t.indispo, s) === 2) { indispo[s.id].push(tid); return; }
        const c = coverage(t.busy, otherIvs(t, s.id), sMs);
        if (c.frac <= 1e-9) indispo[s.id].push(tid);
        else if (c.frac < FULL) partial[s.id].push(tid);
      });
      // un "autre encadrant" compte pour une place ; un encadrement valide
      // n'est jamais signale comme "manque".
      if (!validatedSet[s.id] && arr.length + (hasAlt(s) ? 1 : 0) < o.minPerSession) unfilled.push(s.id);
    });

    Object.keys(unsupTarget).forEach((pid) => { if (unsupHours[pid] == null) unsupHours[pid] = 0; });

    const load = {};
    T.forEach((t) => { load[t.id] = Math.round(t.load * 100) / 100; });
    return {
      assignments: o.assignments, load, availList, availFull, partial, indispo, outOfTeam,
      unfilled, noSup, toMove, validated, unsupHours, unsupTarget, supervisionOf,
      target: targets.byTeacher, targetPair: targets.byPair
    };
  }

  function run(sessions, teachers, options) {
    const o = Object.assign({
      targetPerSession: 1,
      minPerSession: 1,
      sessionHours: 4,
      prefWeight: 1,
      respectMaxHours: false,
      allDayBusy: true,
      locked: {},
      teams: {},
      noSup: {},
      toMove: {},
      validated: {},
      altSup: {}
    }, options || {});
    const altCount = (sid) => ((o.altSup[sid] && String(o.altSup[sid]).trim()) ? 1 : 0);

    const T = buildTeachers(teachers, o.allDayBusy);
    const byId = {};
    T.forEach((t) => { byId[t.id] = t; });

    const sorted = sessions.slice().sort((a, b) => ms(a.start) - ms(b.start));
    const targ = computeTargets(sorted, T.map((t) => t.id), o);
    const targetH = targ.byTeacher;
    const SCALE = o.sessionHours || 4;
    const assignments = {};

    /* 1. locked (manual) picks first -- kept as-is. "a deplacer" sessions are
          left entirely untouched (no auto pass ever looks at them). */
    for (const s of sorted) {
      assignments[s.id] = [];
      if (o.toMove[s.id]) continue;
      const sMs = { start: ms(s.start), end: ms(s.end) };
      const dur = (sMs.end - sMs.start) / 3600000;
      for (const tid of (o.locked[s.id] || [])) {
        const t = byId[tid];
        if (!t || assignments[s.id].indexOf(tid) !== -1) continue;
        assignments[s.id].push(tid);
        t.load += dur;
        t.ivs.push({ start: sMs.start, end: sMs.end, sid: s.id });
      }
    }

    /* 1b. plan "sans encadrant" sessions : explicit declarations + , for a
           partially-supervised project, enough sessions to reach its target of
           unsupervised hours (hardest-to-staff and latest sessions first). */
    const planNoSup = {};
    for (const s of sorted) if (o.noSup[s.id]) planNoSup[s.id] = true;

    const byProject = {};
    sorted.forEach((s) => {
      if (s.projectId == null) return;
      (byProject[s.projectId] = byProject[s.projectId] || []).push(s);
    });
    Object.keys(byProject).forEach((pid) => {
      const ps = byProject[pid];
      const sample = ps[0];
      // unsupervised hours target : the "sans encadrant" weight in the team
      // matrix (if any) wins, else the project's own hours setting.
      const target = targ.unsupByProject[pid] || 0;
      if (target <= 0) return;
      let acc = 0;
      ps.forEach((s) => { if (planNoSup[s.id]) acc += (s.hours || 0); });
      const cands = ps.filter((s) => !planNoSup[s.id] && !o.toMove[s.id] && !o.validated[s.id] && !(o.locked[s.id] && o.locked[s.id].length));
      cands.forEach((s) => {
        const sMs = { start: ms(s.start), end: ms(s.end) };
        s._fullCount = T.reduce((n, t) => {
          if (!eligibleFor(o.teams, s, t.id)) return n;
          if (indispoDegree(t.indispo, s) !== 0) return n;
          return coverage(t.busy, otherIvs(t, s.id), sMs).frac >= FULL ? n + 1 : n;
        }, 0);
      });
      cands.sort((a, b) => (a._fullCount - b._fullCount) || (ms(b.start) - ms(a.start)));
      for (const s of cands) {
        if (acc + (s.hours || 0) <= target + 1e-6) { planNoSup[s.id] = true; acc += (s.hours || 0); }
        else break;
      }
    });

    /* 2. greedy fill : full-availability teachers first, then partial.
          Sessions "sans encadrant", "a deplacer" ou "encadrement valide" sont
          sautees ; un "autre encadrant" saisi compte pour une place. */
    for (const s of sorted) {
      if (planNoSup[s.id] || o.toMove[s.id] || o.validated[s.id]) continue;
      const sMs = { start: ms(s.start), end: ms(s.end) };
      const dur = (sMs.end - sMs.start) / 3600000;

      let guard = 0;
      while (assignments[s.id].length + altCount(s.id) < o.targetPerSession && guard++ < 100) {
        const cands = [];
        for (const t of T) {
          if (assignments[s.id].indexOf(t.id) !== -1) continue;
          if (!eligibleFor(o.teams, s, t.id)) continue;
          const idg = indispoDegree(t.indispo, s);
          if (idg === 2) continue;
          if (o.respectMaxHours && t.maxHours != null && t.load + dur > t.maxHours + 1e-9) continue;
          const c = coverage(t.busy, otherIvs(t, s.id), sMs);
          if (c.frac <= 1e-9) continue;
          cands.push({ t: t, frac: c.frac, soft: idg === 1 });
        }
        if (!cands.length) break;

        // full-availability, non-"a eviter" teachers first ; a soft-indispo
        // teacher only enters the pool when nothing else is left, and even
        // then carries a heavy score penalty so they are the last picked.
        const fulls = cands.filter((x) => x.frac >= FULL && !x.soft);
        const pool = fulls.length ? fulls : cands;
        const SOFT_PENALTY = 1e7;

        let best = null;
        let bestScore = -Infinity;
        for (const x of pool) {
          const pref = inPreferred(x.t.preferred, sMs.start) ? 1 : 0;
          // deficit = hours still owed toward this teacher's weight-derived
          // target ; a preferred month is worth ~one session.
          const deficit = (targetH[x.t.id] || 0) - x.t.load;
          const score = o.prefWeight * pref * SCALE + deficit + x.frac * 1e-3 + x.t._rnd
            - (x.soft ? SOFT_PENALTY : 0);
          if (score > bestScore) { bestScore = score; best = x.t; }
        }
        if (!best) break;
        assignments[s.id].push(best.id);
        best.load += dur;
        best.ivs.push({ start: sMs.start, end: sMs.end, sid: s.id });
      }
    }

    /* 3. nudge toward the weight-derived targets : move a non-locked session
          from the teacher most above target to one most below, when that
          teacher is fully free for it and the move lowers total deviation. */
    for (let round = 0; round < 800; round++) {
      let over = null;
      let under = null;
      let oDev = 1e-6;
      let uDev = 1e-6;
      for (const t of T) {
        const d = t.load - (targetH[t.id] || 0);
        if (d > oDev) { oDev = d; over = t; }
        if (-d > uDev) { uDev = -d; under = t; }
      }
      if (!over || !under || over === under) break;
      let moved = false;
      for (const s of sorted) {
        if (planNoSup[s.id] || o.toMove[s.id] || o.validated[s.id]) continue;
        const arr = assignments[s.id];
        if (!arr || arr.indexOf(over.id) === -1 || arr.indexOf(under.id) !== -1) continue;
        if ((o.locked[s.id] || []).indexOf(over.id) !== -1) continue;
        if (!eligibleFor(o.teams, s, under.id)) continue;
        if (indispoDegree(under.indispo, s) !== 0) continue;
        const sMs = { start: ms(s.start), end: ms(s.end) };
        const dur = (sMs.end - sMs.start) / 3600000;
        if (coverage(under.busy, under.ivs.filter((iv) => iv.sid !== s.id), sMs).frac < FULL) continue;
        if (o.respectMaxHours && under.maxHours != null && under.load + dur > under.maxHours + 1e-9) continue;
        const oT = targetH[over.id] || 0;
        const uT = targetH[under.id] || 0;
        const before = Math.abs(over.load - oT) + Math.abs(under.load - uT);
        const after = Math.abs(over.load - dur - oT) + Math.abs(under.load + dur - uT);
        if (after < before - 1e-9) {
          arr[arr.indexOf(over.id)] = under.id;
          over.load -= dur;
          over.ivs = over.ivs.filter((iv) => iv.sid !== s.id);
          under.load += dur;
          under.ivs.push({ start: sMs.start, end: sMs.end, sid: s.id });
          moved = true;
          break;
        }
      }
      if (!moved) break;
    }

    return summarise(sorted, T, byId,
      Object.assign({}, o, { assignments: assignments, noSup: planNoSup, _targets: targ }));
  }

  /* Re-derive everything for a GIVEN assignment map, without reassigning. */
  function evaluate(sessions, teachers, options, assignments) {
    const o = Object.assign({ minPerSession: 1, allDayBusy: true, teams: {}, noSup: {} }, options || {});
    const T = buildTeachers(teachers, o.allDayBusy);
    const byId = {};
    T.forEach((t) => { byId[t.id] = t; });

    sessions.forEach((s) => {
      const sMs = { start: ms(s.start), end: ms(s.end) };
      const dur = (sMs.end - sMs.start) / 3600000;
      (assignments[s.id] || []).forEach((tid) => {
        const t = byId[tid];
        if (!t) return;
        t.load += dur;
        t.ivs.push({ start: sMs.start, end: sMs.end, sid: s.id });
      });
    });

    return summarise(sessions.slice().sort((a, b) => ms(a.start) - ms(b.start)),
      T, byId, Object.assign({}, o, { assignments: assignments }));
  }

  window.PE.scheduler = {
    run, evaluate, teacherBusy, coverage, eligibleFor, weightFor, inPreferred, monthKey,
    sessionSlots, indispoDegree
  };
})();
