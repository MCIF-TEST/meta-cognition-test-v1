// app.js — MCIF 7.1 Frontend Orchestrator (ES module)
// Responsibilities:
//  - Bootstraps MCIFData + MCIFAnalysis + optional MCIFLogic
//  - Loads manifests (prompts, weights, schema)
//  - Creates and manages sessions (createSession, saveResponse, compute final report)
//  - Drives UI via MCIFUI (imported module)
//  - Mirrors analysis-first UX: show mirror -> show domain pills -> persist -> progress
//  - Writes ledger entries and stores audit-hash pointers via MCIFData
//  - Exposes debug hooks on window for easy inspection
//
// Usage: referenced as <script type="module" src="app.js"></script> in index.html

import MCIFUI from './ui.js';

const DEFAULT_PROMPTS_PATH = 'prompts/prompts.json';
const DEFAULT_WEIGHTS_PATH = 'config/weights.json';
const DEFAULT_SCHEMA_PATH = 'schema/mcif-schema.json';

const State = {
  session: null,
  prompts: null,
  weights: null,
  schema: null,
  currentPromptIndex: 0,
  sessionId: null,
  isPaused: false,
  startedAt: null,
  // caches
  promptOrder: [], // array of {phaseId, promptId}
  scoredPhases: [] // accumulated scored phase objects for final composite
};

// Simple logger — writes to MCIF UI dev console and console
function log(...args) {
  console.log('[MCIF APP]', ...args);
  try {
    MCIFUI && MCIFUI.debug && MCIFUI.debug(JSON.stringify(args, null, 2));
  } catch (e) {}
}

function error(...args) {
  console.error('[MCIF APP]', ...args);
  try { MCIFUI && MCIFUI.debug && MCIFUI.debug(JSON.stringify(args, null, 2)); } catch (e) {}
}

// small helper to fetch JSON
async function fetchJSON(path) {
  const r = await fetch(path, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`Failed to load ${path} — ${r.status}`);
  return r.json();
}

// Initialize everything: manifests, data layer, analysis engine, UI callbacks
export async function initApp(opts = {}) {
  try {
    log('Bootstrapping MCIF app — loading manifests');
    // load manifests in parallel
    const [prompts, weights, schema] = await Promise.all([
      fetchJSON(DEFAULT_PROMPTS_PATH).catch(e => { throw new Error('Prompts load failed: ' + e.message); }),
      fetchJSON(DEFAULT_WEIGHTS_PATH).catch(e => { throw new Error('Weights load failed: ' + e.message); }),
      fetchJSON(DEFAULT_SCHEMA_PATH).catch(e => { throw new Error('Schema load failed: ' + e.message); })
    ]);
    State.prompts = prompts;
    State.weights = weights;
    State.schema = schema;

    // initialize MCIFData (exposed as global MCIFData)
    if (!window.MCIFData) {
      throw new Error('MCIFData not found — ensure src/data/data.js is loaded before app.js');
    }
    // pick adapter intelligently (IndexedDB preferred)
    const adapterChoice = (typeof indexedDB !== 'undefined') ? 'indexeddb' : 'localstorage';
    await window.MCIFData.init({ adapter: adapterChoice, adapterOptions: {} });
    // inject a permissive validator for now; optionally swap with AJV
    window.MCIFData.injectValidator(async (obj, schemaName) => ({ valid: true }));

    // init analysis engine (global MCIFAnalysis)
    if (!window.MCIFAnalysis) {
      throw new Error('MCIFAnalysis not found — ensure src/analysis/analysis.js is loaded before app.js');
    }
    // analysis engine has init(weights, prompts) method? our analysis.js exposes `init` that accepts {weights, prompts}
    if (typeof window.MCIFAnalysis.init === 'function') {
      window.MCIFAnalysis.init({ weights: State.weights, prompts: State.prompts });
      // store prompts in analysis engine internals for scoring fallbacks
      window.MCIFAnalysis._prompts = State.prompts;
    }

    // optional logic module
    if (window.MCIF && typeof window.MCIF.init === 'function') {
      try {
        await window.MCIF.init();
      } catch (e) { log('MCIF Logic init failed (non-fatal):', e); }
    }

    // Initialize UI with callbacks
    MCIFUI.initUI({
      onStart: onStartSession,
      onSubmitResponse: onSubmitResponse,
      onFollowupClick: onFollowupClick,
      onExport: onExportSession,
      onDemo: onRunDemo,
      onPause: onPauseSession,
      onSkip: onSkipPrompt,
      onPhaseJump: onJumpToPhase
    });

    // initial render
    MCIFUI.renderPhases(1, 6);
    log('MCIF App initialized successfully.');
    // expose debug state
    window.__MCIF_STATE = State;
    return true;
  } catch (e) {
    error('Initialization failed', e);
    alert('Initialization error: ' + (e && e.message ? e.message : String(e)));
    throw e;
  }
}

