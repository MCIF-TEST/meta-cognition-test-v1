// ui.js — MCIF 7.1 Lucid Flow UI Module (ES module)
// Exports: initUI, setPhase, renderPrompt, getResponse, clearResponse, showMirror, showScores,
//          showFollowups, renderReport, openLedgerModal, closeLedgerModal, toggleDevConsole
//
// Usage (example):
// import * as MCIFUI from './ui.js';
// MCIFUI.initUI({
//   onStart: (cfg) => {...},
//   onSubmitResponse: async (responseObj) => {...},
//   onFollowupClick: (followup) => {...},
//   onExport: () => {...}
// });
// Then call MCIFUI.renderPrompt(phaseNum, promptObj).
//
// This file intentionally separates UI concerns from application logic — app.js supplies callbacks.

const rootSelector = document; // root DOM context

// DOM id/config map (match index.html)
const IDs = {
  splash: 'splash',
  consent: 'consent',
  selectTier: 'select-tier',
  inputUsername: 'input-username',
  btnStart: 'btn-start',
  btnDemo: 'btn-demo',
  sessionScreen: 'session-screen',
  stageTitle: 'stage-title',
  stageHint: 'stage-hint',
  responseInput: 'response-input',
  btnSubmitResponse: 'btn-submit-response',
  btnSkip: 'btn-skip',
  btnVoice: 'btn-voice',
  mirror: 'mirror',
  domainScores: 'domain-scores',
  followups: 'followups',
  phaseList: 'phase-list',
  sessionProgress: 'session-progress',
  sessionPhaseIndex: 'session-phase-index',
  ledgerDialog: 'ledger-dialog',
  ledgerEntries: 'ledger-entries',
  btnLedger: 'btn-ledger',
  btnEthics: 'btn-ethics',
  ethicsDialog: 'ethics-dialog',
  btnEthicalAccept: 'btn-ethical-accept',
  devConsole: 'dev-console',
  devLog: 'dev-log',
  btnDevToggle: 'btn-dev-toggle',
  reportScreen: 'report-screen',
  reportSummary: 'report-summary',
  vectorVisual: 'vector-visual',
  coherenceWave: 'coherence-wave',
  btnExportJson: 'btn-export-json',
  btnPauseSession: 'btn-pause-session',
  btnReturn: 'btn-return'
};

let callbacks = {}; // app-provided callbacks
let currentPhase = 1;
let totalPhases = 6;
let phaseNames = [
  'Perceptual Awareness',
  'Cognitive Mechanics',
  'Emotive Intelligence',
  'Meta-Cognitive Insight',
  'Creative Intelligence',
  'Philosophical Depth'
];

// Voice recognition state
let speechRecognizer = null;
let voiceActive = false;

// Developer console buffer
let devBuffer = [];

/* ===== Utility helpers ===== */
function $(id) {
  return document.getElementById(id);
}
function el(tag = 'div', attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([k, v]) => {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  });
  (Array.isArray(children) ? children : [children]).forEach(c => {
    if (!c) return;
    if (typeof c === 'string') node.appendChild(document.createTextNode(c));
    else node.appendChild(c);
  });
  return node;
}

