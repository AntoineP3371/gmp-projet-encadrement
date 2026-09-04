'use strict';

/* iCal download + parsing for the main process. Plain Node module
   (only depends on ical.js) so it can be unit-tested without Electron. */

const ICAL = require('ical.js');

async function fetchText(url) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'EncadrementProjet/1.0' }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + res.statusText);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

function rndUid() {
  return 'x-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function parseICS(text, rangeStartISO, rangeEndISO) {
  const jcal = ICAL.parse(text);
  const comp = new ICAL.Component(jcal);

  comp.getAllSubcomponents('vtimezone').forEach((vt) => {
    try {
      const tz = new ICAL.Timezone(vt);
      if (tz.tzid && !ICAL.TimezoneService.has(tz.tzid)) ICAL.TimezoneService.register(vt);
    } catch (_) { /* ignore */ }
  });

  const rs = rangeStartISO ? new Date(rangeStartISO) : null;
  const re = rangeEndISO ? new Date(rangeEndISO) : null;
  const rsMs = rs ? rs.getTime() - 86400000 : null;
  const reMs = re ? re.getTime() + 86400000 : null;
  const MAX_OCC = 6000;

  const all = comp.getAllSubcomponents('vevent');
  const masters = [];
  const exceptions = [];
  for (const ve of all) {
    if (ve.hasProperty('recurrence-id')) exceptions.push(ve);
    else masters.push(ve);
  }

  const out = [];
  const usedExceptions = new Set();

  const pushOcc = (uid, summary, location, s, e, allDay) => {
    if (re && s > re) return;
    if (rs && e < rs) return;
    out.push({
      uid: uid || rndUid(),
      summary: summary || '(sans titre)',
      location: location || '',
      start: s.toISOString(),
      end: e.toISOString(),
      allDay: !!allDay
    });
  };

  for (const ve of masters) {
    let event;
    try { event = new ICAL.Event(ve); } catch (_) { continue; }

    for (const ex of exceptions) {
      try {
        if (ex.getFirstPropertyValue('uid') === event.uid) {
          event.relateException(new ICAL.Event(ex));
          usedExceptions.add(ex);
        }
      } catch (_) { /* ignore */ }
    }

    const summary = event.summary;
    const location = event.location;
    const uid = event.uid || rndUid();

    if (event.isRecurring()) {
      let iter;
      try {
        iter = event.iterator();
      } catch (_) { continue; }
      let next;
      let count = 0;
      while ((next = iter.next()) && count < MAX_OCC) {
        count++;
        const nextMs = next.toJSDate().getTime();
        if (reMs != null && nextMs > reMs) break;
        if (rsMs != null && nextMs < rsMs) continue;
        let d;
        try { d = event.getOccurrenceDetails(next); } catch (_) { continue; }
        const s = d.startDate.toJSDate();
        const e = d.endDate.toJSDate();
        if (re && s > re) break;
        if (rs && e < rs) continue;
        pushOcc(uid, (d.item && d.item.summary) || summary, (d.item && d.item.location) || location, s, e, d.startDate.isDate);
      }
    } else {
      if (!event.startDate) continue;
      const s = event.startDate.toJSDate();
      const e = event.endDate ? event.endDate.toJSDate() : new Date(s.getTime() + 3600000);
      pushOcc(uid, summary, location, s, e, event.startDate.isDate);
    }
  }

  for (const ex of exceptions) {
    if (usedExceptions.has(ex)) continue;
    try {
      const event = new ICAL.Event(ex);
      if (!event.startDate) continue;
      const s = event.startDate.toJSDate();
      const e = event.endDate ? event.endDate.toJSDate() : new Date(s.getTime() + 3600000);
      pushOcc(event.uid || rndUid(), event.summary, event.location, s, e, event.startDate.isDate);
    } catch (_) { /* ignore */ }
  }

  out.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  return out;
}

module.exports = { fetchText, parseICS };