// -----------------------------
// Session lifecycle callbacks
// -----------------------------

/**
 * onStartSession(cfg)
 * Creates session in MCIFData and transitions UI to session screen.
 */
async function onStartSession(cfg = {}) {
  try {
    log('Starting session', cfg);
    // Create session in data layer
    const sessionDoc = await window.MCIFData.createSession({
      ownerId: cfg.username || null,
      tier: cfg.tier || 'Explorer',
      mode: 'guided',
      privacy: { storePersonalData: false, retainLedgerHashOnly: true }
    });
    State.session = sessionDoc;
    State.sessionId = sessionDoc.session.id;
    State.startedAt = Date.now();
    State.currentPromptIndex = 0;
    State.scoredPhases = [];
    // Generate prompt order: we will present one prompt per phase using prompts manifest.
    generatePromptOrder();

    // UI shift: hide splash, show session screen
    document.getElementById('splash')?.classList.add('hidden');
    document.getElementById('session-screen')?.classList.remove('hidden');
    // render first prompt
    const first = getPromptForPhase(1);
    MCIFUI.renderPrompt(1, first);
    MCIFUI.setPhase(1);
    log('Session created', State.sessionId);
  } catch (e) {
    error('onStartSession error', e);
    alert('Could not start session: ' + e.message);
  }
}

/**
 * onRunDemo()
 * Run a short demo (does not persist permanently unless user chooses)
 */
async function onRunDemo() {
  try {
    log('Running demo session (transient)');
    // create ephemeral session with privacy strict
    const sessionDoc = await window.MCIFData.createSession({ ownerId: null, tier: 'Explorer', privacy: { storePersonalData: false, retainLedgerHashOnly: true } });
    State.session = sessionDoc;
    State.sessionId = sessionDoc.session.id;
    State.currentPromptIndex = 0;
    generatePromptOrder();
    // seed demo inputs? we'll just load first prompt
    document.getElementById('splash')?.classList.add('hidden');
    document.getElementById('session-screen')?.classList.remove('hidden');
    const first = getPromptForPhase(1);
    MCIFUI.renderPrompt(1, first);
    MCIFUI.setPhase(1);
    log('Demo started');
  } catch (e) {
    error('Demo error', e);
  }
}

// -----------------------------
// Prompt & Phase helpers
// -----------------------------
function generatePromptOrder() {
  // Use prompts manifest to map one canonical prompt per phase in order 1..6
  // prompts manifest structure assumed: prompts.prompts = [{id, phaseId, text, metadata}, ...]
  const list = (State.prompts && State.prompts.prompts) || [];
  State.promptOrder = [];
  for (let p = 1; p <= 6; p++) {
    // prefer prompt with prompt.phaseId === p and prompt.primary === true, else first with phaseId p
    let candidate = list.find(x => Number(x.phaseId) === p && x.primary === true) || list.find(x => Number(x.phaseId) === p);
    if (!candidate) {
      // fallback: generic text from white page for that phase
      candidate = { id: `phase${p}_fallback`, phaseId: p, text: fallbackPromptTextForPhase(p), metadata: { expected_length_tokens: 120 } };
    }
    State.promptOrder.push({ phaseId: p, prompt: candidate });
  }
  log('Prompt order generated', State.promptOrder.map(p => p.prompt.id));
}

function fallbackPromptTextForPhase(p) {
  const map = {
    1: 'Describe an everyday object as if perceived for the first time.',
    2: 'Design a sustainable fix for a team missing deadlines.',
    3: 'Explain why scrolling your phone eases pre-speech anxiety.',
    4: 'You understand your patterns but rarely act; what blocks you?',
    5: 'Invent a new form of intelligence measurement superior to IQ.',
    6: 'Is human potential fixed or ever-expanding?'
  };
  return map[p] || 'Reflect on this prompt.';
}

function getPromptForPhase(phaseNum) {
  const entry = State.promptOrder.find(p => Number(p.phaseId) === Number(phaseNum));
  return entry ? entry.prompt : { id: `phase${phaseNum}_blank`, phaseId: phaseNum, text: fallbackPromptTextForPhase(phaseNum), metadata: {} };
}

