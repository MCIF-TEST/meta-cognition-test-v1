// app.js — UI controller that drives the MCIF test using window.MCIF.Logic
import { fadeIn, fadeOut, drawMetaCurve, drawRadar, drawPhaseBars, renderMentorPanel } from './ui.js';

document.addEventListener('DOMContentLoaded', async () => {
  const startBtn = document.getElementById('startBtn');
  const mentorToggle = document.getElementById('mentorToggle');
  const tierSelect = document.getElementById('tier');
  const suggestedTimeEl = document.getElementById('suggestedTime');
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
  const barsCanvas = document.getElementById('phaseBars');
  const restartBtn = document.getElementById('restartBtn');
  const introSection = document.getElementById('intro');
  const testSection = document.getElementById('test');
  const mentorPanel = document.getElementById('mentorPanel');

  let current = 0;
  let total = 0;
  let mentorMode = false;

  // init engine
  if (!window.MCIF || !window.MCIF.Logic) {
    console.error('MCIF engine missing.');
    return;
  }
  try {
    await window.MCIF.Logic.init();
  } catch (e) {
    console.warn('Engine init failed (continuing with stubs):', e);
  }

  // tier -> suggested per prompt time (soft hint)
  const tierTimes = {
    explorer: '5–8 min',
    architect: '8–12 min',
    visionary: '12–18 min'
  };

  tierSelect.addEventListener('change', () => {
    const v = tierSelect.value || 'explorer';
    suggestedTimeEl.textContent = tierTimes[v] || '5–10 min';
  });

  mentorToggle.addEventListener('change', () => {
    mentorMode = !!mentorToggle.checked;
    // show/hide mentor panel only on results page
    if (!resultsSection.classList.contains('hidden')) {
      mentorPanel.classList.toggle('hidden', !mentorMode);
    }
  });

  function updateProgress() {
    progressEl.textContent = `Question ${current + 1} of ${total}`;
  }

  function renderQuestion(q) {
    if (!q) {
      questionContainer.innerHTML = '<div class="question-card"><p>Missing question.</p></div>';
      return;
    }
    const prompt = q.prompt.text || q.prompt.prompt || q.prompt;
    questionContainer.innerHTML = `
      <div class="question-card">
        <h3>Phase: ${escapeHtml(q.phase?.name || 'Unknown')}</h3>
        <p class="prompt-text">${escapeHtml(prompt)}</p>
        <textarea id="responseInput" rows="8" placeholder="Type your reflective response here..." class="response-input"></textarea>
      </div>
    `;
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
    if (!total) total = 6;
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
    mentorPanel.classList.add('hidden');
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
    const percent = Math.round((report.composite || 0) * 100);
    const totalPoints = window.MCIF?.Logic?.dumpState()?.schema?.config?.reportScale?.totalPoints || 700;
    summaryBlock.innerHTML = `
      <p>Composite Index: <strong>${percent}%</strong> — ${report.compositePoints || 0} / ${totalPoints} points</p>
      <p>Archetype: <strong>${escapeHtml(report.archetype || 'Unknown')}</strong></p>
      <p>Adaptability: <strong>${Math.round((report.adaptability||0)*100)}%</strong></p>
    `;

    const phaseOrder = Object.keys(report.normalizedPhaseScores || {});
    const points = phaseOrder.map(pid => report.normalizedPhaseScores[pid] || 0);
    drawMetaCurve(metaCanvas, points);

    const labels = phaseOrder.map(pid => {
      const p = window.MCIF?.Logic?.dumpState()?.schema?.phases?.find(x=>x.id===pid);
      return p?.name || pid;
    });
    drawRadar(radarCanvas, labels, points);
    drawPhaseBars(barsCanvas, labels, points);

    rawReport.textContent = JSON.stringify(report, null, 2);

    // Mentor mode: show local reflection + practical suggestions
    if (mentorMode) {
      const aiReflection = generateMentorReflection(report);
      const suggestions = generatePracticeSuggestions(report);
      renderMentorPanel(mentorPanel, aiReflection, suggestions);
      mentorPanel.classList.remove('hidden');
    } else {
      mentorPanel.classList.add('hidden');
    }

    resultsSection.classList.remove('hidden');
    fadeIn(resultsSection, 300);
  }

  function generateMentorReflection(report) {
    // Use local archetype & phase highlights to craft a concise reflection string
    const arch = report.archetype || 'Balanced Strategist';
    const topPhases = Object.entries(report.normalizedPhaseScores || {}).sort((a,b)=>b[1]-a[1]).slice(0,3).map(p => `${p[0]}:${Math.round(p[1]*100)}%`);
    return `Your profile aligns most closely with "${arch}". Top phase strengths: ${topPhases.join(', ')}. Adaptability: ${Math.round((report.adaptability||0)*100)}%. The system suggests focusing on balanced practice to reduce variance across domains.`;
  }

  function generatePracticeSuggestions(report) {
    // lightweight heuristics for suggestions
    const low = Object.entries(report.normalizedPhaseScores || {}).filter(([k,v])=>v < 0.5).map(p=>p[0]);
    const suggestions = [];
    if (low.length === 0) suggestions.push('Maintain balanced practice: continue reflective cycles across phases.');
    else {
      for (const pid of low) {
        suggestions.push(`Practice short targeted tasks for ${pid} to strengthen that domain (10–15 minute exercises).`);
      }
    }
    suggestions.push('Schedule micro-reflection sessions weekly to increase meta-awareness retention.');
    suggestions.push('Use simple behavior experiments to convert insights into small actions (implementation intentions).');
    return suggestions;
  }

  function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  }
});
