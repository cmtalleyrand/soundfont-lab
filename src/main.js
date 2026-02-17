/**
 * SoundFont Lab - Main entry point
 *
 * Handles file upload, SF2 parsing, bank tree display, and splitting.
 */

import { parseSF2, getSF2Summary } from './sf2-parser.js';
import { splitBanks } from './bank-splitter.js';
import { parseNotationInput } from './notation.js';

let currentSF2 = null;
let currentFileName = '';

// DOM refs
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const fileInfo = document.getElementById('file-info');
const bankView = document.getElementById('bank-view');
const bankTableBody = document.getElementById('bank-table-body');
const splitAllBtn = document.getElementById('split-all-btn');
const statusSection = document.getElementById('status-section');
const statusMessage = document.getElementById('status-message');

const notationForm = document.getElementById('notation-form');
const notationMode = document.getElementById('notation-mode');
const notationL = document.getElementById('notation-l');
const notationM = document.getElementById('notation-m');
const notationK = document.getElementById('notation-k');
const notationInput = document.getElementById('notation-input');
const notationResult = document.getElementById('notation-result');
const notationResultBody = document.getElementById('notation-result-body');

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
    displayBankTable(summary);

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
    <h3>SoundFont Details</h3>
    <table class="meta-table">
      <tbody>
        <tr><th>Name</th><td>${escapeHtml(summary.name)}</td></tr>
        <tr><th>File size</th><td>${sizeMB} MB</td></tr>
        <tr><th>Version</th><td>${escapeHtml(summary.version)}</td></tr>
        <tr><th>Presets</th><td>${summary.totalPresets}</td></tr>
        <tr><th>Instruments</th><td>${summary.totalInstruments}</td></tr>
        <tr><th>Samples</th><td>${summary.totalSamples}</td></tr>
        <tr><th>Author</th><td>${escapeHtml(summary.author || '—')}</td></tr>
        <tr><th>Engine</th><td>${escapeHtml(summary.engine || '—')}</td></tr>
        <tr><th>Comment</th><td>${escapeHtml(summary.comment || '—')}</td></tr>
      </tbody>
    </table>
  `;

  fileInfo.classList.remove('hidden');
}

function displayBankTable(summary) {
  bankTableBody.innerHTML = '';

  const bankEntries = Object.entries(summary.banks);

  for (const [bankNum, presets] of bankEntries) {
    for (const p of presets) {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${bankNum}</td>
        <td><span class="preset-badge">${String(p.preset).padStart(3, '0')}</span></td>
        <td>${escapeHtml(p.name)}</td>
        <td>${presets.length}</td>
      `;
      bankTableBody.appendChild(row);
    }
  }

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

// --- Notation ---

notationForm.addEventListener('submit', (e) => {
  e.preventDefault();
  notationResultBody.innerHTML = '';

  try {
    const rows = parseNotationInput({
      input: notationInput.value,
      mode: notationMode.value,
      key: notationK.value.trim(),
      meter: notationM.value,
      length: notationL.value,
    });

    for (const row of rows) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(row.raw)}</td>
        <td>${escapeHtml(row.mode)}</td>
        <td>${escapeHtml(row.pitchClass)}</td>
        <td>${row.octave}</td>
        <td>${escapeHtml(row.duration)}</td>
        <td><code>${escapeHtml(row.abc)}</code></td>
        <td>${escapeHtml(row.keyContext)}</td>
      `;
      notationResultBody.appendChild(tr);
    }

    notationResult.classList.remove('hidden');
    showStatus(`Parsed ${rows.length} note token${rows.length === 1 ? '' : 's'} with L:${notationL.value}, M:${notationM.value}, K:${notationK.value}.`, 'success');
  } catch (err) {
    showStatus(`Notation parse error: ${err.message}`, 'error');
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