function focusAndScroll(elm) {
  try {
    elm.focus();
    elm.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (e) {}
}

function applyPhaseClass(phaseNum) {
  const body = document.body;
  // remove old
  for (let i = 1; i <= totalPhases; i++) body.classList.remove(`phase-${i}`);
  body.classList.add(`phase-${phaseNum}`);
}

/* ===== Public API Implementation ===== */

/**
 * Initialize UI and wire DOM events. Accepts callbacks object:
 * {
 *   onStart: (cfg) => Promise,
 *   onSubmitResponse: (responseObj) => Promise,
 *   onFollowupClick: (followup) => Promise,
 *   onExport: () => Promise,
 *   onPause: () => Promise,
 *   onSkip: () => Promise
 * }
 */
export function initUI(cb = {}) {
  callbacks = cb || {};

  // Attach essential DOM references
  // Start button enablement based on consent
  const consent = $(IDs.consent);
  const btnStart = $(IDs.btnStart);
  if (consent && btnStart) {
    consent.addEventListener('change', () => {
      btnStart.disabled = !consent.checked;
    });
  }

  if (btnStart) {
    btnStart.addEventListener('click', async () => {
      // assemble session config
      const cfg = {
        tier: $(IDs.selectTier)?.value || 'Explorer',
        username: $(IDs.inputUsername)?.value || null
      };
      // call back to app
      if (typeof callbacks.onStart === 'function') {
        try {
          await callbacks.onStart(cfg);
        } catch (e) {
          logDev('onStart error: ' + e);
        }
      }
    });
  }

  // Demo button (if provided)
  const btnDemo = $(IDs.btnDemo);
  if (btnDemo) {
    btnDemo.addEventListener('click', async () => {
      if (typeof callbacks.onDemo === 'function') await callbacks.onDemo();
    });
  }

  // Submit response
  const btnSubmit = $(IDs.btnSubmitResponse);
  if (btnSubmit) {
    btnSubmit.addEventListener('click', async () => {
      await handleSubmitResponse();
    });
  }

  // Skip
  const btnSkip = $(IDs.btnSkip);
  if (btnSkip) {
    btnSkip.addEventListener('click', async () => {
      if (typeof callbacks.onSkip === 'function') await callbacks.onSkip(currentPhase);
    });
  }

  // Voice input
  const btnVoice = $(IDs.btnVoice);
  if (btnVoice) {
    btnVoice.addEventListener('click', toggleVoice);
  }

  // Ledger & ethics
  const btnLedger = $(IDs.btnLedger);
  if (btnLedger) btnLedger.addEventListener('click', openLedgerDialog);
  const ledgerDialog = $(IDs.ledgerDialog);
  if (ledgerDialog) {
    // close button inside dialog handled by native dialog close (in index.html)
    ledgerDialog.addEventListener('close', () => {
      // nothing yet
    });
  }
  const btnEthics = $(IDs.btnEthics);
  if (btnEthics) btnEthics.addEventListener('click', openEthicsDialog);
  const ethicsDialog = $(IDs.ethicsDialog);
  if (ethicsDialog) {
    const accept = $(IDs.btnEthicalAccept);
    if (accept) accept.addEventListener('click', () => {
      try { ethicsDialog.close(); } catch (e) {}
    });
  }

  // Developer console toggle
  const btnDevToggle = $(IDs.btnDevToggle);
  if (btnDevToggle) btnDevToggle.addEventListener('click', toggleDevConsole);
  // export session
  const btnExport = $(IDs.btnExportJson);
  if (btnExport) btnExport.addEventListener('click', async () => {
    if (typeof callbacks.onExport === 'function') await callbacks.onExport();
  });

  // return button
  const btnReturn = $(IDs.btnReturn);
  if (btnReturn) btnReturn.addEventListener('click', () => {
    location.reload();
  });

  // Pause
  const btnPause = $(IDs.btnPauseSession);
  if (btnPause) btnPause.addEventListener('click', async () => {
    if (typeof callbacks.onPause === 'function') await callbacks.onPause();
  });

  // keyboard: submit on Ctrl+Enter
  const responseInput = $(IDs.responseInput);
  if (responseInput) {
    responseInput.addEventListener('keydown', async (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
        ev.preventDefault();
        await handleSubmitResponse();
      }
    });
  }

  // enable accessible skip link
  const skip = document.getElementById('skiplink');
  if (skip) skip.addEventListener('click', (e) => { e.preventDefault(); $(IDs.responseInput)?.focus(); });

  // render initial phase list
  renderPhaseList();

  logDev('UI initialized');
}

/* ===== Core Renderers ===== */

/**
 * renderPhaseList() - creates the left-side phase tracker and marks current phase
 */
export function renderPhaseList(active = 1, total = 6) {
  const container = $(IDs.phaseList);
  if (!container) return;
  container.innerHTML = '';
  for (let i = 1; i <= total; i++) {
    const item = el('div', { class: 'phase-item' + (i === active ? ' active' : ''), role: 'button', tabindex: 0 });
    const dot = el('div', { class: 'dot', 'aria-hidden': true });
    const label = el('div', { class: 'phase-label', text: `${i}. ${phaseNames[i - 1] || 'Phase ' + i}` });
    item.appendChild(dot);
    item.appendChild(label);
    // clicking a phase attempts to jump only if callback supports it
    item.addEventListener('click', () => {
      if (typeof callbacks.onPhaseJump === 'function') callbacks.onPhaseJump(i);
    });
    container.appendChild(item);
  }
  // update progress element
  $(IDs.sessionPhaseIndex) && ($(IDs.sessionPhaseIndex).textContent = String(active));
  const prog = $(IDs.sessionProgress);
  if (prog) prog.value = active;
}

