(function () {
  'use strict';
  const PE = window.PE;
  const U = PE.util;
  const S = PE.scheduler;
  const FB = PE.fb;

  const norm = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const fmtH = (h) => (Math.round(h * 100) / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' h';
  const slotStr = (free) => (free || []).map((iv) => U.fmtTime(iv.start) + '–' + U.fmtTime(iv.end)).join(', ');
  const FULL = 1 - 1e-9;

  /* ---------------- shared context ---------------- */
  function ctx() {
    const T = PE.teacherModels();
    const sessions = PE.sessions();
    const a = PE.assignments();
    Object.keys(a).forEach((k) => { if (!sessions.find((s) => s.id === k)) delete a[k]; });
    const o = PE.state.scheduling.options;
    const ev = S.evaluate(sessions, T, PE.schedOptions(), a);
    const busyMap = {};
    T.forEach((t) => { busyMap[t.id] = S.teacherBusy(t.events, o.allDayBusy); });
    const ivsMap = {};
    T.forEach((t) => { ivsMap[t.id] = []; });
    sessions.forEach((s) => (a[s.id] || []).forEach((tid) => {
      if (ivsMap[tid]) ivsMap[tid].push({ start: +new Date(s.start), end: +new Date(s.end), sid: s.id });
    }));
    const byId = {};
    T.forEach((t) => { byId[t.id] = t; });
    const cov = (tid, s) => {
      const sMs = { start: +new Date(s.start), end: +new Date(s.end) };
      return S.coverage(busyMap[tid] || [], (ivsMap[tid] || []).filter((iv) => iv.sid !== s.id), sMs);
    };
    const freeIn = (tid, start, end) => {
      const blk = FB.normalize((busyMap[tid] || []).concat(ivsMap[tid] || []));
      return FB.invert(blk, start, end);
    };
    return { T, sessions, a, o, ev, busyMap, ivsMap, byId, cov, freeIn };
  }

  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wordAt = (hay, needle) => {
    const m = new RegExp('(^|[^a-z0-9])' + reEsc(needle) + '([^a-z0-9]|$)').exec(hay);
    return m ? m.index + m[1].length : -1;
  };

  /* Returns { list: [{t,pos}], ambiguous: [{via, names:[t...]}] }.
     A full-name match wins ; a bare token match that falls *inside* another
     encadrant's full-name match is discarded ; a token matched by >= 2 distinct
     encadrants (and by none of them via a full name) is flagged ambiguous. */
  function matchNames(qn, T) {
    const raw = [];
    T.forEach((t) => {
      const full = norm(t.name).trim();
      if (!full) return;
      const pf = wordAt(qn, full);
      if (pf !== -1) { raw.push({ t: t, pos: pf, len: full.length, byFull: true, via: full }); return; }
      let best = -1;
      let bestVia = '';
      let bestLen = 0;
      full.split(/[^a-z0-9]+/).filter((x) => x.length >= 3).forEach((tok) => {
        const p = wordAt(qn, tok);
        if (p !== -1 && (best === -1 || p < best)) { best = p; bestVia = tok; bestLen = tok.length; }
      });
      if (best !== -1) raw.push({ t: t, pos: best, len: bestLen, byFull: false, via: bestVia });
    });

    const fullSpans = raw.filter((h) => h.byFull).map((h) => [h.pos, h.pos + h.len]);
    const kept = raw.filter((h) => h.byFull || !fullSpans.some((sp) => h.pos >= sp[0] && h.pos < sp[1]));

    const byKey = {};
    kept.forEach((h) => {
      const k = h.byFull ? ('F:' + h.t.id) : ('T:' + h.via + '@' + h.pos);
      (byKey[k] = byKey[k] || []).push(h);
    });

    const list = [];
    const ambiguous = [];
    const seen = {};
    Object.keys(byKey).forEach((k) => {
      const g = byKey[k];
      if (k.charAt(0) === 'T' && g.length > 1) { ambiguous.push({ via: g[0].via, names: g.map((x) => x.t) }); return; }
      g.forEach((x) => { if (!seen[x.t.id]) { seen[x.t.id] = 1; list.push({ t: x.t, pos: x.pos }); } });
    });
    list.sort((a, b) => a.pos - b.pos);
    return { list: list, ambiguous: ambiguous };
  }

  /* ---------------- reply builders ---------------- */
  const note = (msg) => ({ html: '<p>' + msg + '</p>' });
  const warn = (msg) => ({ html: '<p class="badge warn" style="display:inline-block">' + U.esc(msg) + '</p>' });

  function help(T) {
    const names = T.map((t) => U.esc(t.name)).join(', ') || '(aucun)';
    return {
      html: `<p><b>Je réponds à ces questions</b> (utilise les noms exacts des agendas encadrants) :</p>
      <ul style="margin:4px 0 4px 18px;padding:0">
        <li>« séances où <i>Dupont</i> peut remplacer <i>Martin</i> » — remplacement possible</li>
        <li>« rééquilibrer les heures entre <i>Dupont</i> et <i>Martin</i> » — propose des transferts</li>
        <li>« créneaux libres communs de <i>Dupont</i> et <i>Martin</i> » — disponibilités partagées</li>
        <li>« charge de <i>Dupont</i> » / « charge » — heures affectées vs cible</li>
        <li>« qui est libre le 12/11 après-midi ? » — disponibilités à une date</li>
      </ul>
      <p class="muted">Encadrants reconnus : ${names}</p>`
    };
  }

  /* -- remplacement -- */
  function intentReplace(qn, c, names) {
    if (names.length < 2) return warn('Nomme deux encadrants : « séances où X peut remplacer Y ».');
    let X;
    let Y;
    const parIdx = qn.indexOf(' par ');
    if (parIdx !== -1) {
      const after = names.filter((n) => n.pos > parIdx);
      const before = names.filter((n) => n.pos < parIdx);
      X = (after[0] || names[names.length - 1]).t;
      Y = (before[before.length - 1] || names[0]).t;
    } else {
      X = names[0].t;
      Y = names[1].t;
    }
    if (X.id === Y.id) return warn('Il faut deux encadrants différents.');

    const held = c.sessions.filter((s) => (c.a[s.id] || []).indexOf(Y.id) !== -1);
    if (!held.length) return note(U.esc(Y.name) + ' n\'encadre aucune séance actuellement.');

    const rows = held
      .filter((s) => (c.a[s.id] || []).indexOf(X.id) === -1)
      .map((s) => {
        const elig = PE.isEligible(s.projectId, X.id);
        const cv = c.cov(X.id, s);
        return { s: s, elig: elig, cv: cv };
      })
      .sort((r1, r2) => (r2.cv.frac - r1.cv.frac));

    const feasible = rows.filter((r) => r.elig && r.cv.frac > 1e-9).length;

    const body = rows.map((r) => {
      const s = r.s;
      let can;
      let btn = '';
      if (!r.elig) can = '<span class="badge warn">hors équipe</span>';
      else if (r.cv.frac >= FULL) { can = '<span class="badge ok">toute la séance</span>'; btn = repBtn(s.id, Y.id, X.id, X.name, s); }
      else if (r.cv.frac > 1e-9) { can = '<span class="badge warn">' + fmtH(r.cv.freeMs / 3600000) + ' &middot; ' + slotStr(r.cv.free) + '</span>'; btn = repBtn(s.id, Y.id, X.id, X.name, s); }
      else can = '<span class="badge danger">indisponible</span>';
      return `<tr><td>${U.fmtShort(s.start)}</td><td>${U.fmtRange(s.start, s.end)}</td><td>${U.esc(s.project)}</td><td>${U.esc(s.label)}</td><td>${can}</td><td>${btn}</td></tr>`;
    }).join('');

    return {
      html: `<p><b>${U.esc(Y.name)}</b> encadre ${held.length} séance(s). <b>${U.esc(X.name)}</b> peut en reprendre <b>${feasible}</b> :</p>
      <div style="overflow:auto"><table class="grid"><thead><tr><th>Date</th><th>Horaire</th><th>Projet</th><th>Séance</th><th>${U.esc(X.name)} peut ?</th><th></th></tr></thead>
      <tbody>${body}</tbody></table></div>`
    };
  }
  function repBtn(sid, oldId, newId, newName, s) {
    return `<button class="small primary as-act" data-act="replace" data-sid="${sid}" data-old="${oldId}" data-new="${newId}" data-lbl="${U.esc(newName + ' — ' + s.project + ' ' + s.label + ' (' + U.fmtShort(s.start) + ')')}">Remplacer</button>`;
  }

  /* -- rééquilibrage -- */
  function intentBalance(qn, c, names) {
    if (names.length < 2) return warn('Nomme deux encadrants : « rééquilibrer les heures entre X et Y ».');
    const A = names[0].t;
    const B = names[1].t;
    if (A.id === B.id) return warn('Il faut deux encadrants différents.');
    let hi = (c.ev.load[A.id] || 0) >= (c.ev.load[B.id] || 0) ? A : B;
    let lo = hi === A ? B : A;
    let hiL = c.ev.load[hi.id] || 0;
    let loL = c.ev.load[lo.id] || 0;
    const step = c.o.sessionHours || 4;
    if (Math.abs(hiL - loL) < step - 0.01) {
      return note(`${U.esc(A.name)} : ${fmtH(c.ev.load[A.id] || 0)} &middot; ${U.esc(B.name)} : ${fmtH(c.ev.load[B.id] || 0)}. L'écart est déjà inférieur à une séance — rien à rééquilibrer.`);
    }
    const simLo = (c.ivsMap[lo.id] || []).slice();
    const transfers = [];
    let guard = 0;
    while (hiL - loL > step - 0.01 && guard++ < 60) {
      let best = null;
      let bestGap = hiL - loL;
      for (const s of c.sessions) {
        if ((c.a[s.id] || []).indexOf(hi.id) === -1) continue;
        if (transfers.find((x) => x.sid === s.id)) continue;
        if ((c.a[s.id] || []).indexOf(lo.id) !== -1) continue;
        if (!PE.isEligible(s.projectId, lo.id)) continue;
        const sMs = { start: +new Date(s.start), end: +new Date(s.end) };
        const blk = FB.normalize((c.busyMap[lo.id] || []).concat(simLo));
        const free = FB.invert(blk, sMs.start, sMs.end);
        const freeMs = free.reduce((x, i) => x + (i.end - i.start), 0);
        if (freeMs < (sMs.end - sMs.start) - 1) continue;
        const dur = s.hours || 0;
        const gapAfter = Math.abs((hiL - dur) - (loL + dur));
        if (gapAfter < bestGap - 0.01) { bestGap = gapAfter; best = s; }
      }
      if (!best) break;
      transfers.push({ sid: best.id, s: best });
      hiL -= best.hours || 0;
      loL += best.hours || 0;
      simLo.push({ start: +new Date(best.start), end: +new Date(best.end), sid: best.id });
    }

    const cur = `<p>Actuel : <b>${U.esc(A.name)}</b> ${fmtH(c.ev.load[A.id] || 0)} &middot; <b>${U.esc(B.name)}</b> ${fmtH(c.ev.load[B.id] || 0)}.</p>`;
    if (!transfers.length) {
      return { html: cur + `<p class="badge warn" style="display:inline-block">Aucun transfert possible : ${U.esc(lo.name)} n'est libre sur aucune séance de ${U.esc(hi.name)} (ou n'y est pas éligible).</p>` };
    }
    const list = transfers.map((tr) => `<li>${U.esc(tr.s.project)} — ${U.esc(tr.s.label)} (${U.fmtShort(tr.s.start)}, ${tr.s.hours} h) : <b>${U.esc(hi.name)} → ${U.esc(lo.name)}</b></li>`).join('');
    const payload = JSON.stringify(transfers.map((tr) => ({ sid: tr.sid, from: hi.id, to: lo.id })));
    return {
      html: cur +
        `<p>Proposition — ${transfers.length} transfert(s), de ${U.esc(hi.name)} vers ${U.esc(lo.name)} :</p>
        <ul style="margin:4px 0 6px 18px;padding:0">${list}</ul>
        <p>Après : <b>${U.esc(hi.name)}</b> ${fmtH(hiL)} &middot; <b>${U.esc(lo.name)}</b> ${fmtH(loL)} &nbsp;(écart ${fmtH(Math.abs(hiL - loL))}).</p>
        <button class="small primary as-act" data-act="balance" data-transfers='${U.esc(payload)}' data-lbl="${U.esc(hi.name + ' → ' + lo.name)}">Appliquer le rééquilibrage</button>`
    };
  }

  /* -- créneaux communs -- */
  function intentCommon(qn, c, names) {
    if (names.length < 2) return warn('Nomme au moins deux encadrants.');
    const ids = names.map((n) => n.t.id);
    const wStart = +new Date(PE.state.range.from);
    const wEnd = +new Date(PE.state.range.to + 'T23:59:59');
    const work = PE.state.common.work || { days: [1, 2, 3, 4, 5], startH: 8, endH: 20 };
    const grid = FB.workingWindow(wStart, wEnd, work.startH, work.endH, work.days);
    if (!grid.length) return warn('La fenêtre de travail (onglet Périodes communes) est vide.');
    const allBusy = FB.normalize([].concat.apply([], ids.map((id) => (c.busyMap[id] || []).concat(c.ivsMap[id] || []))));
    let res = [];
    grid.forEach((g) => FB.invert(allBusy, g.start, g.end).forEach((x) => res.push(x)));
    res = FB.normalize(res);
    const names2 = names.map((n) => U.esc(n.t.name)).join(', ');
    if (!res.length) return note(`Aucun créneau commun libre pour ${names2} sur la plage et la fenêtre horaire (${work.startH} h–${work.endH} h) actuelles.`);
    const groups = {};
    res.forEach((iv) => { const k = U.dayKey(iv.start); (groups[k] = groups[k] || []).push(iv); });
    const total = Math.round(res.reduce((a, i) => a + (i.end - i.start), 0) / 360000) / 10;
    const body = Object.keys(groups).sort().map((k) => {
      const d = new Date(k + 'T00:00:00');
      return `<tr><td>${U.esc(U.fmtDay(d))}</td><td>${groups[k].map((iv) => U.fmtRange(iv.start, iv.end)).join(', ')}</td></tr>`;
    }).join('');
    return {
      html: `<p>Créneaux libres communs — <b>${names2}</b> &middot; ${total} h au total (fenêtre ${work.startH} h–${work.endH} h) :</p>
      <div style="overflow:auto"><table class="grid"><thead><tr><th>Jour</th><th>Créneaux</th></tr></thead><tbody>${body}</tbody></table></div>`
    };
  }

  /* -- charge / cible -- */
  function intentLoad(qn, c, names) {
    const who = names.length ? names.map((n) => n.t) : c.T;
    const body = who.map((t) => {
      const load = c.ev.load[t.id] || 0;
      const tgt = (c.ev.target && c.ev.target[t.id]) || 0;
      const diff = Math.round((load - tgt) * 10) / 10;
      const col = diff > 0.05 ? 'var(--warn)' : (diff < -0.05 ? 'var(--accent)' : 'inherit');
      return `<tr><td><span class="dot" style="background:${t.color}"></span> ${U.esc(t.name)}</td><td style="text-align:right">${fmtH(load)}</td><td style="text-align:right">${fmtH(tgt)}</td><td style="text-align:right;color:${col}">${diff > 0 ? '+' : ''}${fmtH(diff)}</td></tr>`;
    }).join('');
    return {
      html: `<p>Charge d'encadrement (heures affectées) vs cible d'après les poids :</p>
      <div style="overflow:auto"><table class="grid"><thead><tr><th>Encadrant</th><th style="text-align:right">Affecté</th><th style="text-align:right">Cible</th><th style="text-align:right">Écart</th></tr></thead><tbody>${body}</tbody></table></div>
      <p class="muted">Écart &gt; 0 = au-dessus de sa cible, &lt; 0 = en-dessous.</p>`
    };
  }

  /* -- disponibilités à une date -- */
  function intentDate(qn, c, names, dm) {
    const day = +dm[1];
    const month = +dm[2];
    let year = dm[3] ? (+dm[3] < 100 ? 2000 + +dm[3] : +dm[3]) : new Date(PE.state.range.from).getFullYear();
    let d = new Date(year, month - 1, day);
    if (!dm[3] && d < new Date(PE.state.range.from)) { year++; d = new Date(year, month - 1, day); }
    let h0 = work0(qn);
    let h1 = work1(qn);
    const winS = new Date(d); winS.setHours(h0, 0, 0, 0);
    const winE = new Date(d); winE.setHours(h1, 0, 0, 0);
    const who = names.length ? names.map((n) => n.t) : c.T;
    const label = /matin/.test(qn) ? 'matin' : (/apr[eè]s?[- ]?midi|aprem/.test(qn) ? 'après-midi' : (/soir/.test(qn) ? 'soirée' : 'journée'));
    const body = who.map((t) => {
      const free = c.freeIn(t.id, +winS, +winE);
      const freeMs = free.reduce((a, i) => a + (i.end - i.start), 0);
      const cell = freeMs <= 1000 ? '<span class="badge danger">occupé</span>'
        : (freeMs >= (winE - winS) - 1000 ? '<span class="badge ok">toute la plage</span>' : '<span class="badge warn">' + slotStr(free) + '</span>');
      return `<tr><td><span class="dot" style="background:${t.color}"></span> ${U.esc(t.name)}</td><td>${cell}</td></tr>`;
    }).join('');
    return {
      html: `<p>Disponibilités le <b>${U.esc(U.fmtDay(d))}</b> (${label}, ${h0} h–${h1} h) :</p>
      <div style="overflow:auto"><table class="grid"><thead><tr><th>Encadrant</th><th>Libre</th></tr></thead><tbody>${body}</tbody></table></div>`
    };
  }
  function work0(qn) { return /matin/.test(qn) ? 8 : (/apr[eè]s?[- ]?midi|aprem/.test(qn) ? 13 : (/soir/.test(qn) ? 18 : 8)); }
  function work1(qn) { return /matin/.test(qn) ? 12 : (/apr[eè]s?[- ]?midi|aprem/.test(qn) ? 18 : (/soir/.test(qn) ? 22 : 20)); }

  /* ---------------- router ---------------- */
  function answer(q) {
    const qn = norm(q).replace(/\s+/g, ' ').trim();
    const c = ctx();
    if (!c.T.length) return warn('Aucun encadrant : ajoutez des agendas de type « enseignant ».');
    const mn = matchNames(qn, c.T);
    const names = mn.list;
    if (mn.ambiguous.length) {
      const a = mn.ambiguous[0];
      return warn('« ' + a.via + ' » correspond à plusieurs encadrants : ' + a.names.map((t) => t.name).join(', ') + '. Précise le nom complet.');
    }
    const dm = qn.match(/\b(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2,4}))?\b/);

    if (/remplac/.test(qn)) return intentReplace(qn, c, names);
    if (/(reequilibr|equilibr|repartir mieux|repartition des heures|equilibrage)/.test(qn)) return intentBalance(qn, c, names);
    if (dm && /(libre|dispo|disponib|qui peut|occup)/.test(qn)) return intentDate(qn, c, names, dm);
    if (/(commun|ensemble|libres.*commun|creneaux? communs?|dispo.*commun)/.test(qn) && names.length >= 2) return intentCommon(qn, c, names);
    if (/(charge|combien d ?h|nombre d ?h|cible|sous.?charg|sur.?charg|equilibre actuel)/.test(qn)) return intentLoad(qn, c, names);
    if (names.length >= 2) return intentCommon(qn, c, names);
    if (names.length === 1) return intentLoad(qn, c, names);
    return help(c.T);
  }

  /* ---------------- actions ---------------- */
  function doReplace(sid, oldId, newId) {
    const sch = PE.state.scheduling;
    const a = PE.assignments();
    a[sid] = (a[sid] || []).map((x) => (x === oldId ? newId : x));
    if (a[sid].indexOf(newId) === -1) a[sid].push(newId);
    sch.locked[sid] = (sch.locked[sid] || []).filter((x) => x !== oldId);
    if (sch.locked[sid].indexOf(newId) === -1) sch.locked[sid].push(newId);
    if (sch.noSup) delete sch.noSup[sid];
  }

  /* ---------------- view ---------------- */
  function pushLog(role, payload) {
    const log = PE.state.assistant.log;
    log.push(role === 'user' ? { role: 'user', text: payload } : { role: 'bot', html: payload });
    while (log.length > 40) log.shift();
  }

  function render(root) {
    const log = PE.state.assistant.log;
    root.innerHTML = `
      <div class="view-head">
        <h1>Assistant</h1>
        <span class="sub">Questions d'organisation — 100% local, aucune donnée envoyée.</span>
      </div>
      <div class="panel">
        <div id="as-log" class="as-log">
          ${log.length
            ? log.map((m) => (m.role === 'user'
              ? `<div class="as-u">${U.esc(m.text)}</div>`
              : `<div class="as-b">${m.html}</div>`)).join('')
            : `<div class="as-b">${help(PE.teacherModels()).html}</div>`}
        </div>
        <form id="as-form" class="row" style="margin-top:10px">
          <input id="as-q" placeholder="Ex : séances où Dupont peut remplacer Martin" style="flex:1;min-width:280px" autocomplete="off" />
          <button class="primary" type="submit">Demander</button>
          <button type="button" id="as-clear">Effacer</button>
        </form>
        <div class="row wrap-tight" style="margin-top:8px">
          <span class="muted">Exemples :</span>
          ${['séances où A peut remplacer B', 'rééquilibrer les heures entre A et B', 'créneaux libres communs de A et B', 'charge de A', 'qui est libre le 12/11 après-midi ?']
            .map((x) => `<button class="small as-ex">${x}</button>`).join('')}
        </div>
      </div>`;

    const logEl = root.querySelector('#as-log');
    logEl.scrollTop = logEl.scrollHeight;
    const input = root.querySelector('#as-q');

    root.querySelector('#as-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const q = input.value.trim();
      if (!q) return;
      let res;
      try { res = answer(q); } catch (err) { res = { html: '<p class="badge danger" style="display:inline-block">Erreur : ' + U.esc(String(err && err.message || err)) + '</p>' }; }
      pushLog('user', q);
      pushLog('bot', res.html);
      PE.save();
      PE.rerender();
    });
    root.querySelector('#as-clear').addEventListener('click', () => {
      PE.state.assistant.log = [];
      PE.save();
      PE.rerender();
    });
    root.querySelectorAll('.as-ex').forEach((b) => b.addEventListener('click', () => {
      input.value = b.textContent;
      input.focus();
    }));

    logEl.querySelectorAll('.as-act').forEach((b) => b.addEventListener('click', () => {
      const act = b.dataset.act;
      if (act === 'replace') {
        doReplace(b.dataset.sid, b.dataset.old, b.dataset.new);
        pushLog('bot', '<p class="badge ok" style="display:inline-block">Remplacement appliqué : ' + U.esc(b.dataset.lbl) + '</p>');
      } else if (act === 'balance') {
        let list = [];
        try { list = JSON.parse(b.dataset.transfers); } catch (_) { list = []; }
        list.forEach((tr) => doReplace(tr.sid, tr.from, tr.to));
        pushLog('bot', '<p class="badge ok" style="display:inline-block">' + list.length + ' transfert(s) appliqué(s) : ' + U.esc(b.dataset.lbl) + '</p>');
      }
      PE.save();
      PE.rerender();
    }));
  }

  PE.views.assistant = {
    render: render,
    _answer: function (q) { return answer(q); },
    _matchNames: function (qn, T) { return matchNames(norm(qn).replace(/\s+/g, ' ').trim(), T); }
  };
})();
