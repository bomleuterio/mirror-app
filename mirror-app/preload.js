const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  mirrorPpt: (filePath) => ipcRenderer.invoke('mirror-ppt', filePath),
  mirrorPdf: (filePath) => ipcRenderer.invoke('mirror-pdf', filePath),
  pickPpt: () => ipcRenderer.invoke('pick-ppt'),
  pickPdf: () => ipcRenderer.invoke('pick-pdf'),
});

window.addEventListener('DOMContentLoaded', () => {
  const replaceText = (selector, text) => {
    const element = document.getElementById(selector)
    if (element) element.innerText = text
  }

  for (const type of ['chrome', 'node', 'electron']) {
    replaceText(`${type}-version`, process.versions[type])
  }
})
