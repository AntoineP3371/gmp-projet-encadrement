'use strict';
/* Node-only smoke test for the pure logic + iCal parsing.
   Run: node scripts/smoke.js   (exit 0 = all green) */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0;
let fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name); }
}

/* load renderer libs with a window shim */
global.window = {};
for (const f of ['lib/freebusy.js', 'lib/scheduler.js', 'lib/ics-export.js', 'app.js', 'views/assistant.js']) {
  (0, eval)(fs.readFileSync(path.join(ROOT, 'renderer', f), 'utf8'));
}
const P4 = global.window.P4;
const FB = P4.fb;
const S = P4.scheduler;
const rd = (f) => fs.readFileSync(path.join(ROOT, 'samples', f), 'utf8');

/* ---- 1. iCal parsing ---- */
console.log('\n[1] iCal parsing');
const { parseICS } = require(path.join(ROOT, 'lib', 'ical.js'));
const from = '2026-09-01';
const to = '2027-01-31T23:59:59';
const martin = parseICS(rd('enseignant-martin.ics'), from, to);
const durand = parseICS(rd('enseignant-durand.ics'), from, to);
const proj = parseICS(rd('projet-p4.ics'), from, to);
ok('martin -> 6 events', martin.length === 6);
ok('durand -> 6 events', durand.length === 6);
ok('projet -> 8 sessions', proj.length === 8);
ok('TZID Europe/Paris resolved (13:00 local -> 11:00Z, Sept DST)', proj[0].start.endsWith('11:00:00.000Z'));
ok('session duration 4h', (Date.parse(proj[0].end) - Date.parse(proj[0].start)) === 4 * 3600000);
ok('range filter -> October only (Oct 2/9/16)',
  parseICS(rd('projet-p4.ics'), '2026-10-01', '2026-10-31T23:59:59').length === 3);

const rrule = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//t//EN', 'BEGIN:VEVENT', 'UID:r1',
  'DTSTAMP:20260101T000000Z', 'DTSTART;TZID=Europe/Paris:20260907T090000',
  'DTEND;TZID=Europe/Paris:20260907T110000', 'RRULE:FREQ=WEEKLY;COUNT=10',
  'SUMMARY:Cours hebdo', 'END:VEVENT', 'END:VCALENDAR'
].join('\r\n');
const rec = parseICS(rrule, '2026-09-01', '2026-12-31T23:59:59');
ok('RRULE FREQ=WEEKLY;COUNT=10 -> 10 occurrences', rec.length === 10);
ok('RRULE occurrences 7 days apart', (Date.parse(rec[1].start) - Date.parse(rec[0].start)) === 7 * 86400000);

const allday = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//t//EN', 'BEGIN:VEVENT', 'UID:a1',
  'DTSTAMP:20260101T000000Z', 'DTSTART;VALUE=DATE:20261012', 'DTEND;VALUE=DATE:20261013',
  'SUMMARY:Conges', 'END:VEVENT', 'END:VCALENDAR'
].join('\r\n');
ok('all-day event flagged', parseICS(allday, from, to)[0].allDay === true);

// Pronote-style : plain UTC DTSTART, no VTIMEZONE
const utcIcs = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Pronote//EN', 'BEGIN:VEVENT', 'UID:pn1',
  'DTSTAMP:20260101T000000Z', 'DTSTART:20260921T060000Z', 'DTEND:20260921T100000Z',
  'SUMMARY:S3: 4 - P4 - Projet_4h', 'LOCATION:A18', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
const utcEv = parseICS(utcIcs, '2026-09-01', '2026-12-31T23:59:59');
ok('plain UTC DTSTART kept as-is, 4h', utcEv.length === 1 && utcEv[0].start === '2026-09-21T06:00:00.000Z'
  && (Date.parse(utcEv[0].end) - Date.parse(utcEv[0].start)) === 4 * 3600000);

// winter DST : 13:00 Europe/Paris in January = 12:00Z
const janIcs = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//t//EN', 'BEGIN:VEVENT', 'UID:j1',
  'DTSTAMP:20270101T000000Z', 'DTSTART;TZID=Europe/Paris:20270115T130000', 'DTEND;TZID=Europe/Paris:20270115T170000',
  'SUMMARY:x', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
ok('TZID Europe/Paris winter -> 13:00 local = 12:00Z',
  parseICS(janIcs, '2027-01-01', '2027-02-01')[0].start.endsWith('12:00:00.000Z'));

