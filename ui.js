/**
 * MCIF UI Core – Enterprise Edition
 * Author: Hayden Andrew Carr | Meta-Cognitive Intelligence Project
 * Version: 7.1+
 *
 * Purpose:
 *  Handles all dynamic UI rendering, event management, and component lifecycle logic
 *  for the Meta-Cognition Intelligence Framework test interface.
 */

document.addEventListener("DOMContentLoaded", () => {
  try {
    const appContainer = document.getElementById("app");
    const testContainer = document.getElementById("test-container");
    const startButton = document.getElementById("start-btn");
    const nextButton = document.getElementById("next-btn");
    const progressBar = document.getElementById("progress-bar");
    const resultContainer = document.getElementById("result-container");
    const loader = document.getElementById("loader");

    let currentQuestionIndex = 0;
    let userResponses = [];
    let isTransitioning = false;

    /** -----------------------------------------
     * UI Lifecycle & Initialization
     * -------------------------------------- */
    const initUI = () => {
      if (!appContainer) {
        console.error("Error: UI container not found.");
        return;
      }
      fadeIn(appContainer, 600);
      console.info("%c[MCIF UI] Initialized successfully.", "color: #00c896");
    };

    const showLoader = (state = true) => {
      loader.style.display = state ? "flex" : "none";
    };

    const fadeIn = (element, duration = 400) => {
      element.style.opacity = 0;
      element.style.display = "block";
      let opacity = 0;
      const increment = 50 / duration;
      const fade = setInterval(() => {
        opacity += increment;
        if (opacity >= 1) {
          clearInterval(fade);
          element.style.opacity = 1;
        } else {
          element.style.opacity = opacity;
        }
      }, 50);
    };

    const fadeOut = (element, duration = 400, callback) => {
      let opacity = 1;
      const decrement = 50 / duration;
      const fade = setInterval(() => {
        opacity -= decrement;
        if (opacity <= 0) {
          clearInterval(fade);
          element.style.display = "none";
          if (callback) callback();
        } else {
          element.style.opacity = opacity;
        }
      }, 50);
    };

    /** -----------------------------------------
     * Question Rendering
     * -------------------------------------- */
    const renderQuestion = (question) => {
      if (!question) {
        console.error("No question to render.");
        return;
      }

      testContainer.innerHTML = `
        <div class="question-card">
          <h2 class="question-title">${question.prompt}</h2>
          <div class="options-container">
            ${question.options
              .map(
                (opt, idx) => `
              <button class="option-btn" data-index="${idx}">
                ${opt}
              </button>`
              )
              .join("")}
          </div>
        </div>
      `;

      document.querySelectorAll(".option-btn").forEach((btn) => {
        btn.addEventListener("click", handleOptionSelect);
      });
    };

    /** -----------------------------------------
     * User Interaction
     * -------------------------------------- */
    const handleOptionSelect = (event) => {
      if (isTransitioning) return;
      isTransitioning = true;

      const selectedIndex = event.target.dataset.index;
      userResponses.push({
        questionIndex: currentQuestionIndex,
        response: selectedIndex,
      });

      fadeOut(testContainer, 400, () => {
        currentQuestionIndex++;
        updateProgress();
        if (currentQuestionIndex < MCIF_SCHEMA.questions.length) {
          renderQuestion(MCIF_SCHEMA.questions[currentQuestionIndex]);
          fadeIn(testContainer, 400);
        } else {
          finalizeResults();
        }
        isTransitioning = false;
      });
    };

    /** -----------------------------------------
     * Progress & Results
     * -------------------------------------- */
    const updateProgress = () => {
      const progressPercent =
        ((currentQuestionIndex + 1) / MCIF_SCHEMA.questions.length) * 100;
      progressBar.style.width = `${progressPercent}%`;
    };

    const finalizeResults = () => {
      fadeOut(testContainer, 400, () => {
        showLoader(true);
        setTimeout(() => {
          showLoader(false);
          displayResults();
        }, 1200);
      });
    };

    const displayResults = () => {
      const score = calculateMCIFScore(userResponses);
      resultContainer.innerHTML = `
        <div class="result-card">
          <h2>Test Complete</h2>
          <p>Your Meta-Cognitive Harmony Score:</p>
          <h3 class="score">${score}</h3>
          <button id="restart-btn">Restart</button>
        </div>
      `;

      document.getElementById("restart-btn").addEventListener("click", restartTest);
      fadeIn(resultContainer, 600);
    };

    /** -----------------------------------------
     * Logic Layer (Integrates with app.js + Schema)
     * -------------------------------------- */
    const calculateMCIFScore = (responses) => {
      let total = 0;
      responses.forEach((r) => {
        const question = MCIF_SCHEMA.questions[r.questionIndex];
        total += parseFloat(question.weights[r.response] || 0);
      });
      const score = Math.round((total / responses.length) * 100);
      return score;
    };

    const restartTest = () => {
      userResponses = [];
      currentQuestionIndex = 0;
      fadeOut(resultContainer, 400, () => {
        renderQuestion(MCIF_SCHEMA.questions[0]);
        updateProgress();
        fadeIn(testContainer, 400);
      });
    };

    /** -----------------------------------------
     * Start Button
     * -------------------------------------- */
    startButton.addEventListener("click", () => {
      fadeOut(startButton, 400, () => {
        renderQuestion(MCIF_SCHEMA.questions[0]);
        fadeIn(testContainer, 400);
      });
    });

    // Initialize UI
    initUI();
  } catch (error) {
    console.error("[MCIF UI ERROR]:", error);
  }
});
