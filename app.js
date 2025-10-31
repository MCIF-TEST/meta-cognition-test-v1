/* ==========================================================
   MCIF Meta-Cognition Test – Core Logic (app.js)
   Author: Hayden Andrew Carr | Meta-Cognitive Intelligence Project
   Version: 1.0
   ========================================================== */

/* =========================
   GLOBAL STATE MANAGEMENT
   ========================= */
const MCIFApp = {
  currentQuestion: 0,
  responses: [],
  startTime: null,
  isRunning: false,
};

/* =========================
   CORE QUESTIONS MODULE
   ========================= */
const MCIFQuestions = [
  {
    id: 1,
    prompt: "Choose an everyday object. Describe it as if perceived for the very first time.",
    type: "text",
  },
  {
    id: 2,
    prompt: "What emotion do you associate with the color blue?",
    type: "text",
  },
  {
    id: 3,
    prompt: "How do you define 'truth' in your own words?",
    type: "text",
  },
  {
    id: 4,
    prompt: "If your thoughts had a texture, what would they feel like?",
    type: "text",
  },
  {
    id: 5,
    prompt: "Describe a moment when time seemed to slow down for you.",
    type: "text",
  },
];

/* =========================
   INITIALIZATION
   ========================= */
document.addEventListener("DOMContentLoaded", () => {
  const startButton = document.getElementById("start-btn");
  const nextButton = document.getElementById("next-btn");
  const inputField = document.getElementById("response");
  const promptBox = document.getElementById("prompt");
  const progress = document.getElementById("progress");

  if (!startButton || !nextButton || !inputField || !promptBox || !progress) {
    console.error("Missing DOM elements. Please verify HTML structure.");
    return;
  }

  startButton.addEventListener("click", () => startTest(promptBox, progress));
  nextButton.addEventListener("click", () =>
    nextQuestion(promptBox, inputField, progress)
  );

  // Keyboard shortcuts for accessibility
  document.addEventListener("keyup", (event) => {
    if (event.key === "Enter" && MCIFApp.isRunning) {
      nextQuestion(promptBox, inputField, progress);
    }
  });
});

/* =========================
   TEST FLOW CONTROL
   ========================= */
function startTest(promptBox, progress) {
  if (MCIFApp.isRunning) return;

  MCIFApp.isRunning = true;
  MCIFApp.startTime = Date.now();
  MCIFApp.currentQuestion = 0;
  MCIFApp.responses = [];

  document.getElementById("start-btn").classList.add("hidden");
  document.getElementById("test-container").classList.remove("hidden");

  renderQuestion(promptBox, progress);
}

function nextQuestion(promptBox, inputField, progress) {
  const userInput = inputField.value.trim();

  if (!userInput) {
    alert("Please provide a response before continuing.");
    return;
  }

  MCIFApp.responses.push({
    questionId: MCIFQuestions[MCIFApp.currentQuestion].id,
    response: userInput,
    timestamp: new Date().toISOString(),
  });

  inputField.value = "";
  MCIFApp.currentQuestion++;

  if (MCIFApp.currentQuestion < MCIFQuestions.length) {
    renderQuestion(promptBox, progress);
  } else {
    finishTest();
  }
}

function renderQuestion(promptBox, progress) {
  const question = MCIFQuestions[MCIFApp.currentQuestion];
  if (!question) return finishTest();

  promptBox.textContent = question.prompt;
  progress.textContent = `Question ${MCIFApp.currentQuestion + 1} of ${
    MCIFQuestions.length
  }`;

  // Smooth fade animation (delegated to ui.js)
  if (typeof fadeIn === "function") fadeIn(promptBox);
}

/* =========================
   FINALIZATION
   ========================= */
function finishTest() {
  MCIFApp.isRunning = false;
  const totalTime = ((Date.now() - MCIFApp.startTime) / 1000).toFixed(1);

  // Save results locally (future upgrade: API integration)
  localStorage.setItem("MCIF_Test_Results", JSON.stringify(MCIFApp.responses));

  const summary = `
    <h2>Test Complete</h2>
    <p>You completed the test in <strong>${totalTime}</strong> seconds.</p>
    <p>Total responses: ${MCIFApp.responses.length}</p>
    <button id="download-btn" class="btn-primary">Download Results</button>
  `;

  const container = document.getElementById("test-container");
  container.innerHTML = summary;

  const downloadButton = document.getElementById("download-btn");
  if (downloadButton) {
    downloadButton.addEventListener("click", () => downloadResults());
  }
}

/* =========================
   UTILITIES
   ========================= */
function downloadResults() {
  const dataStr = JSON.stringify(MCIFApp.responses, null, 2);
  const blob = new Blob([dataStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "mcif_test_results.json";
  a.click();

  URL.revokeObjectURL(url);
}