/* ---- 2. interval math ---- */
console.log('\n[2] freebusy interval math');
const H = (d, h) => new Date(2026, 8, d, h, 0, 0).getTime();
ok('normalize merges overlaps',
  JSON.stringify(FB.normalize([{ start: H(1, 8), end: H(1, 10) }, { start: H(1, 9), end: H(1, 12) }])) ===
  JSON.stringify([{ start: H(1, 8), end: H(1, 12) }]));
ok('intersectTwo',
  JSON.stringify(FB.intersectTwo([{ start: H(1, 8), end: H(1, 12) }], [{ start: H(1, 10), end: H(1, 14) }])) ===
  JSON.stringify([{ start: H(1, 10), end: H(1, 12) }]));
ok('invert within window',
  JSON.stringify(FB.invert([{ start: H(1, 10), end: H(1, 12) }], H(1, 8), H(1, 18))) ===
  JSON.stringify([{ start: H(1, 8), end: H(1, 10) }, { start: H(1, 12), end: H(1, 18) }]));
const grid = FB.workingWindow(H(1, 0), H(6, 0), 8, 20, [1, 2, 3, 4, 5]);
ok('workingWindow skips weekend (Tue..Fri = 4)', grid.length === 4);
ok('workingWindow slot is 12h', (grid[0].end - grid[0].start) === 12 * 3600000);

/* ---- 3. scheduler ---- */
console.log('\n[3] scheduler');
const teachers = [
  { id: 'M', name: 'Martin', events: martin, preferred: [], maxHours: null },
  { id: 'D', name: 'Durand', events: durand, preferred: [], maxHours: null }
];
const sessions = proj.map((e) => ({
  id: 'p::' + e.start, projectId: 'PRJ', project: 'P4', label: e.summary, location: e.location,
  start: e.start, end: e.end, hours: 4
}));
const res = S.run(sessions, teachers, { targetPerSession: 1, minPerSession: 1, prefWeight: 1 });
ok('session 1 (18 Sep) -> Martin, Durand busy (TD 13-17)', res.assignments[sessions[0].id].join() === 'M');
ok('session 3 (2 Oct) -> Martin, Durand busy (TP 13-17)', res.assignments[sessions[2].id].join() === 'M');
ok('session 4 (9 Oct) -> Durand, Martin busy (Jury 13-17)', res.assignments[sessions[3].id].join() === 'D');
ok('all 8 sessions covered, 0 unfilled',
  Object.values(res.assignments).every((a) => a.length >= 1) && res.unfilled.length === 0);
ok('auto-assign never picks an indisponible teacher',
  sessions.every((s) => !(res.indispo[s.id] || []).length && !(res.partial[s.id] || []).length));
ok('no teacher double-booked', (function () {
  for (const t of ['M', 'D']) {
    const ivs = sessions.filter((s) => (res.assignments[s.id] || []).includes(t))
      .map((s) => [Date.parse(s.start), Date.parse(s.end)]).sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < ivs.length; i++) if (ivs[i][0] < ivs[i - 1][1]) return false;
  }
  return true;
})());

const t2 = [
  { id: 'M', name: 'Martin', events: [], preferred: [{ from: '2026-09', to: '2026-09' }], maxHours: null },
  { id: 'D', name: 'Durand', events: [], preferred: [{ from: '2026-11', to: '2026-12' }], maxHours: null }
];
const r2 = S.run(sessions, t2, { targetPerSession: 1, minPerSession: 1, prefWeight: 5 });
ok('Sept session -> preferred teacher (Martin)', r2.assignments[sessions[0].id].join() === 'M');
ok('Nov session -> preferred teacher (Durand)', r2.assignments[sessions[5].id].join() === 'D');

ok('target 2 with a busy teacher -> some sessions left unfilled',
  S.run(sessions, teachers, { targetPerSession: 2, minPerSession: 2 }).unfilled.length > 0);

/* per-project team : { teacherId: { on, w } }. Only checked encadrants count. */
const TEAM_D = { PRJ: { D: { on: true, w: 1 } } };
const rElig = S.run(sessions, teachers, { targetPerSession: 1, minPerSession: 1, teams: TEAM_D });
ok('team {Durand on} -> only Durand ever assigned',
  Object.values(rElig.assignments).every((a) => a.every((x) => x === 'D')));
