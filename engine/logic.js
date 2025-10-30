/* ==========================================================
   MCIF 7.1 Cognitive Engine – logic.js
   Developed by Hayden Andrew Carr | Meta-Cognitive Intelligence Project
   ------------------------------------------------------------
   Description:
   Core logic engine for the Meta-Cognition Test.
   Reads mcif-schema.json, runs phase transitions,
   executes metrics and adaptive feedback logic.
   ========================================================== */

import { loadSchema, fetchPrompts, saveLedger } from './data.js';
import { analyzeResponses } from './analysis.js';

/* ==========================================================
   GLOBAL ENGINE CONTEXT
   ========================================================== */
export const MCIFEngine = {
  schema: null,
  state: {
    currentPhase: 0,
    userResponses: [],
    activeMetrics: {},
    archetypeProfile: {},
    ledger: [],
    isInitialized: false,
  },

  /* ==========================================================
     INITIALIZATION
     ========================================================== */
  async init() {
    try {
      this.schema = await loadSchema('/schema/mcif-schema.json');
      this.prompts = await fetchPrompts('/schema/prompts.json');
      this.state.isInitialized = true;

      console.log('%c[MCIF] Cognitive Engine Initialized', 'color:#00ffaa');
      this.logLedger('System initialized', 'system');
    } catch (error) {
      console.error('Initialization failed:', error);
      this.logLedger('Initialization failed', 'error');
    }
  },

  /* ==========================================================
     LEDGER LOGGING (TRANSPARENCY + ETHICAL TRACE)
     ========================================================== */
  logLedger(event, type = 'system', data = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      phase: this.getCurrentPhaseName(),
      event,
      type,
      data,
    };
    this.state.ledger.push(entry);
    saveLedger(this.state.ledger);
  },

  /* ==========================================================
     PHASE MANAGEMENT
     ========================================================== */
  getCurrentPhase() {
    return this.schema.phases[this.state.currentPhase];
  },

  getCurrentPhaseName() {
    const phase = this.getCurrentPhase();
    return phase ? phase.name : 'None';
  },

  async startPhase(index = 0) {
    this.state.currentPhase = index;
    const phase = this.getCurrentPhase();
    this.logLedger(`Starting phase: ${phase.name}`, 'phase_start');

    const intro = phase.introPrompt || this.prompts.phases[phase.name]?.intro;
    if (intro) this.displayPrompt(intro);
  },

  async nextPhase() {
    if (this.state.currentPhase < this.schema.phases.length - 1) {
      this.state.currentPhase++;
      await this.startPhase(this.state.currentPhase);
    } else {
      await this.completeTest();
    }
  },

  /* ==========================================================
     PROMPT + RESPONSE HANDLING
     ========================================================== */
  displayPrompt(promptText) {
    const event = new CustomEvent('displayPrompt', { detail: { promptText } });
    window.dispatchEvent(event);
  },

  async submitResponse(userInput) {
    const phase = this.getCurrentPhase();
    this.state.userResponses.push({
      phase: phase.name,
      response: userInput,
      timestamp: new Date().toISOString(),
    });

    this.logLedger(`User response recorded for ${phase.name}`, 'response', {
      userInput,
    });

    await this.evaluatePhase(userInput);
  },

  /* ==========================================================
     PHASE EVALUATION + ADAPTATION
     ========================================================== */
  async evaluatePhase(userInput) {
    const phase = this.getCurrentPhase();
    const metrics = phase.metrics || [];

    // Adaptive logic (simplified Bayesian process)
    for (let metric of metrics) {
      const weight = metric.weight || 1.0;
      const patternMatch = this.matchPattern(userInput, metric.keywords || []);
      const delta = patternMatch ? weight : -weight * 0.5;
      this.state.activeMetrics[metric.name] =
        (this.state.activeMetrics[metric.name] || 0) + delta;
    }

    this.logLedger(`Phase ${phase.name} evaluated`, 'evaluation', {
      metrics: this.state.activeMetrics,
    });

    // Archetype reflection
    this.updateArchetypeProfile();

    // Progression
    if (phase.autoAdvance) {
      await this.nextPhase();
    } else {
      this.displayPrompt(this.prompts.navigation.next);
    }
  },

  matchPattern(input, keywords) {
    const lower = input.toLowerCase();
    return keywords.some((k) => lower.includes(k.toLowerCase()));
  },

  /* ==========================================================
     ARCHETYPE + ADAPTIVE PROFILE UPDATE
     ========================================================== */
  updateArchetypeProfile() {
    const archetypes = this.schema.archetypes || [];
    for (let arch of archetypes) {
      let score = 0;
      for (let metric of arch.metrics) {
        score += (this.state.activeMetrics[metric] || 0) * (arch.weights[metric] || 1);
      }
      this.state.archetypeProfile[arch.name] = score;
    }

    this.logLedger('Archetype profile updated', 'archetype_update', {
      archetypeProfile: this.state.archetypeProfile,
    });
  },

  /* ==========================================================
     TEST COMPLETION + FINAL ANALYSIS
     ========================================================== */
  async completeTest() {
    const results = await analyzeResponses(this.state);
    this.logLedger('Test completed', 'system', { results });

    const event = new CustomEvent('testCompleted', { detail: { results } });
    window.dispatchEvent(event);
  },
};

/* ==========================================================
   AUTO-INITIALIZE WHEN PAGE LOADS
   ========================================================== */
window.addEventListener('DOMContentLoaded', async () => {
  await MCIFEngine.init();
});