// -----------------------------
// Submission flow: mirror-first -> persist -> progress
// -----------------------------
/**
 * onSubmitResponse(responseObj)
 * Called by UI when user submits text. This function:
 *  1. Calls MCIFAnalysis.scoreResponse(...) to get raw metrics + mirror explanation
 *  2. Shows mirror and domain scores immediately in UI
 *  3. Persists response (with attached analysis) via MCIFData.saveResponse
 *  4. Appends to local scoredPhases to be used in final composite
 *  5. Returns object expected by UI: { mirrorText, domainScores, followups }
 */
async function onSubmitResponse(responseObj) {
  try {
    log('Received response from UI', responseObj);

    // 1) Analysis — prepare a phaseDef for deeper scoring (we derive metrics from white page)
    const phaseNum = Number(responseObj.phaseId || responseObj.phase || 1);
    const phaseDef = makePhaseDefinition(phaseNum);

    // Use MCIFAnalysis.scoreResponse (returns rawMetrics, subScores, probabilities, explanations, psycholinguistic)
    let analysisResult = null;
    try {
      analysisResult = await window.MCIFAnalysis.scoreResponse(responseObj, phaseDef, { weightSet: State.weights });
    } catch (err) {
      log('analysis.scoreResponse failed — building fallback analysis', err);
      analysisResult = { rawMetrics: {}, subScores: {}, probabilities: { coherence: 0.5, novelty: 0.3 }, explanations: [{ metric: 'mirror', reason: 'Unable to analyze automatically.' }], psycholinguistic: {} };
    }

    // extract a mirror explanation (prioritize analysis.explanations mirror entry)
    let mirrorText = extractMirrorFromAnalysis(analysisResult);
    if (!mirrorText) {
      mirrorText = `You produced ${analysisResult.psycholinguistic && analysisResult.psycholinguistic.tokens || 'some'} words. Coherence proxy: ${Math.round((analysisResult.probabilities && analysisResult.probabilities.coherence || 0.5) * 100)}%.`;
    }

    // compute domainScores mapping for UI pills — convert analysisResult.domainContributions into readable scores
    const domainScores = mapDomainContributionsToDomainScores(analysisResult.domainContributions || {}, State.weights);

    // maybe produce followups (simple heuristic: if novelty high but coherence low -> ask clarifying question)
    const followups = generateFollowupsFromAnalysis(analysisResult);

    // 2) UI: show mirror immediately, show scores and followups
    MCIFUI.showMirror(mirrorText);
    MCIFUI.showScores(domainScores);
    MCIFUI.showFollowups(followups);

    // 3) Persist: attach analysis into responseObj then MCIFData.saveResponse
    const responseWithAnalysis = Object.assign({}, responseObj, { analysis: analysisResult });
    const saveResult = await window.MCIFData.saveResponse(State.sessionId, responseWithAnalysis);
    log('Response persisted', saveResult && saveResult.ledgerEntry && saveResult.ledgerEntry.hash);

    // 4) accumulate scoredPhases structure for composite: phase-level aggregation
    const scoredPhase = {
      phaseId,
      domainContributions: analysisResult.domainContributions || {},
      subScores: analysisResult.subScores || {},
      probabilities: analysisResult.probabilities || {},
      responses: [{ id: responseWithAnalysis.id, text: responseWithAnalysis.text, analysis: analysisResult }],
      timestamps: responseWithAnalysis.timestamps || {}
    };
    State.scoredPhases.push(scoredPhase);

    // optional: create a ledger entry in data layer marking analysis event (analysis engine also creates, but double write is fine & auditable)
    await window.MCIFData.appendLedgerEntry({
      actor: 'frontend',
      action: 'RESPONSE_ANALYZED',
      sessionId: State.sessionId,
      payload: { responseId: responseWithAnalysis.id, phaseId },
      rationale: 'Front-end persisted response and analysis'
    }, State.session.session.config.privacy);

    // 5) progress to next phase or complete
    const currentPhaseInOrder = phaseNum;
    if (currentPhaseInOrder < 6) {
      // advance
      const nextPhase = currentPhaseInOrder + 1;
      // small delay to let user read mirror, then present next prompt
      setTimeout(() => {
        const nextPrompt = getPromptForPhase(nextPhase);
        MCIFUI.renderPrompt(nextPhase, nextPrompt);
        MCIFUI.setPhase(nextPhase);
        // persist phase progress update (optional)
      }, 900);
    } else {
      // complete session: run final composite computation and show report
      await finalizeSessionAndShowReport();
    }

    // return object for UI to display more context if needed
    return { mirrorText, domainScores, followups, persistedResponse: responseWithAnalysis };
  } catch (err) {
    error('onSubmitResponse error', err);
    return { mirrorText: 'Error processing response', domainScores: {}, followups: [] };
  }
}

