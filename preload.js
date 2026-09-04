'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadIcal: (opts) => ipcRenderer.invoke('ical:load', opts),
  downloadTemplate: () => ipcRenderer.invoke('xlsx:template'),
  importXlsx: () => ipcRenderer.invoke('xlsx:import'),
  savePdf: (opts) => ipcRenderer.invoke('pdf:save', opts),
  loadProject: () => ipcRenderer.invoke('project:load'),
  saveProject: (data) => ipcRenderer.invoke('project:save', data),
  exportProject: (data) => ipcRenderer.invoke('project:export', data),
  importProject: () => ipcRenderer.invoke('project:import'),
  saveText: (opts) => ipcRenderer.invoke('file:saveText', opts)
});