ok('team {Durand on} -> sessions where Durand is busy stay unfilled', rElig.unfilled.length > 0);
const rElig2 = S.run(sessions, teachers, { targetPerSession: 1, minPerSession: 1,
  teams: { PRJ: { M: { on: true, w: 1 }, D: { on: true, w: 1 } } } });
ok('team both on -> full coverage again', rElig2.unfilled.length === 0);
ok('unchecked encadrant is excluded even with a weight',
  S.run(sessions, teachers, { targetPerSession: 1, minPerSession: 1,
    teams: { PRJ: { M: { on: true, w: 1 }, D: { on: false, w: 9 } } } })
    .unfilled.length > 0);
ok('a team with every cell off = everyone eligible (row-vide rule)',
  S.run(sessions, teachers, { targetPerSession: 1, minPerSession: 1,
    teams: { PRJ: { M: { on: false, w: 1 }, D: { on: false, w: 1 } } } }).unfilled.length === 0);
const evElig = S.evaluate(sessions, teachers, { minPerSession: 1, teams: { PRJ: { M: { on: true, w: 1 } } } },
  { [sessions[0].id]: ['D'] });
ok('evaluate flags out-of-team encadrant', (evElig.outOfTeam[sessions[0].id] || []).includes('D'));

/* per-project weight steers the choice: both free in Sept, D weighted higher */
const septFree = [{ id: 'sf', projectId: 'PRJ', project: 'P4', label: 'x',
  start: '2026-09-11T08:00:00.000Z', end: '2026-09-11T12:00:00.000Z', hours: 4 }];
ok('higher project weight wins',
  S.run(septFree, t2, { prefWeight: 0, teams: { PRJ: { M: { on: true, w: 1 }, D: { on: true, w: 5 } } } }).assignments.sf.join() === 'D');
ok('preferred month still wins with equal weights',
  S.run(septFree, t2, { prefWeight: 3, teams: { PRJ: { M: { on: true, w: 1 }, D: { on: true, w: 1 } } } }).assignments.sf.join() === 'M');

/* partial availability: teacher busy for half the session is used only as fallback + flagged */
const halfBusy = [{ id: 'H', name: 'Half', maxHours: null, preferred: [],
  events: [{ start: '2026-09-11T08:00:00.000Z', end: '2026-09-11T10:00:00.000Z', allDay: false }] }];
const rHalf = S.run(septFree, halfBusy, { targetPerSession: 1, minPerSession: 1 });
ok('only-partial teacher still assigned (fallback)', rHalf.assignments.sf.join() === 'H');
ok('partial assignment flagged', (rHalf.partial.sf || []).includes('H'));
ok('availList reports 2 h free for the half-busy teacher',
  Math.abs((rHalf.availList.sf[0].hours) - 2) < 1e-6 && rHalf.availList.sf[0].full === false);
const rFullPref = S.run(septFree, [halfBusy[0], t2[0]], { targetPerSession: 1, minPerSession: 1, prefWeight: 0 });
ok('full-availability teacher preferred over partial one', rFullPref.assignments.sf.join() === 'M');

/* both fully free -> availFull == 2 (drives the "choix possible" highlight) */
const evFree = S.evaluate(septFree, t2, { minPerSession: 1 }, { sf: [] });
ok('availFull == 2 when both teachers free all session', evFree.availFull.sf === 2);

const manual = {}; sessions.forEach((s, i) => { manual[s.id] = [i % 2 ? 'D' : 'M']; });
const ev = S.evaluate(sessions, teachers, { minPerSession: 1 }, manual);
ok('evaluate: load M = 4 x 4h = 16', ev.load.M === 16);
ok('evaluate: flags indispo Durand on 11 Dec (Conseil 13-17)', ev.indispo[sessions[7].id].includes('D'));
ok('evaluate: no false indispo/partial on session 1', !(ev.indispo[sessions[0].id] || []).length && !(ev.partial[sessions[0].id] || []).length);

