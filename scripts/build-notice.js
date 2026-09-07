'use strict';

/* Renders docs/notice.html -> docs/notice.pdf via a headless Chromium
   (Electron), so the print CSS in notice.html is honoured exactly.
   Run: npm run notice   (i.e. `electron scripts/build-notice.js`) */

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'docs', 'notice.html');
const OUT = path.join(ROOT, 'docs', 'notice.pdf');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { javascript: false } });
  try {
    await win.loadFile(SRC);
    await new Promise((r) => setTimeout(r, 400)); // let images lay out
    const foot =
      '<div style="width:100%;margin:0 17mm;padding-top:2.5mm;border-top:0.5px solid #dee2ea;' +
      'font-family:\'Segoe UI\',Arial,sans-serif;font-size:7px;color:#8a93a2;' +
      'display:flex;justify-content:space-between;">' +
      '<span>Encadrement projet — Notice d\'utilisation</span>' +
      '<span>Page <span class="pageNumber"></span> / <span class="totalPages"></span></span>' +
      '</div>';
    const buf = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { marginType: 'default' },
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: foot
    });
    fs.writeFileSync(OUT, buf);
    const kb = (buf.length / 1024).toFixed(0);
    console.log('wrote ' + path.relative(ROOT, OUT) + ' (' + kb + ' KB, ' +
      (buf.slice(0, 5).toString('latin1') === '%PDF-' ? 'valid PDF' : 'NOT a PDF') + ')');
    app.exit(0);
  } catch (err) {
    console.error('notice build failed: ' + ((err && err.stack) || err));
    app.exit(1);
  } finally {
    win.destroy();
  }
});
