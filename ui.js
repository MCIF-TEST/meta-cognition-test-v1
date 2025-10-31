/* ================================================================
   MCIF Meta-Cognition Test v1
   UI Controller — Enterprise Edition
   Developed by Hayden Andrew Carr | Meta-Cognitive Intelligence Project
   ================================================================= */

/**
 * UI Manager handles all dynamic DOM updates, navigation states,
 * and user feedback animations during the MCIF test lifecycle.
 */

const UI = (() => {
  const elements = {
    intro: document.getElementById("intro"),
    test: document.getElementById("test"),
    results: document.getElementById("results"),
    questionContainer: document.getElementById("questionContainer"),
    startBtn: document.getElementById("startBtn"),
    nextBtn: document.getElementById("nextBtn"),
    prevBtn: document.getElementById("prevBtn"),
    submitBtn: document.getElementById("submitBtn"),
    restartBtn: document.getElementById("restartBtn"),
    resultSummary: document.getElementById("resultSummary"),
  };

  let currentQuestionIndex = 0;
  let responses = [];

  /* --------------------- CORE UI TRANSITIONS --------------------- */

  function showSection(section) {
    Object.values(elements).forEach((el) => {
      if (el && el.tagName === "SECTION") el.classList.add("hidden");
    });
    section.classList.remove("hidden");
    section.scrollIntoView({ behavior: "smooth" });
  }

  function fadeIn(el) {
    el.style.opacity = 0;
    el.style.transition = "opacity 0.3s ease-in";
    requestAnimationFrame(() => {
      el.style.opacity = 1;
    });
  }

  /* --------------------- QUESTION RENDERING --------------------- */

  function renderQuestion(questionObj, index, total) {
    if (!questionObj) return;

    const { title, text, options } = questionObj;

    elements.questionContainer.innerHTML = `
      <div class="question-title">${index + 1}. ${title}</div>
      <div class="question-text">${text}</div>
      <div class="options-container">
        ${options
          .map(
            (opt, i) => `
          <label class="option-label">
            <input type="radio" name="option" class="option-input" value="${i}" ${
              responses[index] === i ? "checked" : ""
            }>
            <span class="option-text">${opt}</span>
          </label>
        `
          )
          .join("")}
      </div>
      <p class="progress-indicator">${index + 1} / ${total}</p>
    `;
    fadeIn(elements.questionContainer);
  }

  /* --------------------- NAVIGATION HANDLERS --------------------- */

  function handleStart() {
    currentQuestionIndex = 0;
    responses = [];
    showSection(elements.test);
    MCIF.loadQuestion(currentQuestionIndex);
  }

  function handleNext() {
    saveResponse();
    if (currentQuestionIndex < MCIF.totalQuestions() - 1) {
      currentQuestionIndex++;
      MCIF.loadQuestion(currentQuestionIndex);
    } else {
      elements.submitBtn.classList.remove("hidden");
      elements.nextBtn.classList.add("hidden");
    }
  }

  function handlePrev() {
    saveResponse();
    if (currentQuestionIndex > 0) {
      currentQuestionIndex--;
      MCIF.loadQuestion(currentQuestionIndex);
    }
  }

  function handleSubmit() {
    saveResponse();
    const results = MCIF.analyze(responses);
    renderResults(results);
    showSection(elements.results);
  }

  function handleRestart() {
    responses = [];
    showSection(elements.intro);
  }

  /* --------------------- STATE PERSISTENCE --------------------- */

  function saveResponse() {
    const selected = document.querySelector('input[name="option"]:checked');
    if (selected) {
      responses[currentQuestionIndex] = parseInt(selected.value);
    }
  }

  /* --------------------- RESULTS RENDERING --------------------- */

  function renderResults(results) {
    if (!results || typeof results !== "object") return;

    elements.resultSummary.innerHTML = `
      ${Object.entries(results)
        .map(
          ([phase, score]) => `
          <div class="result-item">
            <span class="result-title">${phase}</span>
            <span class="result-score">${score.toFixed(2)}</span>
          </div>
        `
        )
        .join("")}
    `;
    fadeIn(elements.resultSummary);
  }

  /* --------------------- EVENT LISTENERS --------------------- */

  function bindEvents() {
    elements.startBtn?.addEventListener("click", handleStart);
    elements.nextBtn?.addEventListener("click", handleNext);
    elements.prevBtn?.addEventListener("click", handlePrev);
    elements.submitBtn?.addEventListener("click", handleSubmit);
    elements.restartBtn?.addEventListener("click", handleRestart);
  }

  /* --------------------- PUBLIC METHODS --------------------- */

  return {
    init: () => {
      bindEvents();
      showSection(elements.intro);
    },
    renderQuestion,
  };
})();

/* Initialize once DOM is ready */
document.addEventListener("DOMContentLoaded", () => {
  if (UI && typeof UI.init === "function") UI.init();
});