/**
 * setPhase() - apply body class, update tracker, and set local state
 */
export function setPhase(phaseNum) {
  currentPhase = phaseNum;
  renderPhaseList(currentPhase, totalPhases);
  applyPhaseClass(phaseNum);
  // update any ARIA live info
  const stageTitle = $(IDs.stageTitle);
  if (stageTitle) stageTitle.setAttribute('aria-live', 'polite');
  logDev(`setPhase: ${phaseNum}`);
}

/**
 * renderPrompt() - injects prompt text & metadata, focuses input
 * promptObj shape: { id, phaseId, text, metadata: { expected_length_tokens } }
 */
export function renderPrompt(phaseNum, promptObj = {}) {
  currentPhase = phaseNum || (promptObj.phaseId || 1);
  setPhase(currentPhase);
  const title = $(IDs.stageTitle);
  const hint = $(IDs.stageHint);
  if (title) title.textContent = (promptObj && promptObj.text) || '…';
  if (hint) hint.textContent = (promptObj && promptObj.hint) || 'Reflect, then submit — mirror feedback will appear first.';
  // show metadata (expected length)
  const badge = document.querySelector('.badge') || null;
  if (badge) badge.textContent = `Phase ${currentPhase} • ${phaseNames[currentPhase - 1] || ''}`;
  // reset mirror + scores + followups
  showMirror('');
  showScores({});
  showFollowups([]);
  clearResponse();
  focusAndScroll($(IDs.responseInput));
  logDev(`renderPrompt phase=${currentPhase} promptId=${promptObj.id || 'n/a'}`);
}

/**
 * getResponse() - returns the string content of the response input (trimmed)
 */
export function getResponse() {
  const elInput = $(IDs.responseInput);
  if (!elInput) return '';
  return (elInput.value || '').trim();
}

/**
 * clearResponse()
 */
export function clearResponse() {
  const elInput = $(IDs.responseInput);
  if (elInput) {
    elInput.value = '';
    try { elInput.style.height = ''; } catch (e) {}
  }
}

/**
 * showMirror(text) - shows mirror explanation (1-3 sentences) and animates
 */
export function showMirror(text) {
  const mirror = $(IDs.mirror);
  if (!mirror) return;
  mirror.textContent = text || '';
  mirror.classList.add('mirror-flash');
  // animate via CSS keyframes (style.css) by toggling class
  setTimeout(() => mirror.classList.remove('mirror-flash'), 1200);
  logDev('mirror:' + (text || '').slice(0, 140));
}

/**
 * showScores(domainScores) - domainScores is an object {domainName: value}
 */
export function showScores(domainScores = {}) {
  const container = $(IDs.domainScores);
  if (!container) return;
  container.innerHTML = '';
  Object.keys(domainScores).forEach(k => {
    const v = domainScores[k];
    const pill = el('div', { class: 'domain-pill', text: `${k}: ${Number(v).toFixed(2)}` });
    container.appendChild(pill);
  });
}

/**
 * showFollowups(array) - each followup { id, text, trigger }
 * renders as clickable small buttons and raises a custom event 'mcif:followup' on click
 */
export function showFollowups(list = []) {
  const container = $(IDs.followups);
  if (!container) return;
  container.innerHTML = '';
  if (!Array.isArray(list) || list.length === 0) return;
  list.forEach(f => {
    const b = el('button', { class: 'btn small', text: f.text });
    b.addEventListener('click', async () => {
      // local UI response: show followup text into input if it's a probe, or raise callback
      if (typeof callbacks.onFollowupClick === 'function') {
        await callbacks.onFollowupClick(f);
      }
    });
    container.appendChild(b);
  });
}

/* ===== Report & Visualizations ===== */

/**
 * renderReport(report) - report is expected to include:
 * { compositeScore, domainScores (object), tier, coherenceWaveform: [{t, amplitude}], insightSummary, archetype }
 */
export function renderReport(report = {}) {
  // show summary
  const summary = $(IDs.reportSummary);
  if (summary) {
    summary.innerHTML = `
      <div><strong>Composite score:</strong> ${report.compositeScore || '—'}</div>
      <div><strong>Tier:</strong> ${report.tier || '—'}</div>
      <div><strong>Archetype:</strong> ${report.archetype ? report.archetype.name : '—'}</div>
      <div style="color:var(--muted);margin-top:8px">${report.insightSummary || ''}</div>
    `;
  }

  // small radar/vector in vector-visual
  drawVectorMap(report.domainScores || {});

  // draw waveform
  drawWaveform(report.coherenceWaveform || []);
  logDev('report rendered');
}

