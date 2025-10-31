// app.js — UI controller that drives the MCIF test using window.MCIF.Logic
import { fadeIn, fadeOut, drawMetaCurve, drawRadar } from './ui.js';

document.addEventListener('DOMContentLoaded', async () => {
  const startBtn = document.getElementById('startBtn');
  const tierSelect = document.getElementById('tier');
  const questionContainer = document.getElementById('questionContainer');
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  const submitBtn = document.getElementById('submitBtn');
  const progressEl = document.getElementById('progress');
  const resultsSection = document.getElementById('results');
  const summaryBlock = document.getElementById('summaryBlock');
  const rawReport = document.getElementById('rawReport');
  const metaCanvas = document.getElementById('metaCurve');
  const radarCanvas = document.getElementById('radarChart');
  const restartBtn = document.getElementById('restartBtn');
  const introSection = document.getElementById('intro');
  const testSection = document.getElementById('test');

  let current = 0;
  let total = 0;
  let schemaLoaded = false;

  // Ensure engine is present and initialized
  if (!window.MCIF || !window.MCIF.Logic) {
    console.error('MCIF engine missing. Make sure engine/logic.js is loaded.');
    return;
  }
  try {
    await window.MCIF.Logic.init();
    schemaLoaded = true;
  } catch (e) {
    console.error('Engine init failed:', e);
    // still attempt to proceed — engine provides stubs
  }

  function updateProgress() {
    progressEl.textContent = `Question ${current + 1} of ${total}`;
  }

  function renderQuestion(q) {
    if (!q) {
      questionContainer.innerHTML = '<div class="question-card"><p>Missing question.</p></div>';
      return;
    }
    // text-based prompt UI
    const prompt = q.prompt.text || q.prompt.prompt || q.prompt;
    questionContainer.innerHTML = `
      <div class="question-card">
        <h3>Phase: ${q.phase?.name || 'Unknown'}</h3>
        <p class="prompt-text">${escapeHtml(prompt)}</p>
        <textarea id="responseInput" rows="8" placeholder="Type your reflective response here..." class="response-input"></textarea>
      </div>
    `;
    // if we have a previously recorded response, populate
    try {
      const stateDump = window.MCIF?.Logic?.dumpState?.();
      const saved = stateDump?.session?.responses?.[q.index];
      if (saved && saved.response) document.getElementById('responseInput').value = saved.response;
    } catch (e) {}
    updateProgress();
  }

  async function loadQuestion(index) {
    const q = window.MCIF.Logic.loadQuestion(index);
    renderQuestion(q);
  }

  startBtn?.addEventListener('click', async () => {
    current = 0;
    total = window.MCIF.Logic.totalQuestions() || 0;
    if (!total) total = 6; // fallback
    introSection.classList.add('hidden');
    testSection.classList.remove('hidden');
    await loadQuestion(current);
    prevBtn.disabled = true;
    submitBtn.classList.add('hidden');
  });

  prevBtn?.addEventListener('click', async () => {
    if (current <= 0) return;
    saveCurrentResponse();
    current--;
    await loadQuestion(current);
    prevBtn.disabled = current === 0;
    submitBtn.classList.add('hidden');
    nextBtn.classList.remove('hidden');
  });

  nextBtn?.addEventListener('click', async () => {
    const ta = document.getElementById('responseInput');
    if (!ta || !ta.value.trim()) { alert('Please provide a response before continuing.'); return; }
    saveCurrentResponse();
    current++;
    if (current >= total) {
      // last question
      current = total - 1;
      submitBtn.classList.remove('hidden');
      nextBtn.classList.add('hidden');
      await loadQuestion(current);
    } else {
      await loadQuestion(current);
    }
    prevBtn.disabled = current === 0;
  });

  submitBtn?.addEventListener('click', async () => {
    saveCurrentResponse();
    // run analysis
    try {
      const report = await window.MCIF.Logic.analyze();
      displayReport(report);
    } catch (e) {
      summaryBlock.innerHTML = `<p>Analysis failed: ${escapeHtml(e.message || String(e))}</p>`;
      resultsSection.classList.remove('hidden');
    }
  });

  restartBtn?.addEventListener('click', () => {
    if (window.MCIF?.Logic?.clearSession) window.MCIF.Logic.clearSession();
    resultsSection.classList.add('hidden');
    introSection.classList.remove('hidden');
    testSection.classList.add('hidden');
    questionContainer.innerHTML = '';
  });

  function saveCurrentResponse() {
    const ta = document.getElementById('responseInput');
    if (!ta) return;
    const text = ta.value.trim();
    try {
      window.MCIF.Logic.recordResponse(current, text, { endTime: new Date().toISOString() });
    } catch (e) {
      console.warn('Failed to record response', e);
    }
  }

  function displayReport(report) {
    // Summary block
    const percent = Math.round((report.composite || 0) * 100);
    summaryBlock.innerHTML = `
      <p>Composite Index: <strong>${percent}%</strong> — ${report.compositePoints || 0} / ${window.MCIF?.Logic?.dumpState()?.schema?.config?.reportScale?.totalPoints || 700} points</p>
      <p>Archetype: <strong>${escapeHtml(report.archetype || 'Unknown')}</strong></p>
      <p>Adaptability: <strong>${Math.round((report.adaptability||0)*100)}%</strong></p>
    `;
    // meta-curve: show normalized phase scores in schema order
    const phaseOrder = Object.keys(report.normalizedPhaseScores || {});
    const curvePoints = phaseOrder.map(pid => report.normalizedPhaseScores[pid] || 0);
    drawMetaCurve(metaCanvas, curvePoints);

    // radar: labels and values
    const labels = phaseOrder.map(pid => {
      const p = window.MCIF?.Logic?.dumpState()?.schema?.phases?.find(x=>x.id===pid);
      return p?.name || pid;
    });
    const values = curvePoints;
    drawRadar(radarCanvas, labels, values);

    rawReport.textContent = JSON.stringify(report, null, 2);
    resultsSection.classList.remove('hidden');
    fadeIn(resultsSection, 300);
  }

  function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  }
});