/* ---- 3c. partial supervision + "sans encadrant" ---- */
console.log('\n[3c] supervision partielle / sans encadrant');
// only Durand exists, busy on 5 of 8 sessions -> a "full" project leaves 5 unfilled
const onlyD = [{ id: 'D', name: 'Durand', events: durand, preferred: [], maxHours: null }];
const rFull = S.run(sessions, onlyD, { targetPerSession: 1, minPerSession: 1 });
ok('full project: unstaffable sessions are "unfilled" (red)', rFull.unfilled.length === 5 && rFull.noSup.length === 0);
// same, but project declared "partial" -> those become "sans encadrant", not errors
const psP = sessions.map((s) => Object.assign({}, s, { supervision: 'partial', unsupTarget: 0 }));
const rPart = S.run(psP, onlyD, { targetPerSession: 1, minPerSession: 1 });
ok('partial project: unstaffable sessions become "sans encadrant"', rPart.unfilled.length === 0 && rPart.noSup.length === 5);
ok('partial project: unsupHours tracked', Math.abs((rPart.unsupHours.PRJ || 0) - 20) < 1e-6);
ok('partial project: supervisionOf recorded', rPart.supervisionOf.PRJ === 'partial');

// target of 8h unsupervised with both teachers free everywhere -> algo leaves ~8h unstaffed
const psT = sessions.map((s) => Object.assign({}, s, { supervision: 'partial', unsupTarget: 8 }));
const freeTeam = [
  { id: 'M', name: 'Martin', events: [], preferred: [], maxHours: null },
  { id: 'D', name: 'Durand', events: [], preferred: [], maxHours: null }
];
const rTgt = S.run(psT, freeTeam, { targetPerSession: 1, minPerSession: 1 });
ok('unsupervised-hours target honoured (~8h left sans encadrant)',
  rTgt.noSup.length === 2 && Math.abs((rTgt.unsupHours.PRJ || 0) - 8) < 1e-6);
ok('target does not overshoot', (rTgt.unsupHours.PRJ || 0) <= 8 + 1e-6);

// explicit per-session "sans encadrant" declaration is respected by run()
const rDecl = S.run(sessions, teachers, { targetPerSession: 1, minPerSession: 1,
  noSup: { [sessions[2].id]: true } });
ok('explicit noSup: session left unassigned', (rDecl.assignments[sessions[2].id] || []).length === 0);
ok('explicit noSup: not counted as unfilled', rDecl.unfilled.indexOf(sessions[2].id) === -1 && rDecl.noSup.indexOf(sessions[2].id) !== -1);
ok('explicit noSup: other sessions still staffed', rDecl.unfilled.length === 0);
const evDecl = S.evaluate(sessions, teachers, { minPerSession: 1, noSup: { [sessions[2].id]: true } }, { [sessions[2].id]: [] });
ok('evaluate honours explicit noSup', evDecl.noSup.indexOf(sessions[2].id) !== -1 && evDecl.unfilled.indexOf(sessions[2].id) === -1);

/* ---- 3d. session count follows the weights (encadrants + "sans encadrant") ---- */
console.log('\n[3d] repartition selon les poids');
// 12 free sessions, 4h each ; team Martin w=3, Durand w=1  -> ~9 vs ~3
const bigSessions = [];
for (let i = 0; i < 12; i++) {
  const d = new Date(2026, 8, 7 + i * 2, 8, 0, 0); // spread out, all weekdays-ish, no conflicts
  bigSessions.push({ id: 'b' + i, projectId: 'BIG', project: 'Big', label: 's' + i,
    start: new Date(d.getTime()).toISOString(), end: new Date(d.getTime() + 4 * 3600000).toISOString(), hours: 4 });
}
const bt = [
  { id: 'M', name: 'Martin', events: [], preferred: [], maxHours: null },
  { id: 'D', name: 'Durand', events: [], preferred: [], maxHours: null }
];
const rW = S.run(bigSessions, bt, { targetPerSession: 1, minPerSession: 1, prefWeight: 0,
  teams: { BIG: { M: { on: true, w: 3 }, D: { on: true, w: 1 } } } });
const cntM = bigSessions.filter((s) => (rW.assignments[s.id] || [])[0] === 'M').length;
const cntD = bigSessions.filter((s) => (rW.assignments[s.id] || [])[0] === 'D').length;
ok('weight 3:1 -> Martin gets ~3x Durand (9 vs 3, +/-1)', Math.abs(cntM - 9) <= 1 && Math.abs(cntD - 3) <= 1 && cntM + cntD === 12);
ok('run() exposes target hours per teacher', Math.abs((rW.target.M || 0) - 36) <= 6 && Math.abs((rW.target.D || 0) - 12) <= 6);

