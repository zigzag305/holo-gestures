'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('linkpresentDesktop', {
  getStatus: () => ipcRenderer.invoke('desktop:status'),
  startVirtualCam: (opts) => ipcRenderer.invoke('desktop:vcam-start', opts || {}),
  stopVirtualCam: () => ipcRenderer.invoke('desktop:vcam-stop'),
  openMeetingSidebar: () => ipcRenderer.invoke('desktop:open-sidebar'),
  openLocalDeck: () => ipcRenderer.invoke('desktop:open-deck'),
});