// -----------------------------
// Utilities used by onSubmitResponse
// -----------------------------

function makePhaseDefinition(phaseNum) {
  // Build a phaseDef consistent with analysis.js expectations (metrics/submetrics/domains)
  // Use white page mapping
  const phaseMap = {
    1: { id: 1, name: 'Perceptual Awareness', metrics: [{ id: 'detail', name: 'Detail' }, { id: 'sensoryEmotionLink', name: 'Sensory-Emotion Link' }, { id: 'conceptDepth', name: 'Concept Depth' }], submetrics: { detail: 0.5, sensoryEmotionLink: 0.3, conceptDepth: 0.2 }, domains: ['perception', 'philosophy'] },
    2: { id: 2, name: 'Cognitive Mechanics', metrics: [{ id: 'logic', name: 'Logic' }, { id: 'systems', name: 'Systems Thinking' }, { id: 'practicalCreativity', name: 'Practical Creativity'}], submetrics: { logic:0.4, systems:0.35, practicalCreativity:0.25 }, domains: ['logic','adaptability'] },
    3: { id: 3, name: 'Emotive Intelligence', metrics: [{id:'emotionalIdentification',name:'Emotional Identification'},{id:'causalInsight',name:'Causal Insight'},{id:'selfCompassion',name:'Self-Compassion'}], submetrics:{emotionalIdentification:0.3,causalInsight:0.4,selfCompassion:0.3}, domains:['emotion','metaAwareness'] },
    4: { id: 4, name: 'Meta-Cognitive Insight', metrics: [{id:'metaAwareness',name:'Meta-Awareness'},{id:'processDiagnosis',name:'Process Diagnosis'},{id:'remedyClarity',name:'Remedy Clarity'}], submetrics:{metaAwareness:0.4,processDiagnosis:0.4,remedyClarity:0.2}, domains:['metaAwareness','adaptability'] },
    5: { id: 5, name: 'Creative Intelligence', metrics: [{id:'novelty',name:'Novelty'},{id:'coherence',name:'Coherence'},{id:'integration',name:'Integration'}], submetrics:{novelty:0.4,coherence:0.3,integration:0.3}, domains:['creativity','philosophy'] },
    6: { id: 6, name: 'Philosophical Depth', metrics: [{id:'depth',name:'Depth'},{id:'logicalConsistency',name:'Logical Consistency'},{id:'existentialClarity',name:'Existential Clarity'}], submetrics:{depth:0.4,logicalConsistency:0.3,existentialClarity:0.3}, domains:['philosophy','metaAwareness'] }
  };
  return phaseMap[phaseNum] || phaseMap[1];
}

function extractMirrorFromAnalysis(analysisResult) {
  // Scan explanations array for metric 'mirror' or first explanation reason
  try {
    const ex = analysisResult.explanations || [];
    const mirror = ex.find(e => String(e.metric).toLowerCase() === 'mirror');
    if (mirror) return mirror.reason;
    // else return first explanation reason trimmed
    if (ex.length > 0) return ex[0].reason || '';
  } catch (e) {}
  return null;
}

function mapDomainContributionsToDomainScores(domainContribs = {}, weights) {
  // We expect domainContribs values 0..1; multiply by 100 for display
  const mapped = {};
  const domainKeys = Object.keys(weights.domains || {});
  domainKeys.forEach(d => {
    const val = Number(domainContribs[d] || 0);
    mapped[d] = Math.round(val * 100 * 100) / 100; // keep two decimals
  });
  // include any other keys
  Object.keys(domainContribs).forEach(k => {
    if (!mapped[k]) mapped[k] = Math.round(Number(domainContribs[k] || 0) * 100 * 100) / 100;
  });
  return mapped;
}

function generateFollowupsFromAnalysis(analysisResult) {
  const f = [];
  try {
    const coherence = analysisResult.probabilities && analysisResult.probabilities.coherence || 0.5;
    const novelty = analysisResult.probabilities && analysisResult.probabilities.novelty || 0.2;
    // heuristics
    if (coherence < 0.4) f.push({ id: 'clarify_1', text: 'Could you clarify the causal link you mentioned?' });
    if (novelty > 0.6 && coherence > 0.45) f.push({ id: 'expand_1', text: 'Can you expand on that metaphor?' });
    // encourage meta action if metaAwareness low
    if (analysisResult.rawMetrics && analysisResult.rawMetrics.metaAwareness && analysisResult.rawMetrics.metaAwareness < 0.2) {
      f.push({ id: 'meta_probe', text: 'What made you notice that pattern?' });
    }
  } catch (e) {}
  return f;
}

