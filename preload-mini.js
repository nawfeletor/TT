const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('MINI', {
  playpause:  () => ipcRenderer.send('mini-playpause'),
  next:       () => ipcRenderer.send('mini-next'),
  prev:       () => ipcRenderer.send('mini-prev'),
  close:      () => ipcRenderer.send('mini-close'),
  showMain:   () => ipcRenderer.send('mini-show-main'),
  onUpdate:   (cb) => ipcRenderer.on('mini-track-update', (_, d) => cb(d)),
})
