'use strict';

/* Excel import for the Agendas tab : a downloadable template + a parser that
   turns a filled-in workbook into source rows. Plain Node module (exceljs). */

const ExcelJS = require('exceljs');

const HEADERS = [
  'Nom',
  'Projet ou encadrant',
  'Encadrement (total / partiel)',
  'Heures totales',
  'Heures encadrees',
  '% seances encadrees',
  'Adresse iCal 1',
  'Adresse iCal 2',
  'Adresse iCal 3'
];

async function buildTemplateBuffer() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Encadrement projet';
  wb.created = new Date();

  const ws = wb.addWorksheet('Agendas');
  ws.columns = HEADERS.map((h, i) => ({ header: h, key: 'c' + i, width: [28, 22, 28, 14, 16, 20, 42, 42, 42][i] }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F0FE' } };

  ws.addRow(['Projet Web S5', 'projet', 'partiel', 40, 28, '', 'https://exemple.fr/projet-web.ics']);
  ws.addRow(['Projet Mobile S5', 'projet', 'partiel', '', '', 70, 'https://exemple.fr/projet-mobile.ics']);
  ws.addRow(['Projet Data S5', 'projet', 'total', 32, 32, '', 'https://exemple.fr/projet-data.ics']);
  ws.addRow(['Dupont', 'encadrant', '', '', '', '', 'https://exemple.fr/dupont-perso.ics', 'https://exemple.fr/dupont-etab.ics']);
  ws.addRow(['Martin', 'encadrant', '', '', '', '', 'https://exemple.fr/martin.ics']);

  const notes = wb.addWorksheet('Notice');
  notes.getColumn(1).width = 32;
  notes.getColumn(2).width = 78;
  const rows = [
    ['Colonne', 'Valeur attendue'],
    ['Nom', 'Libre. Sert de cle : un nom deja present dans l\'application est mis a jour.'],
    ['Projet ou encadrant', '"projet" ou "encadrant" (aussi accepte : "enseignant").'],
    ['Encadrement (total / partiel)', 'Pour un projet : "total" (chaque seance encadree) ou "partiel". Vide = total. Ignore pour un encadrant.'],
    ['Heures totales', 'Nombre. Volume horaire total du projet (encadrement partiel, repartition "en heures").'],
    ['Heures encadrees', 'Nombre. Heures totales - Heures encadrees = heures cibles NON encadrees.'],
    ['% seances encadrees', 'Nombre 0-100. Alternative aux deux colonnes precedentes : si renseignee, la repartition est exprimee en pourcentage (ex. 70 = 70 % des heures encadrees).'],
    ['Adresse iCal 1 / 2 / 3', 'URL http(s) d\'un flux .ics. Un encadrant (ou un projet) peut avoir plusieurs agendas : laisser les colonnes inutilisees vides. D\'autres colonnes "Adresse iCal 4", etc. sont aussi reconnues. A l\'import, une adresse absente des agendas deja enregistres est ajoutee ; les agendas existants ne sont jamais retires.']
  ];
  rows.forEach((r) => notes.addRow(r));
  notes.getRow(1).font = { bold: true };

  return wb.xlsx.writeBuffer();
}

function norm(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const COLMAP = [
  { key: 'name', names: ['nom', 'name', 'intitule', 'libelle'] },
  { key: 'type', names: ['projet ou encadrant', 'type', 'projet encadrant', 'categorie', 'role'] },
  { key: 'supervision', names: ['encadrement total partiel', 'encadrement', 'supervision', 'encadrement total ou partiel', 'totalement encadre ou partiellement encadre', 'mode d encadrement'] },
  { key: 'totalHours', names: ['heures totales', 'heures totale', 'heures total', 'total heures', 'volume horaire'] },
  { key: 'supervisedHours', names: ['heures encadrees', 'heures encadree', 'heures d encadrement', 'heures encadrement'] },
  { key: 'supPercent', names: ['seances encadrees', 'pourcentage seances encadrees', 'pct seances encadrees', 'pourcentage encadrement', 'percent encadrees'] }
];

/* URL columns are handled separately from COLMAP because there can be
   several of them (one encadrant/projet can have multiple iCal feeds) :
   any header that is one of these root names, optionally followed by a
   number ("Adresse iCal 1", "Adresse iCal 2", "iCal 4"...), counts as a
   URL column, in the order they appear in the sheet. */
const URL_ROOTS = ['adresse ical', 'ical', 'url', 'adresse', 'lien ical', 'flux ical', 'lien'];
function isUrlHeader(n) {
  const m = n.match(/^(.*?)\s*(\d+)$/);
  const base = m ? m[1].trim() : n;
  return URL_ROOTS.indexOf(base) !== -1;
}

function cellText(v) {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v instanceof Date) return v.toISOString();
    if (v.text != null) return String(v.text);
    if (v.hyperlink != null) return String(v.hyperlink);
    if (v.result != null) return String(v.result);
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    return '';
  }
  return String(v);
}