// -----------------------------
// Followup click -> place text in input or generate a micro-prompt
async function onFollowupClick(followup) {
  log('Followup clicked', followup);
  // If followup is a clarification, place into the input as a prompt
  const input = document.getElementById('response-input');
  if (input) {
    input.value = (input.value || '') + (input.value ? '\n\n' : '') + `Follow-up: ${followup.text}`;
    focusAndScroll(input);
  }
  // Optionally call a server hook
  if (typeof window.MCIFData !== 'undefined') {
    await window.MCIFData.appendLedgerEntry({
      actor: 'frontend',
      action: 'FOLLOWUP_CLICK',
      sessionId: State.sessionId,
      payload: { followupId: followup.id, text: followup.text },
      rationale: 'User engaged followup'
    }, State.session.session.config.privacy);
  }
}

// -----------------------------
// Finalize & reporting
// -----------------------------
async function finalizeSessionAndShowReport() {
  try {
    log('Finalizing session — computing composite report');
    // compute and persist final report via DataLayer (which calls analysis engine)
    const result = await window.MCIFData.computeAndPersistReport(State.sessionId, window.MCIFAnalysis);
    log('Final report saved', result && result.finalReport);

    // UI: show report (hide session screen)
    document.getElementById('session-screen')?.classList.add('hidden');
    const reportScreen = document.getElementById('report-screen');
    if (reportScreen) reportScreen.classList.remove('hidden');

    // render via UI
    MCIFUI.renderReport(result.finalReport);

    // attach download handler
    document.getElementById('btn-download-report')?.addEventListener('click', () => {
      // produce JSON blob and download
      const blob = new Blob([JSON.stringify(result.finalReport, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `MCIF_Report_${State.sessionId}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });

    log('Report rendered to UI');
  } catch (e) {
    error('finalizeSessionAndShowReport error', e);
    alert('Failed to compute final report: ' + (e.message || e));
  }
}

// -----------------------------
// Export / ledger / pause / skip
// -----------------------------
async function onExportSession() {
  try {
    log('Export session requested');
    const exportObj = await window.MCIFData.exportSessionAsJSON(State.sessionId, { includeLedger: true, anonymize: true });
    const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `MCIF_Session_${State.sessionId}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    log('Export complete');
  } catch (e) {
    error('Export failed', e);
    alert('Export failed: ' + e.message);
  }
}

async function onPauseSession() {
  State.isPaused = !State.isPaused;
  log('Pause toggled', State.isPaused);
  if (State.isPaused) {
    // write ledger marker
    await window.MCIFData.appendLedgerEntry({
      actor: 'frontend',
      action: 'SESSION_PAUSE',
      sessionId: State.sessionId,
      payload: {},
      rationale: 'User paused session'
    }, State.session.session.config.privacy);
  } else {
    await window.MCIFData.appendLedgerEntry({
      actor: 'frontend',
      action: 'SESSION_RESUME',
      sessionId: State.sessionId,
      payload: {},
      rationale: 'User resumed session'
    }, State.session.session.config.privacy);
  }
}

async function onSkipPrompt(phaseNum) {
  try {
    // progress to next phase if available
    const next = Math.min(6, Number(phaseNum) + 1);
    if (next <= 6) {
      const nextPrompt = getPromptForPhase(next);
      MCIFUI.renderPrompt(next, nextPrompt);
      MCIFUI.setPhase(next);
    }
    // ledger
    await window.MCIFData.appendLedgerEntry({
      actor: 'frontend',
      action: 'PROMPT_SKIPPED',
      sessionId: State.sessionId,
      payload: { phaseId: phaseNum },
      rationale: 'User skipped prompt'
    }, State.session.session.config.privacy);
  } catch (e) { error('skip error', e); }
}

// allow jumping to earlier phases if app supports it
function onJumpToPhase(phaseNum) {
  const p = Math.max(1, Math.min(6, Number(phaseNum)));
  const prompt = getPromptForPhase(p);
  MCIFUI.renderPrompt(p, prompt);
  MCIFUI.setPhase(p);
  log('Jumped to phase', p);
}

// -----------------------------
// small helpers
// -----------------------------
function focusAndScroll(elm) {
  try { elm.focus(); elm.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
}

// -----------------------------
// Expose a ready entry on window for convenience (dev)
window.MCIFApp = {
  init: initApp,
  state: State,
  finalize: finalizeSessionAndShowReport
};

// Auto init on load
document.addEventListener('DOMContentLoaded', async () => {
  try {
    await initApp();
  } catch (e) {
    error('App auto-init failed', e);
  }
});
