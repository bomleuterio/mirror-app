const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const license = require('./license');

function createWindow () {
  console.log('Creating main window...');
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  mainWindow.loadFile('index.html');
  console.log('Loaded index.html');

  // Open the DevTools.
  // mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
  console.log('App is ready.');
  createWindow();

  app.on('activate', function () {
    console.log('App activated.');
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  console.log('All windows closed.');
  if (process.platform !== 'darwin') app.quit();
});

app.on('quit', () => {
  console.log('App is quitting.');
});

ipcMain.handle('mirror-ppt', async (event, inputPath) => {
  try {
    const { mirrorPptx } = require('./ppt-mirror');
    const outputPath = path.join(path.dirname(inputPath), `mirrored_${path.basename(inputPath)}`);
    await mirrorPptx(inputPath, outputPath);
    return outputPath;
  } catch (error) {
    console.error('Failed to mirror PPTX:', error);
    throw new Error(error && error.message ? error.message : 'Failed to mirror PowerPoint file.');
  }
});

ipcMain.handle('mirror-pdf', async (event, inputPath) => {
  try {
    const { mirrorPdf } = require('./pdf-mirror');
    const outputPath = path.join(path.dirname(inputPath), `mirrored_${path.basename(inputPath)}`);
    await mirrorPdf(inputPath, outputPath);
    return outputPath;
  } catch (error) {
    console.error('Failed to mirror PDF:', error);
    throw new Error(error && error.message ? error.message : 'Failed to mirror PDF file.');
  }
});

ipcMain.handle('pick-ppt', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'PowerPoint', extensions: ['pptx'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('license-check', async () => {
  try {
    return await license.validateLicense();
  } catch (error) {
    console.error('License check failed:', error);
    return { ok: false, needsLogin: true, error: 'unexpected', message: 'Something went wrong checking your license.' };
  }
});

ipcMain.handle('license-activate', async (event, email, licenseKey) => {
  try {
    return await license.activateLicense({ email, licenseKey });
  } catch (error) {
    console.error('License activation failed:', error);
    return { ok: false, needsLogin: true, error: 'unexpected', message: 'Something went wrong activating your license.' };
  }
});

ipcMain.handle('license-clear', async () => {
  try {
    return await license.clearLicense();
  } catch (error) {
    console.error('License clear failed:', error);
    return { ok: true };
  }
});

ipcMain.handle('pick-pdf', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});
