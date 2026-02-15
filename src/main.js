/**
 * SoundFont Lab - Main entry point
 *
 * Handles file upload, SF2 parsing, bank tree display, and splitting.
 */

import { parseSF2, getSF2Summary } from './sf2-parser.js';
import { splitBanks, previewSplit } from './bank-splitter.js';

let currentSF2 = null;
let currentFileName = '';

// DOM refs
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const fileInfo = document.getElementById('file-info');
const bankView = document.getElementById('bank-view');
const bankTree = document.getElementById('bank-tree');
const splitAllBtn = document.getElementById('split-all-btn');
const statusSection = document.getElementById('status-section');
const statusMessage = document.getElementById('status-message');

// --- File handling ---

dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});

fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (file) handleFile(file);
});

async function handleFile(file) {
  if (!file.name.toLowerCase().endsWith('.sf2')) {
    showStatus('Please select an SF2 file.', 'error');
    return;
  }

  currentFileName = file.name.replace(/\.sf2$/i, '');
  showStatus('Parsing SF2 file...', 'info');

  try {
    const buffer = await file.arrayBuffer();
    currentSF2 = parseSF2(buffer);
    const summary = getSF2Summary(currentSF2);

    displayFileInfo(summary, file.size);
    displayBankTree(summary);

    bankView.classList.remove('hidden');
    statusSection.classList.add('hidden');
  } catch (err) {
    showStatus(`Error parsing SF2: ${err.message}`, 'error');
    console.error(err);
  }
}

function displayFileInfo(summary, fileSize) {
  const sizeMB = (fileSize / (1024 * 1024)).toFixed(2);
  fileInfo.innerHTML = `
    <strong>${summary.name}</strong> (${sizeMB} MB)<br>
    Version: ${summary.version} |
    Presets: ${summary.totalPresets} |
    Instruments: ${summary.totalInstruments} |
    Samples: ${summary.totalSamples}
    ${summary.author ? `<br>Author: ${summary.author}` : ''}
  `;
  fileInfo.classList.remove('hidden');
}

function displayBankTree(summary) {
  bankTree.innerHTML = '';

  const bankEntries = Object.entries(summary.banks);

  for (const [bankNum, presets] of bankEntries) {
    const group = document.createElement('div');
    group.className = 'bank-group';

    const header = document.createElement('div');
    header.className = 'bank-header';
    header.innerHTML = `
      <h3>Bank ${bankNum}</h3>
      <span class="preset-count">${presets.length} preset${presets.length !== 1 ? 's' : ''}</span>
    `;

    const list = document.createElement('ul');
    list.className = 'preset-list';

    for (const p of presets) {
      const li = document.createElement('li');
      li.innerHTML = `<span class="preset-num">${String(p.preset).padStart(3, '0')}</span> ${escapeHtml(p.name)}`;
      list.appendChild(li);
    }

    header.addEventListener('click', () => {
      list.classList.toggle('expanded');
    });

    group.appendChild(header);
    group.appendChild(list);
    bankTree.appendChild(group);
  }

  // Add individual bank download buttons
  if (bankEntries.length > 1) {
    splitAllBtn.textContent = `Split All ${bankEntries.length} Banks`;
    splitAllBtn.style.display = '';
  } else {
    splitAllBtn.style.display = 'none';
  }
}

// --- Splitting ---

splitAllBtn.addEventListener('click', () => {
  if (!currentSF2) return;

  showStatus('Splitting banks...', 'info');

  try {
    const bankFiles = splitBanks(currentSF2);

    for (const [bankNum, bankData] of bankFiles) {
      downloadBuffer(
        bankData.buffer,
        `${currentFileName}_bank${String(bankNum).padStart(3, '0')}.sf2`
      );
    }

    showStatus(`Split into ${bankFiles.size} bank file${bankFiles.size !== 1 ? 's' : ''}. Downloads started.`, 'success');
  } catch (err) {
    showStatus(`Error splitting: ${err.message}`, 'error');
    console.error(err);
  }
});

// --- Utilities ---

function downloadBuffer(buffer, filename) {
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function showStatus(msg, type = 'info') {
  statusSection.classList.remove('hidden');
  statusMessage.textContent = msg;
  statusMessage.style.borderLeft = `4px solid ${
    type === 'error' ? '#e94560' :
    type === 'success' ? '#4caf50' :
    '#0f3460'
  }`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