/* Draw a simple radial vector map into #vector-visual */
function drawVectorMap(domainScores = {}) {
  const container = $(IDs.vectorVisual) || $(IDs.vectorVisual.toLowerCase()) || null;
  if (!container) return;
  container.innerHTML = '';
  const keys = Object.keys(domainScores);
  if (keys.length === 0) {
    container.innerHTML = '<div style="color:var(--muted)">No domain scores available.</div>';
    return;
  }
  const w = Math.min(container.clientWidth || 480, 560);
  const h = 320;
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(cx, cy) - 24;
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('width', w);
  svg.setAttribute('height', h);
  // background rings
  for (let i = 4; i >= 1; i--) {
    const ring = document.createElementNS(svgNS, 'circle');
    ring.setAttribute('cx', cx);
    ring.setAttribute('cy', cy);
    ring.setAttribute('r', (r / 4) * i);
    ring.setAttribute('fill', 'none');
    ring.setAttribute('stroke', 'rgba(255,255,255,0.02)');
    ring.setAttribute('stroke-width', '1');
    svg.appendChild(ring);
  }
  // polygon
  const points = [];
  keys.forEach((k, i) => {
    const angle = (i / keys.length) * Math.PI * 2 - Math.PI / 2;
    const val = Math.max(0, Math.min(1, (domainScores[k] || 0) / 100));
    const px = cx + Math.cos(angle) * r * val;
    const py = cy + Math.sin(angle) * r * val;
    points.push(`${px},${py}`);
    // labels
    const lx = cx + Math.cos(angle) * (r + 12);
    const ly = cy + Math.sin(angle) * (r + 12);
    const text = document.createElementNS(svgNS, 'text');
    text.setAttribute('x', lx);
    text.setAttribute('y', ly);
    text.setAttribute('font-size', '11');
    text.setAttribute('fill', '#cfeff2');
    text.textContent = k;
    svg.appendChild(text);
  });
  const poly = document.createElementNS(svgNS,'polygon');
  poly.setAttribute('points', points.join(' '));
  poly.setAttribute('fill','rgba(110,231,183,0.12)');
  poly.setAttribute('stroke','rgba(110,231,183,0.45)');
  poly.setAttribute('stroke-width','2');
  svg.appendChild(poly);
  container.appendChild(svg);
}

/* Draw waveform on canvas */
function drawWaveform(points = []) {
  const canvas = $(IDs.coherenceWave);
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width = canvas.clientWidth || 900;
  const h = canvas.height = canvas.clientHeight || 140;
  ctx.clearRect(0, 0, w, h);
  if (!Array.isArray(points) || points.length === 0) {
    // subtle background
    ctx.fillStyle = 'rgba(255,255,255,0.02)';
    ctx.fillRect(0, 0, w, h);
    return;
  }
  // normalize times
  const ts = points.map(p => p.t);
  const minT = Math.min(...ts);
  const maxT = Math.max(...ts);
  const denom = maxT - minT || 1;
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = ((p.t - minT) / denom) * w;
    const y = h - (p.amplitude * h);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = 'rgba(110,231,183,0.95)';
  ctx.lineWidth = 2.5;
  ctx.stroke();
}

/* ===== Ledger modal ===== */

export function openLedgerModal(entries = []) {
  const dialog = $(IDs.ledgerDialog);
  const list = $(IDs.ledgerEntries);
  if (!dialog || !list) return;
  list.innerHTML = '';
  (entries || []).forEach(e => {
    const wrap = el('div', { class: 'ledger-entry' });
    wrap.innerHTML = `
      <div style="font-size:12px;color:var(--muted)">${new Date(e.timestamp).toLocaleString()}</div>
      <div style="font-weight:700;margin-top:6px">${e.action} — ${e.payloadSummary || ''}</div>
      <div style="font-size:12px;color:var(--muted);margin-top:6px">${e.rationale || ''}</div>
      <div style="font-size:11px;color:rgba(255,255,255,0.06);margin-top:6px">hash: ${e.hash || '—'}</div>
    `;
    list.appendChild(wrap);
  });
  try { dialog.showModal(); } catch (e) { dialog.open = true; }
}

/* Close ledger dialog - index.html provides close button with dialog.close() automatically */

/* ===== Developer console ===== */

