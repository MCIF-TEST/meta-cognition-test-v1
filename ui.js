/*
  ui.js | Meta-Cognition Test (MCIF 7.1)
  Lucid Flow UI Controller
  Developed by Hayden Andrew Carr | Meta-Cognitive Intelligence Project
*/

import { testState } from '../app.js';

const UI = (() => {
  const container = document.getElementById('test-container');
  const body = document.body;

  /* ──────────────────────────────
     🌀 LUCID FLOW STATE MANAGEMENT
  ────────────────────────────── */

  function setTierVisual(tier) {
    body.setAttribute('data-tier', tier);
    const title = document.querySelector('h1, h2');
    if (title) {
      title.classList.add('lucid-flow');
      setTimeout(() => title.classList.remove('lucid-flow'), 4000);
    }
  }

  function fadeTransition(nextCallback) {
    container.style.opacity = '0';
    setTimeout(() => {
      nextCallback();
      container.style.opacity = '1';
    }, 600);
  }

  /* ──────────────────────────────
     🌊 PROGRESS INDICATOR & PHASE
  ────────────────────────────── */

  function updateProgress() {
    const bar = document.getElementById('progress-bar');
    if (!bar) return;

    const progress =
      ((testState.currentPhase + 1) / (testState.totalPhases || 6)) * 100;

    bar.style.width = `${progress}%`;
    bar.dataset.label = `Phase ${testState.currentPhase + 1} / ${testState.totalPhases || 6}`;
  }

  function renderProgressBar() {
    if (document.getElementById('progress-bar')) return;

    const progressContainer = document.createElement('div');
    progressContainer.id = 'progress-container';

    const progressBar = document.createElement('div');
    progressBar.id = 'progress-bar';
    progressBar.dataset.label = 'Phase 1 / 6';

    progressContainer.appendChild(progressBar);
    document.body.prepend(progressContainer);
  }

  /* ──────────────────────────────
     💡 DYNAMIC FEEDBACK
  ────────────────────────────── */

  function showNotification(message, type = 'info') {
    const notif = document.createElement('div');
    notif.className = `notification ${type}`;
    notif.textContent = message;

    document.body.appendChild(notif);
    setTimeout(() => notif.classList.add('visible'), 50);

    setTimeout(() => {
      notif.classList.remove('visible');
      setTimeout(() => notif.remove(), 600);
    }, 3500);
  }

  /* ──────────────────────────────
     🧘 LUCID FLOW EFFECTS
  ────────────────────────────── */

  function lucidWave() {
    const wave = document.createElement('div');
    wave.className = 'lucid-wave';
    document.body.appendChild(wave);

    setTimeout(() => wave.remove(), 2000);
  }

  /* ──────────────────────────────
     🪞 VISUAL SYNCHRONIZATION
  ────────────────────────────── */

  function syncToCognitiveState(state) {
    const tone = state?.emotionalTone || 'neutral';
    const base = document.documentElement;

    switch (tone) {
      case 'focused':
        base.style.setProperty('--accent-color', '#73a9ff');
        break;
      case 'reflective':
        base.style.setProperty('--accent-color', '#9b6cff');
        break;
      case 'inspired':
        base.style.setProperty('--accent-color', '#c67aff');
        break;
      case 'harmonized':
        base.style.setProperty('--accent-color', '#ff9bff');
        break;
      default:
        base.style.setProperty('--accent-color', '#6f86d6');
    }

    lucidWave();
  }

  /* ──────────────────────────────
     ⚙️  INITIALIZATION
  ────────────────────────────── */

  function initUI() {
    renderProgressBar();
    updateProgress();
    showNotification("Lucid Flow Interface Initialized", "success");
    setTierVisual(testState.userTier);
  }

  /* ──────────────────────────────
     🔁 PUBLIC API
  ────────────────────────────── */

  return {
    initUI,
    fadeTransition,
    updateProgress,
    showNotification,
    syncToCognitiveState,
    setTierVisual
  };
})();

/* ──────────────────────────────
   CSS HOOKS for Animations
────────────────────────────── */
const style = document.createElement('style');
style.textContent = `
  #progress-container {
    width: 100%;
    height: 6px;
    background: rgba(255,255,255,0.1);
    border-radius: 4px;
    overflow: hidden;
    margin-bottom: 20px;
  }

  #progress-bar {
    height: 100%;
    width: 0%;
    background: linear-gradient(90deg, #3a9df8, #8f68ff);
    transition: width 0.5s ease-in-out;
    position: relative;
  }

  #progress-bar::after {
    content: attr(data-label);
    position: absolute;
    top: -25px;
    right: 0;
    font-size: 0.8rem;
    color: #aab2c6;
  }

  .notification {
    position: fixed;
    top: 20px;
    right: 20px;
    background: rgba(50, 60, 90, 0.85);
    color: #fff;
    padding: 0.75rem 1.25rem;
    border-radius: 8px;
    opacity: 0;
    transform: translateY(-15px);
    transition: all 0.4s ease;
    font-size: 0.9rem;
  }

  .notification.visible {
    opacity: 1;
    transform: translateY(0);
  }

  .notification.success {
    background: rgba(100, 200, 140, 0.85);
  }

  .notification.error {
    background: rgba(255, 80, 100, 0.85);
  }

  .lucid-wave {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    background: radial-gradient(circle at center, rgba(140,140,255,0.12), transparent 60%);
    animation: wavePulse 2s ease-out forwards;
  }

  @keyframes wavePulse {
    from { opacity: 0.7; transform: scale(1); }
    to { opacity: 0; transform: scale(1.3); }
  }
`;
document.head.appendChild(style);

/* ──────────────────────────────
   EXPORT MODULE
────────────────────────────── */
export { UI };