// same 12 sessions, add a "sans encadrant" weight of 2  ->  pool 3+1+2=6, unsup share 2/6 -> 8h -> 2 sessions
const rNS = S.run(bigSessions, bt, { targetPerSession: 1, minPerSession: 1, prefWeight: 0,
  teams: { BIG: { M: { on: true, w: 3 }, D: { on: true, w: 1 }, __nosup__: { on: true, w: 2 } } } });
ok('"sans encadrant" weight -> unsupervised hours share (48h x 2/6 = 16h -> 4 sessions)',
  rNS.noSup.length === 4 && Math.abs((rNS.unsupHours.BIG || 0) - 16) < 1e-6);
ok('"sans encadrant" weight leaves Martin:Durand still ~3:1 on the rest',
  (function () {
    const m = bigSessions.filter((s) => (rNS.assignments[s.id] || [])[0] === 'M').length;
    const d = bigSessions.filter((s) => (rNS.assignments[s.id] || [])[0] === 'D').length;
    return m + d === 8 && m >= d * 2;
  })());
ok('nosup weight does not make real encadrants ineligible',
  bigSessions.some((s) => (rNS.assignments[s.id] || []).length === 1));

// a teacher on TWO projects gets sessions from both (count grows with #projects)
const projA = bigSessions.slice(0, 6).map((s) => Object.assign({}, s, { id: 'a' + s.id, projectId: 'PA', project: 'PA' }));
const projB = bigSessions.slice(6, 12).map((s) => Object.assign({}, s, { id: 'x' + s.id, projectId: 'PB', project: 'PB' }));
const r2p = S.run(projA.concat(projB), bt, { targetPerSession: 1, minPerSession: 1, prefWeight: 0,
  teams: { PA: { M: { on: true, w: 1 }, D: { on: true, w: 1 } }, PB: { M: { on: true, w: 1 } } } });
const mAll = projA.concat(projB).filter((s) => (r2p.assignments[s.id] || [])[0] === 'M').length;
ok('teacher on 2 projects gets sessions from both, more than the one-project teacher',
  mAll >= 8 && (r2p.target.M || 0) > (r2p.target.D || 0) &&
  projA.some((s) => (r2p.assignments[s.id] || [])[0] === 'M') &&
  projB.every((s) => (r2p.assignments[s.id] || [])[0] === 'M'));

/* ---- 3e. session filtering (real-feed robustness) ---- */
console.log('\n[3e] filtres de seances');
P4.state = P4.migrate({ range: { from: '2026-09-01', to: '2027-07-31' } });
P4.state.sources = [{
  id: 'pj', name: 'PJ', type: 'project', enabled: true, color: '#000', supervision: 'full',
  events: [
    { start: '2026-09-21T06:00:00.000Z', end: '2026-09-21T10:00:00.000Z', allDay: false },
    { start: '2026-09-28T06:00:00.000Z', end: '2026-09-28T09:00:00.000Z', allDay: false },
    { start: '2026-10-26T00:00:00.000Z', end: '2026-11-02T00:00:00.000Z', allDay: false },
    { start: '2026-12-25', end: '2026-12-26', allDay: true }
  ]
}];
let ss = P4.sessions();
ok('drops all-day + multi-day block, keeps the timed slots', ss.length === 2);
ok('no session longer than the max', ss.every((s) => s.hours <= 12));
P4.state.scheduling.options.sessionMaxH = 3;
ss = P4.sessions();
ok('sessionMaxH=3 -> only the 3h slot survives', ss.length === 1 && ss[0].hours === 3);

/* ---- 3f. assistant name matching (homonyms / word boundary) ---- */
console.log('\n[3f] assistant : reconnaissance des noms');
const A = P4.views.assistant;
const TT = [
  { id: 'a', name: 'Dupont Alice' }, { id: 'b', name: 'Dupont Bruno' },
  { id: 'c', name: 'Martin' }, { id: 'd', name: 'Martinez' }
];
const m1 = A._matchNames('remplacer par dupont', TT);
ok('token "dupont" hitting 2 encadrants -> ambigu', m1.ambiguous.length === 1 && m1.ambiguous[0].names.length === 2 && m1.list.length === 0);
const m2 = A._matchNames('remplacer par dupont alice', TT);
ok('nom complet leve l\'ambiguite', m2.ambiguous.length === 0 && m2.list.length === 1 && m2.list[0].t.id === 'a');
const m3 = A._matchNames('charge de martin', TT);
ok('"martin" ne matche pas "martinez" (limites de mot)', m3.list.length === 1 && m3.list[0].t.id === 'c');
const m4 = A._matchNames('creneaux communs de martin et dupont bruno', TT);
ok('ordre respecte : martin puis dupont bruno', m4.list.length === 2 && m4.list[0].t.id === 'c' && m4.list[1].t.id === 'b');

