'use strict';
/* Options d'impression du rapport PDF (partagees par main.js et le test e2e).
   Le rapport est en A4 paysage : le tableau « Bilan par seance » a 8 colonnes,
   illisible en portrait. Le format vient du CSS (@page) -> preferCSSPageSize. */

const FOOTER =
  '<div style="width:100%;margin:0 10mm;padding-top:2mm;border-top:0.5px solid #cbd5e1;' +
  'font-family:\'Segoe UI\',Arial,sans-serif;font-size:8px;color:#6b7280;' +
  'display:flex;justify-content:space-between;">' +
  '<span>Rapport d\'affectation &mdash; Encadrement projet</span>' +
  '<span>Page <span class="pageNumber"></span> / <span class="totalPages"></span></span>' +
  '</div>';

const REPORT_PDF_OPTIONS = {
  printBackground: true,
  pageSize: 'A4',
  landscape: true,
  preferCSSPageSize: true,
  margins: { marginType: 'default' },
  displayHeaderFooter: true,
  headerTemplate: '<span></span>',
  footerTemplate: FOOTER
};

module.exports = { REPORT_PDF_OPTIONS };
