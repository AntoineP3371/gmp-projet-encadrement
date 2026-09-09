/* Interval arithmetic. An interval = { start: ms, end: ms }. Pure, no DOM. */
(function () {
  'use strict';
  window.PE = window.PE || {};

  function normalize(intervals) {
    const arr = (intervals || [])
      .filter((i) => i && i.end > i.start)
      .map((i) => ({ start: i.start, end: i.end }))
      .sort((a, b) => a.start - b.start);
    const merged = [];
    for (const it of arr) {
      const last = merged[merged.length - 1];
      if (last && it.start <= last.end) last.end = Math.max(last.end, it.end);
      else merged.push({ start: it.start, end: it.end });
    }
    return merged;
  }

  function intersectTwo(a, b) {
    a = normalize(a);
    b = normalize(b);
    const res = [];
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
      const s = Math.max(a[i].start, b[j].start);
      const e = Math.min(a[i].end, b[j].end);
      if (e > s) res.push({ start: s, end: e });
      if (a[i].end < b[j].end) i++;
      else j++;
    }
    return res;
  }

  function intersectMany(lists) {
    if (!lists || !lists.length) return [];
    let acc = normalize(lists[0]);
    for (let k = 1; k < lists.length; k++) {
      acc = intersectTwo(acc, lists[k]);
      if (!acc.length) break;
    }
    return acc;
  }

  /* Complement of `intervals` within [windowStart, windowEnd]. */
  function invert(intervals, windowStart, windowEnd) {
    const merged = normalize(intervals);
    const res = [];
    let cursor = windowStart;
    for (const it of merged) {
      if (it.end <= windowStart) continue;
      if (it.start >= windowEnd) break;
      if (it.start > cursor) res.push({ start: cursor, end: Math.min(it.start, windowEnd) });
      cursor = Math.max(cursor, it.end);
      if (cursor >= windowEnd) break;
    }
    if (cursor < windowEnd) res.push({ start: cursor, end: windowEnd });
    return res.filter((i) => i.end > i.start);
  }

  function overlaps(a, b) { return a.start < b.end && b.start < a.end; }

  function overlapsAny(iv, list) {
    for (const x of list) if (iv.start < x.end && x.start < iv.end) return true;
    return false;
  }

  /* Keep only the parts of `intervals` that fall on allowed weekdays,
     between dayStartH:00 and dayEndH:00 (local time). */
  function clampToWorkingHours(intervals, dayStartH, dayEndH, workdays) {
    const out = [];
    for (const it of normalize(intervals)) {
      const cur = new Date(it.start);
      cur.setHours(0, 0, 0, 0);
      while (cur.getTime() < it.end) {
        if (workdays.indexOf(cur.getDay()) !== -1) {
          const ds = new Date(cur); ds.setHours(dayStartH, 0, 0, 0);
          const de = new Date(cur); de.setHours(dayEndH, 0, 0, 0);
          const s = Math.max(it.start, ds.getTime());
          const e = Math.min(it.end, de.getTime());
          if (e > s) out.push({ start: s, end: e });
        }
        cur.setDate(cur.getDate() + 1);
      }
    }
    return normalize(out);
  }

  /* Working-hours grid over [windowStart, windowEnd] with SEVERAL daily ranges,
     e.g. [{from:8,to:11},{from:14,to:16}]. Fractional hours allowed (8.5 = 08:30). */
  function workingWindowRanges(windowStart, windowEnd, ranges, workdays) {
    const rs = (ranges || []).filter((r) => r && +r.to > +r.from);
    if (!rs.length) return [];
    const out = [];
    const cur = new Date(windowStart);
    cur.setHours(0, 0, 0, 0);
    while (cur.getTime() < windowEnd) {
      if (workdays.indexOf(cur.getDay()) !== -1) {
        for (const r of rs) {
          const from = +r.from;
          const to = +r.to;
          const ds = new Date(cur); ds.setHours(Math.floor(from), Math.round((from % 1) * 60), 0, 0);
          const de = new Date(cur); de.setHours(Math.floor(to), Math.round((to % 1) * 60), 0, 0);
          const s = Math.max(windowStart, ds.getTime());
          const e = Math.min(windowEnd, de.getTime());
          if (e > s) out.push({ start: s, end: e });
        }
      }
      cur.setDate(cur.getDate() + 1);
    }
    return normalize(out);
  }

  /* Full working-hours grid over [windowStart, windowEnd]. */
  function workingWindow(windowStart, windowEnd, dayStartH, dayEndH, workdays) {
    const out = [];
    const cur = new Date(windowStart);
    cur.setHours(0, 0, 0, 0);
    while (cur.getTime() < windowEnd) {
      if (workdays.indexOf(cur.getDay()) !== -1) {
        const ds = new Date(cur); ds.setHours(dayStartH, 0, 0, 0);
        const de = new Date(cur); de.setHours(dayEndH, 0, 0, 0);
        const s = Math.max(windowStart, ds.getTime());
        const e = Math.min(windowEnd, de.getTime());
        if (e > s) out.push({ start: s, end: e });
      }
      cur.setDate(cur.getDate() + 1);
    }
    return out;
  }

  function totalHours(intervals) {
    return normalize(intervals).reduce((a, i) => a + (i.end - i.start), 0) / 3600000;
  }

  window.PE.fb = {
    normalize, intersectTwo, intersectMany, invert, overlaps, overlapsAny,
    clampToWorkingHours, workingWindow, workingWindowRanges, totalHours
  };
})();
