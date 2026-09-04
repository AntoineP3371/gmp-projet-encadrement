/* CSV + ICS serialisation helpers. */
(function () {
  'use strict';
  window.P4 = window.P4 || {};

  function csvCell(v) {
    const s = v == null ? '' : String(v);
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCSV(headers, rows) {
    const lines = [headers.map(csvCell).join(';')];
    for (const r of rows) lines.push(r.map(csvCell).join(';'));
    return '\uFEFF' + lines.join('\r\n');
  }

  function icsDate(d) {
    const p = (n) => String(n).padStart(2, '0');
    return d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + 'T' +
      p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + 'Z';
  }

  function fold(line) {
    if (line.length <= 74) return line;
    const out = [];
    let s = line;
    out.push(s.slice(0, 74));
    s = s.slice(74);
    while (s.length) { out.push(' ' + s.slice(0, 73)); s = s.slice(73); }
    return out.join('\r\n');
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  }

  /* events: [{start:Date, end:Date, summary, description, location}] */
  function toICS(prodName, events) {
    const now = new Date();
    const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Encadrement projet//' + (prodName || 'export') + '//FR', 'CALSCALE:GREGORIAN'];
    events.forEach((e, i) => {
      L.push('BEGIN:VEVENT');
      L.push('UID:p4-' + now.getTime() + '-' + i + '@p4scheduler');
      L.push('DTSTAMP:' + icsDate(now));
      L.push('DTSTART:' + icsDate(e.start));
      L.push('DTEND:' + icsDate(e.end));
      L.push(fold('SUMMARY:' + esc(e.summary)));
      if (e.location) L.push(fold('LOCATION:' + esc(e.location)));
      if (e.description) L.push(fold('DESCRIPTION:' + esc(e.description)));
      L.push('END:VEVENT');
    });
    L.push('END:VCALENDAR');
    return L.join('\r\n');
  }

  window.P4.exp = { toCSV, toICS };
})();