async function parseWorkbook(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets.find((w) => norm(w.name) !== 'notice') || wb.worksheets[0];
  if (!ws) return { ok: false, error: 'Aucune feuille dans le fichier.' };

  let headerRowIdx = -1;
  let colIndex = {};
  let urlCols = [];
  const maxScan = Math.min(ws.rowCount || 1, 15);
  for (let r = 1; r <= maxScan; r++) {
    const map = {};
    const urls = [];
    ws.getRow(r).eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const n = norm(cellText(cell.value));
      COLMAP.forEach((cm) => { if (map[cm.key] == null && cm.names.indexOf(n) !== -1) map[cm.key] = colNumber; });
      if (isUrlHeader(n)) urls.push(colNumber);
    });
    if (map.name != null || urls.length) { headerRowIdx = r; colIndex = map; urlCols = urls.sort((a, b) => a - b); break; }
  }
  if (headerRowIdx === -1) {
    return { ok: false, error: 'En-tetes non reconnus. Utilisez le modele (colonnes Nom, Projet ou encadrant, Adresse iCal 1, ...).' };
  }

  const num = (raw) => {
    const x = parseFloat(String(raw).replace(/\s/g, '').replace(',', '.'));
    return isNaN(x) ? null : x;
  };

  const rows = [];
  const last = ws.rowCount || headerRowIdx;
  for (let r = headerRowIdx + 1; r <= last; r++) {
    const row = ws.getRow(r);
    const get = (k) => (colIndex[k] != null ? cellText(row.getCell(colIndex[k]).value).trim() : '');
    const urls = [];
    urlCols.forEach((c) => {
      const v = cellText(row.getCell(c).value).trim();
      if (v && urls.indexOf(v) === -1) urls.push(v);
    });
    const name = get('name');
    if (!name && !urls.length) continue;

    const typeN = norm(get('type'));
    const type = /proj/.test(typeN) ? 'project' : (/(encadr|ens|prof|teacher)/.test(typeN) ? 'teacher' : '');
    const supervision = /part/.test(norm(get('supervision'))) ? 'partial' : 'full';
    const totalHours = num(get('totalHours'));
    const supervisedHours = num(get('supervisedHours'));
    let supPercent = num(get('supPercent'));
    if (supPercent != null) supPercent = Math.max(0, Math.min(100, supPercent));
    const supMode = supPercent != null ? 'percent' : 'hours';

    const warnings = [];
    if (!name) warnings.push('nom manquant');
    if (!type) warnings.push('type non reconnu — mettre "projet" ou "encadrant"');
    urls.forEach((u) => { if (!/^https?:\/\//i.test(u)) warnings.push('adresse iCal sans http(s) : ' + u); });
    if (type === 'project' && supervision === 'partial' && supMode === 'hours' &&
        totalHours != null && supervisedHours != null && supervisedHours > totalHours) {
      warnings.push('heures encadrees > heures totales');
    }

    rows.push({
      row: r,
      name: name,
      type: type || 'project',
      supervision: supervision,
      supMode: supMode,
      supPercent: supPercent,
      totalHours: totalHours,
      supervisedHours: supervisedHours,
      urls: urls,
      warnings: warnings
    });
  }

  return { ok: true, headerRow: headerRowIdx, rows: rows };
}

module.exports = { HEADERS, buildTemplateBuffer, parseWorkbook };
