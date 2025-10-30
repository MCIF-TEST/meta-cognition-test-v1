/* 
  app.js | Meta-Cognition Test (MCIF 7.1)
  Core application controller
  Developed by Hayden Andrew Carr | Meta-Cognitive Intelligence Project
*/

import { mcifLogic } from './js/logic.js';
import { mcifData } from './js/data.js';
import { mcifAnalysis } from './js/analysis.js';

let schema = {};
let weights = {};
let testState = {
  currentPhase: 0,
  responses: [],
  scores: {},
  archetype: null,
  startTime: null,
  endTime: null,
  userTier: "Novice",
  initialized: false
};

// 🔹 Initialize Application
async function initializeApp() {
  console.log("Initializing Meta-Cognition Test...");

  schema = await fetchJSON('./data/mcif-schema.json');
  weights = await fetchJSON('./data/weights.json');
  mcifData.load(schema);

  testState.startTime = new Date();
  testState.initialized = true;

  console.log("Framework loaded:", schema.version, weights.version);

  renderPhase(0);
}

// 🔹 Utility: Load JSON Files
async function fetchJSON(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Failed to load ${path}`);
  return await response.json();
}

// 🔹 Render Phase
function renderPhase(index) {
  const phase = schema.phases[index];
  const container = document.getElementById('test-container');
  container.innerHTML = '';

  const title = document.createElement('h2');
  title.textContent = phase.name;

  const instructions = document.createElement('p');
  instructions.textContent = phase.description;

  const questionList = document.createElement('div');
  questionList.className = 'question-list';

  phase.questions.forEach((q, i) => {
    const questionBlock = document.createElement('div');
    questionBlock.className = 'question-block';

    const label = document.createElement('label');
    label.textContent = q.prompt;

    const input = document.createElement('textarea');
    input.placeholder = "Type your reflection here...";
    input.dataset.index = i;

    questionBlock.appendChild(label);
    questionBlock.appendChild(input);
    questionList.appendChild(questionBlock);
  });

  const nextBtn = document.createElement('button');
  nextBtn.textContent = "Next Phase →";
  nextBtn.onclick = () => handleNextPhase();

  container.appendChild(title);
  container.appendChild(instructions);
  container.appendChild(questionList);
  container.appendChild(nextBtn);
}

// 🔹 Handle Next Phase Transition
function handleNextPhase() {
  const container = document.getElementById('test-container');
  const inputs = container.querySelectorAll('textarea');
  const responses = Array.from(inputs).map(input => input.value.trim());

  testState.responses.push({
    phase: schema.phases[testState.currentPhase].name,
    answers: responses
  });

  if (testState.currentPhase < schema.phases.length - 1) {
    testState.currentPhase++;
    renderPhase(testState.currentPhase);
  } else {
    finishTest();
  }
}

// 🔹 Finish Test
function finishTest() {
  testState.endTime = new Date();
  console.log("Test complete. Running analysis...");

  const duration = (testState.endTime - testState.startTime) / 1000;
  const analysisResults = mcifAnalysis.run(testState, schema, weights);

  displayResults(analysisResults, duration);
}

// 🔹 Display Results
function displayResults(results, duration) {
  const container = document.getElementById('test-container');
  container.innerHTML = `
    <h2>Meta-Cognition Test Results</h2>
    <p><strong>Total Duration:</strong> ${duration.toFixed(2)} seconds</p>
    <h3>Your Archetype: ${results.archetype}</h3>
    <p><strong>Composite Score:</strong> ${results.composite.toFixed(2)}</p>
    <div id="scoreBreakdown"></div>
  `;

  const breakdownDiv = document.getElementById('scoreBreakdown');
  for (let [phase, score] of Object.entries(results.phaseScores)) {
    const item = document.createElement('p');
    item.textContent = `${phase}: ${score.toFixed(2)} / 100`;
    breakdownDiv.appendChild(item);
  }

  const feedback = document.createElement('p');
  feedback.className = 'feedback';
  feedback.textContent = results.feedback;
  container.appendChild(feedback);
}

// 🔹 Event Listener for DOM
document.addEventListener('DOMContentLoaded', initializeApp);

// Export (optional, if modularized)
export { initializeApp, handleNextPhase, finishTest, testState };