/* ---- 3b. state migration ---- */
console.log('\n[3b] migrate');
const mArr = P4.migrate({ scheduling: { teams: { P1: ['A', 'B'] } } });
ok('migrate array team -> { on:true, w:1 }',
  mArr.scheduling.teams.P1.A.on === true && mArr.scheduling.teams.P1.A.w === 1);
const mNum = P4.migrate({ scheduling: { teams: { P1: { A: 2, B: 0 } } } });
ok('migrate numeric weight -> { on:true, w:2 }', mNum.scheduling.teams.P1.A.on === true && mNum.scheduling.teams.P1.A.w === 2);
ok('migrate numeric 0 -> { on:false }', mNum.scheduling.teams.P1.B.on === false);
ok('migrate keeps { on, w } as-is',
  P4.migrate({ scheduling: { teams: { P1: { A: { on: true, w: 3 } } } } }).scheduling.teams.P1.A.w === 3);
ok('migrate drops removed options',
  !('bufferMin' in mNum.scheduling.options) && !('balanceWeight' in mNum.scheduling.options));

P4.state = P4.migrate({});
P4.state.scheduling.teams = { PX: {} };
const cell = P4.teamCell('PX', 'T1');
ok('teamCell creates { on:false, w:1 }', cell.on === false && cell.w === 1);
cell.on = true; cell.w = 2.5;
ok('isEligible follows the checkbox', P4.isEligible('PX', 'T1') === true && P4.isEligible('PX', 'T2') === false);
ok('projectWeight returns the cell weight', P4.projectWeight('PX', 'T1') === 2.5);
cell.on = false;
ok('all cells off -> everyone eligible again', P4.isEligible('PX', 'T2') === true && P4.projectWeight('PX', 'T2') === 1);

// projectUnsupTarget : hours mode vs percent mode
const evs8 = [];
for (let i = 0; i < 8; i++) {
  const d = new Date(2026, 8, 7 + i, 13, 0, 0);
  evs8.push({ start: d.toISOString(), end: new Date(d.getTime() + 4 * 3600000).toISOString(), allDay: false });
}
ok('projectUnsupTarget (hours mode) = totales - encadrees',
  P4.projectUnsupTarget({ supervision: 'partial', supMode: 'hours', totalHours: 40, supervisedHours: 28 }) === 12);
ok('projectUnsupTarget (percent mode) = H x (1 - pct/100)',
  P4.projectUnsupTarget({ supervision: 'partial', supMode: 'percent', supPercent: 75, events: evs8 }) === 8);
ok('projectUnsupTarget percent 100 -> 0', P4.projectUnsupTarget({ supervision: 'partial', supMode: 'percent', supPercent: 100, events: evs8 }) === 0);
ok('projectUnsupTarget 0 for a "total" project',
  P4.projectUnsupTarget({ supervision: 'full', supMode: 'percent', supPercent: 50, events: evs8 }) === 0);

/* ---- 4. exporters ---- */
console.log('\n[4] CSV / ICS export');
const csv = P4.exp.toCSV(['A', 'B'], [['x', 'y;z']]);
ok('CSV quotes cells containing ";"', csv.includes('"y;z"'));
ok('CSV starts with BOM', csv.charCodeAt(0) === 0xFEFF);
const ics = P4.exp.toICS('test', [{ start: new Date('2026-09-18T11:00:00Z'), end: new Date('2026-09-18T15:00:00Z'), summary: 'S1' }]);
ok('ICS well-formed', ics.startsWith('BEGIN:VCALENDAR') && ics.trim().endsWith('END:VCALENDAR'));
ok('ICS has UTC DTSTART', /DTSTART:20260918T110000Z/.test(ics));

