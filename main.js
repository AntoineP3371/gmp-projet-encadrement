'use strict';

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { fetchText, parseICS } = require('./lib/ical');
const { buildTemplateBuffer, parseWorkbook } = require('./lib/xlsx');

const APP_NAME = 'Encadrement projet';
app.setName(APP_NAME);

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    title: APP_NAME,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  if (process.argv.includes('--smoke')) {
    try {
      require('./scripts/smoke-e2e').attach(win, { app: app, BrowserWindow: BrowserWindow });
    } catch (err) {
      console.log('smoke-e2e unavailable: ' + ((err && err.message) || err));
    }
  }
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

/* ------------------------------------------------------------------ */
/* iCal : telechargement (cote Node, donc pas de blocage CORS) + parse */
/* ------------------------------------------------------------------ */

ipcMain.handle('ical:load', async (_e, { url, text, rangeStart, rangeEnd }) => {
  try {
    const raw = (text != null && text !== '') ? text : await fetchText(url);
    const events = parseICS(raw, rangeStart, rangeEnd);
    return { ok: true, events, count: events.length };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

/* ------------------------------------------------------------------ */
/* Persistance du projet                                               */
/* ------------------------------------------------------------------ */

const projectPath = path.join(app.getPath('userData'), 'project.json');

ipcMain.handle('project:load', async () => {
  try {
    if (!fs.existsSync(projectPath)) return { ok: true, data: null };
    return { ok: true, data: JSON.parse(fs.readFileSync(projectPath, 'utf8')) };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

ipcMain.handle('project:save', async (_e, data) => {
  try {
    fs.writeFileSync(projectPath, JSON.stringify(data, null, 2), 'utf8');
    return { ok: true, path: projectPath };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

ipcMain.handle('project:export', async (_e, data) => {
  const r = await dialog.showSaveDialog(win, {
    title: 'Exporter le projet',
    defaultPath: 'projet-encadrement.json',
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  try {
    fs.writeFileSync(r.filePath, JSON.stringify(data, null, 2), 'utf8');
    return { ok: true, filePath: r.filePath };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

ipcMain.handle('project:import', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Importer un projet',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
  try {
    return { ok: true, data: JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')) };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

ipcMain.handle('pdf:save', async (_e, { html, defaultName }) => {
  const r = await dialog.showSaveDialog(win, {
    title: 'Rapport PDF',
    defaultPath: defaultName || 'rapport-affectation.pdf',
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };

  const tmp = path.join(app.getPath('temp'), 'projet-encadrement-report-' + Date.now() + '.html');
  let pdfWin = null;
  try {
    fs.writeFileSync(tmp, html, 'utf8');
    pdfWin = new BrowserWindow({ show: false, webPreferences: { javascript: false } });
    await pdfWin.loadFile(tmp);
    await new Promise((res) => setTimeout(res, 200));
    const buf = await pdfWin.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { marginType: 'default' }
    });
    fs.writeFileSync(r.filePath, buf);
    return { ok: true, filePath: r.filePath };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  } finally {
    if (pdfWin) pdfWin.destroy();
    try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
  }
});

ipcMain.handle('xlsx:template', async () => {
  const r = await dialog.showSaveDialog(win, {
    title: 'Modele d\'import des agendas',
    defaultPath: 'modele-agendas.xlsx',
    filters: [{ name: 'Classeur Excel', extensions: ['xlsx'] }]
  });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  try {
    const buf = await buildTemplateBuffer();
    fs.writeFileSync(r.filePath, Buffer.from(buf));
    return { ok: true, filePath: r.filePath };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

ipcMain.handle('xlsx:import', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Importer un tableau d\'agendas',
    properties: ['openFile'],
    filters: [{ name: 'Classeur Excel', extensions: ['xlsx', 'xlsm'] }]
  });
  if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
  try {
    return await parseWorkbook(r.filePaths[0]);
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

ipcMain.handle('file:saveText', async (_e, { defaultName, content }) => {
  const r = await dialog.showSaveDialog(win, { title: 'Enregistrer', defaultPath: defaultName || 'export.txt' });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  try {
    fs.writeFileSync(r.filePath, content, 'utf8');
    return { ok: true, filePath: r.filePath };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});