export function toggleDevConsole() {
  const el = $(IDs.devConsole);
  if (!el) return;
  el.classList.toggle('visible');
  el.style.display = el.classList.contains('visible') ? 'block' : 'none';
}

/* append debug message */
function logDev(msg) {
  devBuffer.push({ t: Date.now(), msg: (typeof msg === 'string' ? msg : JSON.stringify(msg)) });
  const devEl = $(IDs.devLog);
  if (devEl) {
    devEl.textContent = devBuffer.map(d => `[${new Date(d.t).toLocaleTimeString()}] ${d.msg}`).join('\n\n');
  }
}

/* ===== Voice Input (optional) ===== */

function supportsSpeech() {
  return 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
}

function initSpeechRecognizer() {
  if (!supportsSpeech()) return null;
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recog = new Speech();
  recog.lang = 'en-US';
  recog.interimResults = true;
  recog.continuous = false;
  recog.maxAlternatives = 1;
  recog.onstart = () => {
    voiceActive = true;
    const btn = $(IDs.btnVoice); if (btn) btn.classList.add('active');
    logDev('voice:start');
  };
  recog.onresult = (evt) => {
    const transcript = Array.from(evt.results).map(r => r[0].transcript).join(' ');
    const input = $(IDs.responseInput);
    if (input) input.value = transcript;
  };
  recog.onerror = (ev) => {
    logDev('voice:error ' + (ev.error || 'unknown'));
  };
  recog.onend = () => {
    voiceActive = false;
    const btn = $(IDs.btnVoice); if (btn) btn.classList.remove('active');
    logDev('voice:end');
  };
  return recog;
}

function toggleVoice() {
  if (!supportsSpeech()) {
    alert('Voice input not supported in this browser.');
    return;
  }
  if (!speechRecognizer) speechRecognizer = initSpeechRecognizer();
  if (!speechRecognizer) { alert('Voice initialization failed'); return; }
  if (voiceActive) {
    speechRecognizer.stop();
  } else {
    try { speechRecognizer.start(); } catch (e) { logDev('speech start err: ' + e); }
  }
}

/* ===== Submit handling (calls back into app) ===== */
async function handleSubmitResponse() {
  const text = getResponse();
  if (!text || text.length < 3) {
    // small UX nudge
    const inp = $(IDs.responseInput);
    if (inp) {
      inp.focus();
      inp.setAttribute('aria-invalid', 'true');
      setTimeout(() => inp.removeAttribute('aria-invalid'), 1500);
    }
    return;
  }
  // Build response object shape expected by analysis/data
  const responseObj = {
    id: `r_${Date.now().toString(36)}_${Math.floor(Math.random()*1e6).toString(36)}`,
    phaseId: currentPhase,
    promptId: null, // app should set more details if needed
    text,
    timestamps: { startedAt: Date.now() - Math.min(120000, text.length * 50), endedAt: Date.now(), submittedAt: Date.now() },
    meta: { inputMode: voiceActive ? 'voice' : 'keyboard' }
  };

  // Provide immediate UI feedback: show a loading mirror
  showMirror('Analyzing structure…');
  try {
    if (typeof callbacks.onSubmitResponse === 'function') {
      // await app's analysis flow (should return analysis result including mirror and domain scores and followups)
      const result = await callbacks.onSubmitResponse(responseObj);
      // result expected shape: { mirrorText, domainScores, followups, persistedResponse }
      if (result) {
        if (result.mirrorText) showMirror(result.mirrorText);
        if (result.domainScores) showScores(result.domainScores);
        if (Array.isArray(result.followups)) showFollowups(result.followups);
        // optionally clear input or keep for revision
        // clearResponse();
      }
    } else {
      logDev('No onSubmitResponse callback provided');
    }
  } catch (err) {
    logDev('submit error: ' + err);
    showMirror('An error occurred while analyzing your response. Please try again.');
  }
}

/* ===== Public small helpers ===== */
export { renderPhaseList as renderPhases };
export { getResponse };
export { clearResponse };
export { showMirror };
export { showScores };
export { showFollowups };
export { renderPrompt };
export { renderReport };
export { openLedgerModal as openLedger };
export { setPhase as setCurrentPhase };

// default export containing convenience methods
export default {
  initUI,
  setPhase,
  renderPrompt,
  getResponse,
  clearResponse,
  showMirror,
  showScores,
  showFollowups,
  renderReport,
  openLedger,
  toggleDevConsole
};
