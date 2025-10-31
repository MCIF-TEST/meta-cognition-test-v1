// ================================
// MCIF Meta-Cognition Test v1
// Core App Controller
// ================================

import { renderQuestion, showResults } from './ui.js';
import { analyzeResults } from './engine/analysis.js';

// Global state
let schema = null;
let currentIndex = 0;
let userResponses = [];

// --------------------
// INITIALIZATION
// --------------------
window.addEventListener('DOMContentLoaded', async () => {
  try {
    const response = await fetch('./schema/mcif-schema.json');
    schema = await response.json();
    console.log('Schema loaded:', schema);

    document.getElementById('startBtn').addEventListener('click', startTest);
    document.getElementById('nextBtn').addEventListener('click', nextQuestion);
    document.getElementById('prevBtn').addEventListener('click', prevQuestion);
    document.getElementById('submitBtn').addEventListener('click', submitTest);
    document.getElementById('restartBtn').addEventListener('click', restartTest);
  } catch (err) {
    console.error('Error loading schema:', err);
  }
});

// --------------------
// CORE FUNCTIONS
// --------------------

function startTest() {
  document.getElementById('intro').classList.add('hidden');
  document.getElementById('test').classList.remove('hidden');
  renderQuestion(schema.questions[currentIndex], currentIndex);
}

function nextQuestion() {
  saveResponse();
  if (currentIndex < schema.questions.length - 1) {
    currentIndex++;
    renderQuestion(schema.questions[currentIndex], currentIndex);
  }
  updateButtons();
}

function prevQuestion() {
  saveResponse();
  if (currentIndex > 0) {
    currentIndex--;
    renderQuestion(schema.questions[currentIndex], currentIndex);
  }
  updateButtons();
}

function updateButtons() {
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  const submitBtn = document.getElementById('submitBtn');

  prevBtn.disabled = currentIndex === 0;
  nextBtn.classList.toggle('hidden', currentIndex >= schema.questions.length - 1);
  submitBtn.classList.toggle('hidden', currentIndex < schema.questions.length - 1);
}

function saveResponse() {
  const selected = document.querySelector('input[name="option"]:checked');
  if (selected) {
    userResponses[currentIndex] = {
      question: schema.questions[currentIndex].text,
      response: selected.value
    };
  }
}

async function submitTest() {
  saveResponse();
  const results = await analyzeResults(userResponses);
  showResults(results);
}

function restartTest() {
  currentIndex = 0;
  userResponses = [];
  document.getElementById('results').classList.add('hidden');
  document.getElementById('intro').classList.remove('hidden');
}

// --------------------
// EXPORTS
// --------------------
export { schema, userResponses };
