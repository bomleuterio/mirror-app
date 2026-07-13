document.addEventListener('DOMContentLoaded', () => {
  const $ = (id) => document.getElementById(id);

  const getApi = () => {
    if (window.electron && typeof window.electron.mirrorPpt === 'function' && typeof window.electron.mirrorPdf === 'function') {
      return window.electron;
    }
    if (typeof window.require === 'function') {
      try {
        const { ipcRenderer } = window.require('electron');
        return {
          mirrorPpt: (filePath) => ipcRenderer.invoke('mirror-ppt', filePath),
          mirrorPdf: (filePath) => ipcRenderer.invoke('mirror-pdf', filePath),
          pickPpt: () => ipcRenderer.invoke('pick-ppt'),
          pickPdf: () => ipcRenderer.invoke('pick-pdf'),
        };
      } catch {
        return null;
      }
    }
    return null;
  };

  const getLicenseApi = () => {
    if (window.electron && window.electron.license) return window.electron.license;
    if (typeof window.require === 'function') {
      try {
        const { ipcRenderer } = window.require('electron');
        return {
          check: () => ipcRenderer.invoke('license-check'),
          activate: (email, licenseKey) => ipcRenderer.invoke('license-activate', email, licenseKey),
          clear: () => ipcRenderer.invoke('license-clear'),
        };
      } catch {
        return null;
      }
    }
    return null;
  };

  function showLocked(message) {
    $('appMain').style.display = 'none';
    $('logoutLink').style.display = 'none';
    $('lockOverlay').style.display = 'flex';
    $('lockForm').style.display = 'block';
    $('lockSub').textContent = message || 'Sign in with your subscription to continue.';
  }

  function showUnlocked() {
    $('lockOverlay').style.display = 'none';
    $('appMain').style.display = 'flex';
    $('logoutLink').style.display = 'block';
  }

  async function checkLicense() {
    const licenseApi = getLicenseApi();
    if (!licenseApi) {
      showLocked('This app must be run inside the Electron app.');
      return;
    }
    $('lockSub').textContent = 'Checking your subscription…';
    $('lockForm').style.display = 'none';
    const result = await licenseApi.check();
    if (result && result.ok) {
      showUnlocked();
    } else {
      showLocked(result && result.message);
    }
  }

  const lockBtn = $('lockBtn');
  if (lockBtn) {
    lockBtn.addEventListener('click', async () => {
      const licenseApi = getLicenseApi();
      const email = $('lockEmail').value.trim();
      const key = $('lockKey').value.trim();
      clearErr('lockErr');
      if (!licenseApi) {
        showErr('lockErr', 'This app must be run inside the Electron app.');
        return;
      }
      if (!email || !key) {
        showErr('lockErr', 'Enter your email and license key.');
        return;
      }
      lockBtn.disabled = true;
      try {
        const result = await licenseApi.activate(email, key);
        if (result && result.ok) {
          showUnlocked();
        } else {
          showErr('lockErr', (result && result.message) || 'Activation failed.');
        }
      } finally {
        lockBtn.disabled = false;
      }
    });
  }

  const logoutLink = $('logoutLink');
  if (logoutLink) {
    logoutLink.addEventListener('click', async (e) => {
      e.preventDefault();
      const licenseApi = getLicenseApi();
      if (licenseApi) await licenseApi.clear();
      $('lockEmail').value = '';
      $('lockKey').value = '';
      showLocked('Signed out.');
    });
  }

  checkLicense();

  const getShell = () => {
    if (typeof window.require !== 'function') return null;
    try {
      const { shell } = window.require('electron');
      return shell || null;
    } catch {
      return null;
    }
  };

  const setP = (barId, lblId, pct, msg) => {
    $(barId).style.width = pct + '%';
    $(lblId).textContent = msg;
  };

  const showErr = (id, msg) => {
    $(id).textContent = msg;
    $(id).style.display = 'block';
  };

  const clearErr = (id) => {
    $(id).textContent = '';
    $(id).style.display = 'none';
  };

  const showBox = (id, msg) => {
    $(id).textContent = msg;
    $(id).style.display = 'block';
  };

  const hideBox = (id) => {
    $(id).textContent = '';
    $(id).style.display = 'none';
  };

  const basename = (filePath) => {
    const parts = String(filePath || '').split(/[\\/]/);
    return parts[parts.length - 1] || String(filePath || '');
  };

  function switchTab(t) {
    $('tabPdf').classList.toggle('active', t === 'pdf');
    $('tabPptx').classList.toggle('active', t === 'pptx');
    $('panelPdf').classList.toggle('active', t === 'pdf');
    $('panelPptx').classList.toggle('active', t === 'pptx');
  }

  $('tabPdf').addEventListener('click', () => switchTab('pdf'));
  $('tabPptx').addEventListener('click', () => switchTab('pptx'));

  let pdfPath = null;
  let pptxPath = null;

  function setPdfFilePath(p) {
    pdfPath = p || null;
    clearErr('pdfErr');
    hideBox('pdfOut');
    $('pdfProg').style.display = 'none';
    setP('pdfBar', 'pdfLbl', 0, '');

    if (!pdfPath) {
      hideBox('pdfName');
      $('pdfBtn').style.display = 'none';
      return;
    }

    showBox('pdfName', '📎 ' + basename(pdfPath));
    $('pdfBtn').style.display = 'block';
  }

  function setPptxFilePath(p) {
    pptxPath = p || null;
    clearErr('pptxErr');
    hideBox('pptxOut');
    $('pptxProg').style.display = 'none';
    setP('pptxBar', 'pptxLbl', 0, '');

    if (!pptxPath) {
      hideBox('pptxName');
      $('pptxBtn').style.display = 'none';
      return;
    }

    showBox('pptxName', '📎 ' + basename(pptxPath));
    $('pptxBtn').style.display = 'block';
  }

  function setupDrop(labelId, onPath) {
    const el = $(labelId);
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      el.style.borderColor = '#2d3adf';
    });
    el.addEventListener('dragleave', () => {
      el.style.borderColor = '';
    });
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.style.borderColor = '';
      const f = e.dataTransfer.files && e.dataTransfer.files[0] ? e.dataTransfer.files[0] : null;
      const p = f && f.path ? f.path : null;
      if (p) onPath(p);
    });
  }

  setupDrop('pdfLabel', setPdfFilePath);
  setupDrop('pptxLabel', setPptxFilePath);

  $('pdfLabel').addEventListener('click', async (e) => {
    e.preventDefault();
    const api = getApi();
    if (!api) {
      showErr('pdfErr', 'This UI must be run inside the Electron app.');
      return;
    }
    const picked = await api.pickPdf();
    if (picked) setPdfFilePath(picked);
  });

  $('pptxLabel').addEventListener('click', async (e) => {
    e.preventDefault();
    const api = getApi();
    if (!api) {
      showErr('pptxErr', 'This UI must be run inside the Electron app.');
      return;
    }
    const picked = await api.pickPpt();
    if (picked) setPptxFilePath(picked);
  });

  $('pdfInput').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0] ? e.target.files[0] : null;
    const p = f && f.path ? f.path : null;
    if (p) setPdfFilePath(p);
    e.target.value = '';
  });

  $('pptxInput').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0] ? e.target.files[0] : null;
    const p = f && f.path ? f.path : null;
    if (p) setPptxFilePath(p);
    e.target.value = '';
  });

  $('pdfBtn').addEventListener('click', async () => {
    const api = getApi();
    if (!api) {
      showErr('pdfErr', 'This UI must be run inside the Electron app.');
      return;
    }
    if (!pdfPath) {
      showErr('pdfErr', 'Please select a PDF file.');
      return;
    }

    clearErr('pdfErr');
    hideBox('pdfOut');
    $('pdfBtn').disabled = true;
    $('pdfProg').style.display = 'block';
    setP('pdfBar', 'pdfLbl', 10, 'Mirroring PDF...');
    try {
      const outPath = await api.mirrorPdf(pdfPath);
      setP('pdfBar', 'pdfLbl', 100, '✅ Done.');
      showBox('pdfOut', '✅ Saved to: ' + outPath);
      await openOutput(outPath, 'pdfErr');
    } catch (e) {
      const msg = e && e.message ? e.message : 'Failed.';
      showErr('pdfErr', 'Error: ' + msg);
      $('pdfProg').style.display = 'none';
    } finally {
      $('pdfBtn').disabled = false;
    }
  });

  $('pptxBtn').addEventListener('click', async () => {
    const api = getApi();
    if (!api) {
      showErr('pptxErr', 'This UI must be run inside the Electron app.');
      return;
    }
    if (!pptxPath) {
      showErr('pptxErr', 'Please select a PPTX file.');
      return;
    }

    clearErr('pptxErr');
    hideBox('pptxOut');
    $('pptxBtn').disabled = true;
    $('pptxProg').style.display = 'block';
    setP('pptxBar', 'pptxLbl', 10, 'Mirroring PPTX...');
    try {
      const outPath = await api.mirrorPpt(pptxPath);
      setP('pptxBar', 'pptxLbl', 100, '✅ Done.');
      showBox('pptxOut', '✅ Saved to: ' + outPath);
      await openOutput(outPath, 'pptxErr');
    } catch (e) {
      const msg = e && e.message ? e.message : 'Failed.';
      showErr('pptxErr', 'Error: ' + msg);
      $('pptxProg').style.display = 'none';
    } finally {
      $('pptxBtn').disabled = false;
    }
  });

  async function openOutput(filePath, errId) {
    const shell = getShell();
    if (!shell || !filePath) {
      showErr(errId, 'Unable to open output file.');
      return;
    }
    const err = await shell.openPath(filePath);
    if (err) shell.showItemInFolder(filePath);
  }
});
