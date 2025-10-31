/* app.js — UI controller that uses window.MCIF.Logic (keeps controller small and explicit) */

import { fadeIn, fadeOut } from './ui.js';

document.addEventListener('DOMContentLoaded', async () => {
  // DOM refs (match index.html corrected IDs)
  const startBtn = document.getElementById('startBtn');
  const questionContainer = document.getElementById('questionContainer');
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  const submitBtn = document.getElementById('submitBtn');
  const progressEl = document.getElementById('progress');
  const resultsSection = document.getElementById('results');
  const resultsSummary = document.getElementById('resultSummary');
  const restartBtn = document.getElementById('restartBtn');
  const testSection = document.getElementById('test');
  const introSection = document.getElementById('intro');

  // UI state
  let current = 0;
  let total = 0;

  // Initialize engine explicitly (if available)
  if (!window.MCIF || !window.MCIF.Logic) {
    console.warn('MCIF engine not available on window.MCIF.Logic. Ensure engine scripts load first.');
  } else {
    try {
      // init can accept options like adapters, sessionMeta — left empty for default
      await window.MCIF.Logic.init();
    } catch (e) {
      console.warn('Engine init failed (non-fatal):', e);
    }
  }

  function showIntro(show) {
    introSection.classList.toggle('hidden', !show);
    testSection.classList.toggle('hidden', show);
    resultsSection.classList.add('hidden');
  }

  function showTest() {
    introSection.classList.add('hidden');
    testSection.classList.remove('hidden');
    resultsSection.classList.add('hidden');
  }

  function showResults() {
    testSection.classList.add('hidden');
    resultsSection.classList.remove('hidden');
  }

  function updateProgress() {
    progressEl.textContent = `Question ${current + 1} of ${total}`;
  }

  function renderQuestionUI(question) {
    // question: { index, prompt, phase }
    const promptText = (question && (question.prompt.text || question.prompt.prompt || question.prompt)) || 'No prompt available.';
    // build a simple text-area response UI
    questionContainer.innerHTML = `
      <div class="question-card">
        <h2>${escapeHtml(promptText)}</h2>
        <textarea id="responseInput" rows="6" placeholder="Type your response here..." class="response-input"></textarea>
      </div>
    `;
    // populate previously saved response if available
    try {
      const sessionDump = window.MCIF?.Logic?.dumpState?.();
      const saved = sessionDump?.session?.responses?.[question.index];
      if (saved && saved.response) {
        const ta = document.getElementById('responseInput');
        if (ta) ta.value = saved.response;
      }
    } catch (e) {
      // ignore
    }
  }

  async function loadAndRender(index) {
    if (!window.MCIF || !window.MCIF.Logic) return;
    const q = window.MCIF.Logic.loadQuestion(index) || null;
    if (!q) {
      questionContainer.innerHTML = '<div class="question-card"><p>Missing question.</p></div>';
      return;
    }
    renderQuestionUI(q);
    updateProgress();
  }

  startBtn?.addEventListener('click', async () => {
    current = 0;
    total = window.MCIF?.Logic?.totalQuestions?.() || 0;
    if (total === 0) total = 1;
    showTest();
    await loadAndRender(current);
    prevBtn.disabled = true;
    submitBtn.classList.add('hidden');
    nextBtn.classList.remove('hidden');
  });

  prevBtn?.addEventListener('click', async () => {
    if (current <= 0) return;
    // save current response before moving back
    const ta = document.getElementById('responseInput');
    if (ta && window.MCIF?.Logic?.recordResponse) {
      window.MCIF.Logic.recordResponse(current, ta.value, { endTime: new Date().toISOString() });
    }
    current--;
    await loadAndRender(current);
    prevBtn.disabled = current === 0;
    submitBtn.classList.add('hidden');
    nextBtn.classList.remove('hidden');
  });

  nextBtn?.addEventListener('click', async () => {
    const ta = document.getElementById('responseInput');
    if (!ta || !ta.value.trim()) {
      alert('Please provide a response before continuing.');
      return;
    }
    // record
    if (window.MCIF?.Logic?.recordResponse) {
      window.MCIF.Logic.recordResponse(current, ta.value.trim(), { endTime: new Date().toISOString() });
    }
    current++;
    if (current >= total) {
      current = total - 1;
      submitBtn.classList.remove('hidden');
      nextBtn.classList.add('hidden');
      await loadAndRender(current);
    } else {
      await loadAndRender(current);
    }
    prevBtn.disabled = current === 0;
  });

  submitBtn?.addEventListener('click', async () => {
    const ta = document.getElementById('responseInput');
    if (ta && ta.value && window.MCIF?.Logic?.recordResponse) {
      window.MCIF.Logic.recordResponse(current, ta.value.trim(), { endTime: new Date().toISOString() });
    }
    try {
      const report = await window.MCIF.Logic.analyze();
      resultsSummary.innerHTML = `
        <h2>Test Complete</h2>
        <p>Composite Score: <strong>${Math.round((report.composite || 0) * 100)}%</strong></p>
        <pre class="report-json">${escapeHtml(JSON.stringify(report, null, 2))}</pre>
      `;
    } catch (e) {
      resultsSummary.innerHTML = `<h2>Test Complete</h2><p>Analysis failed: ${escapeHtml(e.message || String(e))}</p>`;
    }
    showResults();
  });

  restartBtn?.addEventListener('click', async () => {
    if (window.MCIF?.Logic?.clearSession) window.MCIF.Logic.clearSession();
    showIntro(true);
  });

  // Simple helper to guard text inserted into innerHTML
  function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }

  // Keyboard: Enter (without shift) advances to next question
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      const ta = document.activeElement;
      if (ta && ta.id === 'responseInput') {
        e.preventDefault();
        nextBtn?.click();
      }
    }
  });
});
