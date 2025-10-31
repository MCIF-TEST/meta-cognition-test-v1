/* app.js — UI controller that uses window.MCIF.Logic */
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
  let inFlight = false;

  // Initialize engine (non-blocking)
  if (!window.MCIF || !window.MCIF.Logic) {
    console.warn('MCIF engine not available on window.MCIF.Logic. Ensure engine scripts load first.');
  } else {
    try {
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
        <h2>${promptText}</h2>
        <textarea id="responseInput" rows="6" placeholder="Type your response here..." class="response-input"></textarea>
      </div>
    `;
    // populate previously saved response if available
    const session = window.MCIF?.Logic?.dumpState?.() || null;
    try {
      const saved = session?.session?.responses?.[question.index];
      if (saved && saved.response) {
        const ta = document.getElementById('responseInput');
        if (ta) ta.value = saved.response;
      }
    } catch (e) {}
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
    // Start test
    current = 0;
    total = window.MCIF?.Logic?.totalQuestions?.() || 0;
    if (total === 0) {
      // fallback to 1 if schema missing
      total = 1;
    }
    showTest();
    await loadAndRender(current);
    // Manage control visibility
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
      // show submit
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
    // call analysis
    try {
      const report = await window.MCIF.Logic.analyze();
      // display in results
      resultsSummary.innerHTML = `
        <h2>Test Complete</h2>
        <p>Composite Score: <strong>${Math.round((report.composite || 0) * 100)}%</strong></p>
        <pre class="report-json">${JSON.stringify(report, null, 2)}</pre>
      `;
    } catch (e) {
      resultsSummary.innerHTML = `<h2>Test Complete</h2><p>Analysis failed: ${e.message || e}</p>`;
    }
    showResults();
  });

  restartBtn?.addEventListener('click', async () => {
    if (window.MCIF?.Logic?.clearSession) window.MCIF.Logic.clearSession();
    // show intro and reset
    showIntro(true);
  });

  // Keyboard shortcuts: Enter to submit while in textarea
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.shiftKey) return; // allow shift+enter for newline
    if (e.key === 'Enter') {
      const ta = document.activeElement;
      if (ta && ta.id === 'responseInput') {
        e.preventDefault();
        nextBtn?.click();
      }
    }
  });
});
