// =============================================
// MCIF Meta-Cognition Test v1
// User Interface Rendering & Display Logic
// =============================================

// Safely render a question on the page
function renderQuestion(question, index) {
  const container = document.getElementById('questionContainer');
  if (!container) {
    console.error('Question container not found in DOM');
    return;
  }

  // Accessibility: reset focus, readable numbering
  container.innerHTML = `
    <div class="question-card" tabindex="0" aria-label="Question ${index + 1}">
      <h2 class="question-title">Question ${index + 1}</h2>
      <p class="question-text">${escapeHTML(question.text)}</p>
      <div class="options-container">
        ${question.options
          .map(
            (opt, i) => `
              <label class="option-label" for="option-${index}-${i}">
                <input
                  type="radio"
                  name="option"
                  id="option-${index}-${i}"
                  value="${escapeHTML(opt)}"
                  class="option-input"
                  aria-describedby="option-desc-${index}-${i}"
                />
                <span id="option-desc-${index}-${i}" class="option-text">${escapeHTML(opt)}</span>
              </label>
            `
          )
          .join('')}
      </div>
    </div>
  `;

  // Move focus to question for smooth accessibility flow
  const firstInput = container.querySelector('input[name="option"]');
  if (firstInput) firstInput.focus();
}

// Show results after analysis
function showResults(results) {
  const container = document.getElementById('results');
  if (!container) {
    console.error('Results container not found');
    return;
  }

  container.innerHTML = `
    <div class="results-card" aria-live="polite">
      <h2>Your Results</h2>
      <p><strong>Cognitive Profile:</strong> ${escapeHTML(results.profile)}</p>
      <p><strong>Dominant Archetype:</strong> ${escapeHTML(results.archetype)}</p>
      <p><strong>Score:</strong> ${escapeHTML(results.score.toString())}</p>

      <div class="results-summary">
        ${results.details
          .map(
            (detail) => `
              <div class="result-item">
                <span class="result-title">${escapeHTML(detail.dimension)}</span>
                <span class="result-score">${escapeHTML(detail.value.toString())}</span>
              </div>
            `
          )
          .join('')}
      </div>

      <button id="restartBtn" class="btn btn-primary">Restart Test</button>
    </div>
  `;

  document.getElementById('results').classList.remove('hidden');
  document.getElementById('test').classList.add('hidden');
}

// Utility: Escape potentially unsafe HTML
function escapeHTML(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Optional: Smooth scroll and visibility helpers
function scrollToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Exported functions for app.js
export { renderQuestion, showResults, scrollToTop };