/* ---- 5. Excel template (exceljs) ---- */
(async () => {
  console.log('\n[5] modele Excel (import agendas)');
  try {
    const XL = require(path.join(ROOT, 'lib', 'xlsx.js'));
    const buf = await XL.buildTemplateBuffer();
    ok('template is a xlsx (PK zip signature)', Buffer.from(buf).slice(0, 2).toString('latin1') === 'PK');
    const tmp = path.join(require('os').tmpdir(), 'p4-tpl-' + Date.now() + '.xlsx');
    fs.writeFileSync(tmp, Buffer.from(buf));
    const parsed = await XL.parseWorkbook(tmp);
    try { fs.unlinkSync(tmp); } catch (e) { /* ignore */ }
    ok('template parses back (>= 5 rows)', parsed.ok && parsed.rows.length >= 5);
    const proj = (parsed.rows || []).find((r) => r.name === 'Projet Web S5');
    ok('project row: partial + hours mode 40/28', !!proj && proj.type === 'project' && proj.supervision === 'partial' && proj.supMode === 'hours' && proj.totalHours === 40 && proj.supervisedHours === 28);
    const projPct = (parsed.rows || []).find((r) => r.name === 'Projet Mobile S5');
    ok('project row: percent mode (supPercent 70)', !!projPct && projPct.supMode === 'percent' && projPct.supPercent === 70);
    ok('teacher rows recognised ("encadrant")', (parsed.rows || []).filter((r) => r.type === 'teacher').length >= 2);
    ok('no spurious warnings on the template', (parsed.rows || []).every((r) => !r.warnings.length));
    const dupont = (parsed.rows || []).find((r) => r.name === 'Dupont');
    ok('multi-colonne iCal : Dupont a 2 adresses (Adresse iCal 1 + 2)', !!dupont && Array.isArray(dupont.urls) && dupont.urls.length === 2);
    ok('projet a 1 seule adresse (Adresse iCal 1)', proj && proj.urls && proj.urls.length === 1);

    // header synonyms + messy values
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('x');
    ws.addRow(['type', 'NOM', 'Supervision', 'URL', 'heures total', 'heures encadrées']);
    ws.addRow(['Enseignant', ' Durand ', '', 'https://ex.fr/d.ics', '', '']);
    ws.addRow(['projet', 'P Alpha', 'Partiellement encadré', 'ftp://bad', '12,5', '4']);
    const tmp2 = path.join(require('os').tmpdir(), 'p4-tpl2-' + Date.now() + '.xlsx');
    fs.writeFileSync(tmp2, Buffer.from(await wb.xlsx.writeBuffer()));
    const p2 = await XL.parseWorkbook(tmp2);
    try { fs.unlinkSync(tmp2); } catch (e) { /* ignore */ }
    ok('synonym headers detected, 2 data rows', p2.ok && p2.rows.length === 2);
    ok('trims name + maps "Enseignant" -> teacher', p2.rows[0].name === 'Durand' && p2.rows[0].type === 'teacher');
    ok('"Partiellement encadré" -> partial, "12,5" -> 12.5', p2.rows[1].supervision === 'partial' && p2.rows[1].totalHours === 12.5);
    ok('single "URL" header recognised as a url column', p2.rows[0].urls.length === 1 && p2.rows[0].urls[0] === 'https://ex.fr/d.ics');
    ok('flags non-http iCal address', p2.rows[1].warnings.some((w) => /http/.test(w)));

    // several numbered "Adresse iCal N" columns on one row
    const wb3 = new ExcelJS.Workbook();
    const ws3 = wb3.addWorksheet('x');
    ws3.addRow(['Nom', 'Projet ou encadrant', 'Adresse iCal 1', 'Adresse iCal 2', 'Adresse iCal 3']);
    ws3.addRow(['Dupont', 'encadrant', 'https://a.fr/1.ics', 'https://a.fr/2.ics', '']);
    const tmp3 = path.join(require('os').tmpdir(), 'p4-tpl3-' + Date.now() + '.xlsx');
    fs.writeFileSync(tmp3, Buffer.from(await wb3.xlsx.writeBuffer()));
    const p3 = await XL.parseWorkbook(tmp3);
    try { fs.unlinkSync(tmp3); } catch (e) { /* ignore */ }
    ok('3 numbered url columns -> 2 non-empty urls, in order', p3.ok && p3.rows.length === 1 &&
      p3.rows[0].urls.length === 2 && p3.rows[0].urls[0] === 'https://a.fr/1.ics' && p3.rows[0].urls[1] === 'https://a.fr/2.ics');
  } catch (e) {
    ok('xlsx module works', false);
    console.log('   ' + ((e && e.stack) || e));
  }

  console.log('\n=====================================');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
