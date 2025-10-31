/* ==========================================================
   engine/logic.js
   MCIF 7.1 — Core Logic Engine (AI Integration Mode: Hugging Face)
   Enterprise-grade, hybrid output (text + json)
   Author: Hayden Andrew Carr | Meta-Cognitive Intelligence Project
   Date: 2025-10-31
   ========================================================== */

/*
  Design notes:
  - Exposes window.MCIF API used by UI:
      MCIF.init()
      MCIF.loadQuestion(index)
      MCIF.totalQuestions()
      MCIF.recordResponse(index, answer)
      MCIF.analyze() -> returns final results object (promise)
  - Loads schema from /schema/mcif-schema.json (fallbacks supported)
  - Loads weights from /weights.json or /data/weights.json
  - Query adapter: huggingface endpoint (placeholder)
      - Accepts both text and json responses
      - If no endpoint/key, falls back to local stub synthesis
  - Keeps ledger events in localStorage key "MCIF_Ledger"
  - Attempts to call window.MCIF_Analysis.analyzeResponses(state) if present,
    otherwise runs internal analysis pipeline.
*/

(function () {
  // ---------------------------
  // Configuration & Constants
  // ---------------------------
  const DEFAULT_HF_ENDPOINT = "https://huggingface.co/api/meta-cognition"; // placeholder
  const HF_DEFAULT_ACCEPT = "application/json, text/plain"; // accept both
  const LEDGER_KEY = "MCIF_Ledger_v1";
  const SESSION_KEY = "MCIF_Session_v1";
  const WEIGHTS_PATHS = ["./weights.json", "./data/weights.json", "./schema/weights.json"];
  const SCHEMA_PATHS = ["./schema/mcif-schema.json", "./schema/mcif-schema.min.json", "./mcif-schema.json"];

  // ---------------------------
  // Internal state object
  // ---------------------------
  const state = {
    schema: null,
    weights: null,
    session: {
      id: null,
      createdAt: null,
      userAgent: navigator.userAgent,
      currentPhaseIndex: 0,
      responses: [], // {phaseId, promptId, response, startTime, endTime}
      meta: {},
    },
    adapters: {
      ai: {
        enabled: true,
        endpoint: DEFAULT_HF_ENDPOINT,
        authHeader: null, // set if user provides key later
        timeoutMs: 15000,
        rateLimitPerMin: 60,
      },
    },
    ledger: loadLedger(),
    analyticsCache: null,
  };

  // ---------------------------
  // Utility helpers
  // ---------------------------
  function nowISO() {
    return new Date().toISOString();
  }

  function uid(prefix = "mcif") {
    return `${prefix}_${Math.random().toString(36).slice(2, 9)}_${Date.now()}`;
  }

  function safeLog(...args) {
    console.debug("[MCIF]", ...args);
  }

  function persistSession() {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(state.session));
    } catch (e) {
      console.warn("MCIF: could not persist session", e);
    }
  }

  function loadSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      console.warn("MCIF: failed to load session", e);
      return null;
    }
  }

  function saveLedgerEntry(event, type = "info", data = {}) {
    const entry = {
      id: uid("ledger"),
      timestamp: nowISO(),
      event,
      type,
      data,
    };
    state.ledger.push(entry);
    try {
      localStorage.setItem(LEDGER_KEY, JSON.stringify(state.ledger));
    } catch (e) {
      console.warn("MCIF: ledger save failed", e);
    }
    safeLog("Ledger:", event, type, data);
  }

  function loadLedger() {
    try {
      const raw = localStorage.getItem(LEDGER_KEY);
      if (!raw) return [];
      return JSON.parse(raw);
    } catch (e) {
      return [];
    }
  }

  // shallow copy helper
  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  // String tokenization (simple)
  function tokenize(text) {
    if (!text) return [];
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean);
  }

  // Count keyword matches
  function keywordScore(text, keywords = []) {
    if (!text) return 0;
    const tokens = tokenize(text);
    if (!keywords || keywords.length === 0) return Math.min(1, tokens.length / 50); // fallback: length heuristic
    const kw = keywords.map((k) => k.toLowerCase());
    let matches = 0;
    for (const t of tokens) {
      if (kw.includes(t)) matches++;
    }
    return Math.min(1, matches / Math.max(1, kw.length));
  }

  // Coherence heuristic (deterministic)
  function coherenceHeuristic(text) {
    if (!text) return 0;
    const sentences = text.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
    const connectiveTokens = ["therefore", "because", "thus", "however", "thereby", "consequently"];
    const connectiveCount = connectiveTokens.reduce((acc, tok) => acc + (text.toLowerCase().includes(tok) ? 1 : 0), 0);
    const avgSentenceLen = sentences.length ? Math.min(40, text.split(/\s+/).length / sentences.length) : 0;
    const connectiveRatio = sentences.length ? connectiveCount / sentences.length : 0;
    // normalize: connectiveRatio (0..1), avgSentenceLen / 40 (0..1)
    const score = 0.5 * Math.min(1, connectiveRatio) + 0.5 * Math.min(1, avgSentenceLen / 40);
    return Math.max(0, Math.min(1, score));
  }

  // Basic sentiment-ish tonal heuristic (not ML)
  function simpleTone(text) {
    if (!text) return "neutral";
    const t = text.toLowerCase();
    if (/\b(angry|frustrat|annoy)\b/.test(t)) return "agitated";
    if (/\b(happy|joy|gratef|excited)\b/.test(t)) return "positive";
    if (/\b(sad|down|depress|tired)\b/.test(t)) return "low";
    return "neutral";
  }

  // ---------------------------
  // Schema & Weights loading
  // ---------------------------
  async function loadJSONFromPaths(paths = []) {
    for (const p of paths) {
      try {
        const resp = await fetch(p, { cache: "no-store" });
        if (!resp.ok) continue;
        const json = await resp.json();
        safeLog("Loaded JSON:", p);
        return { path: p, json };
      } catch (e) {
        // try next
      }
    }
    return null;
  }

  async function loadSchemaAndWeights() {
    const schemaCandidate = await loadJSONFromPaths(SCHEMA_PATHS);
    if (!schemaCandidate) {
      saveLedgerEntry("schema_load_failed", "error", { tried: SCHEMA_PATHS });
      throw new Error("MCIF: schema not found in expected paths.");
    }
    state.schema = schemaCandidate.json;
    saveLedgerEntry("schema_loaded", "info", { path: schemaCandidate.path, version: state.schema?.meta?.version || "unknown" });

    const weightsCandidate = await loadJSONFromPaths(WEIGHTS_PATHS);
    if (!weightsCandidate) {
      // weights optional — allow operation with default normalized weights
      saveLedgerEntry("weights_load_missing", "warning", { tried: WEIGHTS_PATHS });
      state.weights = generateDefaultWeights();
    } else {
      state.weights = weightsCandidate.json;
      saveLedgerEntry("weights_loaded", "info", { path: weightsCandidate.path });
    }
  }

  function generateDefaultWeights() {
    // If user didn't provide weights.json, derive from schema primary metrics equally.
    const defaultW = { version: "auto", phases: {} };
    if (state.schema && Array.isArray(state.schema.phases)) {
      const phases = state.schema.phases;
      const phaseWeight = 1 / phases.length;
      for (const p of phases) {
        defaultW.phases[p.id || p.name || `phase_${p.index}`] = {
          weight: phaseWeight,
          sub_dimensions: {},
        };
      }
    }
    return defaultW;
  }

  // ---------------------------
  // Session management
  // ---------------------------
  function startNewSession(opts = {}) {
    state.session.id = uid("session");
    state.session.createdAt = nowISO();
    state.session.currentPhaseIndex = 0;
    state.session.responses = [];
    state.session.meta = Object.assign({}, opts);
    persistSession();
    saveLedgerEntry("session_created", "info", { sessionId: state.session.id });
  }

  function resumeLastSession() {
    const s = loadSession();
    if (s && s.id) {
      state.session = s;
      saveLedgerEntry("session_resumed", "info", { sessionId: state.session.id });
      return true;
    }
    return false;
  }

  // ---------------------------
  // Public API: loadQuestion, totalQuestions, recordResponse...
  // ---------------------------
  function totalQuestions() {
    // Use schema prompts if present; fallback to MCIFQuestions-like structure if no schema
    if (state.schema && Array.isArray(state.schema.prompts)) return state.schema.prompts.length;
    // fallback: check schema.phases and count prompts inside
    if (state.schema && Array.isArray(state.schema.phases)) {
      let count = 0;
      for (const p of state.schema.phases) {
        if (Array.isArray(p.prompts)) count += p.prompts.length;
        else if (Array.isArray(state.schema.prompts)) count += state.schema.prompts.length;
      }
      return Math.max(0, count);
    }
    return (state.session.responses && state.session.responses.length) || 0;
  }

  // Helper: resolve prompt object by a flat question index (0-based)
  function resolvePromptByIndex(flatIndex) {
    // if schema.prompts exists and is a flat array
    if (state.schema && Array.isArray(state.schema.prompts) && state.schema.prompts[flatIndex]) {
      return state.schema.prompts[flatIndex];
    }

    // otherwise iterate through phases and their prompts
    if (state.schema && Array.isArray(state.schema.phases)) {
      let cursor = 0;
      for (const phase of state.schema.phases) {
        const prompts = phase.prompts || [];
        for (const pid of prompts) {
          // prompts may reference prompt ids in schema.prompts
          const promptObj = state.schema.prompts?.find((p) => p.id === pid) || null;
          if (promptObj && cursor === flatIndex) return { prompt: promptObj, phase };
          if (!promptObj) {
            // Try matching by existing prompt arrays in schema (if prompts are embedded as objects)
            // if phase has prompt objects inline
            if (phase.prompts && Array.isArray(phase.prompts)) {
              const inline = phase.prompts[flatIndex - cursor];
              if (inline) return { prompt: inline, phase };
            }
          }
          cursor++;
        }
      }
    }

    // Last resort: return a generic stub prompt
    return {
      prompt: {
        id: `stub_${flatIndex}`,
        text: "Describe an everyday object as if perceiving it for the first time.",
        mapsToMetrics: [],
      },
      phase: state.schema && state.schema.phases ? state.schema.phases[0] : null,
    };
  }

  function loadQuestion(flatIndex) {
    const resolved = resolvePromptByIndex(flatIndex);
    if (!resolved) return null;
    return {
      index: flatIndex,
      prompt: resolved.prompt,
      phase: resolved.phase,
    };
  }

  function recordResponse(flatIndex, responseText, meta = {}) {
    const resolved = resolvePromptByIndex(flatIndex);
    const entry = {
      id: uid("resp"),
      flatIndex,
      promptId: resolved.prompt?.id || null,
      phaseId: resolved.phase?.id || resolved.phase?.name || null,
      response: responseText,
      startTime: meta.startTime || null,
      endTime: meta.endTime || nowISO(),
      durationMs: meta.durationMs || null,
      tokenCount: tokenize(responseText).length,
      tone: simpleTone(responseText),
    };
    state.session.responses[flatIndex] = entry;
    persistSession();
    saveLedgerEntry("response_recorded", "info", { flatIndex, promptId: entry.promptId, phaseId: entry.phaseId });
    return entry;
  }

  // ---------------------------
  // Scoring Kernel (local fallback)
  // ---------------------------
  function scoreResponse(entry) {
    // Each prompt may map to metrics with contribution weights in schema
    // We'll compute metric contributions then phasic aggregates -> composite
    const text = entry.response || "";
    const resolved = resolvePromptByIndex(entry.flatIndex);
    const prompt = resolved.prompt || {};
    const maps = prompt.mapsToMetrics || [];

    const metricContribs = {};
    if (maps.length === 0) {
      // fallback heuristic: length, coherence, keywords (limited)
      metricContribs["fallback_length"] = Math.min(1, (tokenize(text).length / 100));
      metricContribs["fallback_coherence"] = coherenceHeuristic(text);
    } else {
      for (const m of maps) {
        // m: { metricId, contributionWeight }
        const metricId = m.metricId || m.id || "unknown_metric";
        const kwWeight = (prompt.scoringHints?.keywordWeight) || 0.5;
        const keywords = prompt.scoringHints?.keywords || [];
        const kwScore = keywordScore(text, keywords);
        const coh = coherenceHeuristic(text);
        // simple blended score
        const raw = kwScore * kwWeight + coh * (1 - kwWeight);
        metricContribs[metricId] = Math.max(0, Math.min(1, raw * (m.contributionWeight || 1)));
      }
    }

    return metricContribs;
  }

  function aggregatePhaseScores() {
    // produce normalized per-phase score in 0..1
    const phaseScores = {};
    if (!state.schema || !Array.isArray(state.schema.phases)) {
      return phaseScores;
    }

    // initialize
    for (const p of state.schema.phases) {
      const pid = p.id || p.name || `phase_${p.index}`;
      phaseScores[pid] = { sum: 0, weightSum: 0, normalized: 0 };
    }

    // For each recorded response, compute metric contributions and add to its phase
    for (const resp of (state.session.responses || [])) {
      if (!resp) continue;
      const contribs = scoreResponse(resp); // returns metric -> value
      const phaseId = resp.phaseId || "unknown";
      const weight = 1.0; // for now each response equal; schema could specify prompt weight
      const totalMetricVal = Object.values(contribs).reduce((a, b) => a + b, 0);
      phaseScores[phaseId] = phaseScores[phaseId] || { sum: 0, weightSum: 0, normalized: 0 };
      phaseScores[phaseId].sum += totalMetricVal * weight;
      phaseScores[phaseId].weightSum += weight;
    }

    // normalize per-phase by weightSum and some expected scale
    for (const pid of Object.keys(phaseScores)) {
      const p = phaseScores[pid];
      p.normalized = p.weightSum > 0 ? Math.min(1, p.sum / (p.weightSum * 1.0)) : 0;
    }

    return phaseScores; // { phaseId: {sum, weightSum, normalized} }
  }

  // Compute composite using weights.json
  function computeComposite(phaseScores) {
    // phaseScores normalised 0..1
    const weights = state.weights && state.weights.phases ? state.weights.phases : null;
    let composite = 0;
    let totalW = 0;

    if (weights) {
      for (const pid in phaseScores) {
        const wObj = weights[pid] || weights[ phaseIdByName(pid) ] || { weight: 1/Math.max(1,Object.keys(phaseScores).length) };
        const w = wObj.weight || 0;
        composite += (phaseScores[pid].normalized || 0) * w;
        totalW += w;
      }
      if (totalW > 0) composite = composite / totalW;
    } else {
      // uniform average
      const vals = Object.values(phaseScores).map((p) => p.normalized || 0);
      composite = vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : 0;
    }

    return Math.max(0, Math.min(1, composite));
  }

  function phaseIdByName(name) {
    // helper to match typical naming differences
    if (!state.schema) return name;
    const p = state.schema.phases.find(ph => (ph.id === name || ph.name === name));
    return p ? (p.id || p.name) : name;
  }

  // ---------------------------
  // Archetype inference (simple rule-based using weights.archetypes)
  // ---------------------------
  function inferArchetype(phaseScores) {
    const archetypes = state.weights?.archetypes || {};
    const scores = {};
    for (const [arch, config] of Object.entries(archetypes)) {
      const bias = config.bias_vector || [];
      // map bias vector to available phaseScores order (if lengths mismatch, use sum)
      const phaseIds = Object.keys(phaseScores);
      let alignment = 0;
      if (bias.length === phaseIds.length) {
        for (let i = 0; i < phaseIds.length; i++) {
          alignment += (phaseScores[phaseIds[i]].normalized || 0) * bias[i];
        }
      } else {
        // fallback: average of phase normalized * average bias
        const avgBias = bias.length ? (bias.reduce((a,b)=>a+b,0)/bias.length) : 1;
        const avgPhase = phaseIds.length ? (phaseIds.reduce((a,b)=>a+(phaseScores[b].normalized||0),0)/phaseIds.length) : 0;
        alignment = avgBias * avgPhase;
      }
      scores[arch] = Math.max(0, Math.min(1, alignment));
    }
    // pick max
    const best = Object.entries(scores).sort((a,b)=>b[1]-a[1])[0] || ['',0];
    return { archetype: best[0], scores };
  }

  // ---------------------------
  // AI Adapter: hugging face (hybrid output)
  // ---------------------------
  async function queryAIEngine({ prompt, userResponse, metadata = {}, acceptBoth = true } = {}) {
    // If adapter disabled or endpoint missing, return stub
    if (!state.adapters.ai.enabled || !state.adapters.ai.endpoint) {
      saveLedgerEntry("ai_adapter_disabled", "warning", {});
      return aiStub({ prompt, userResponse });
    }

    // Build payload sensibly: include prompt text, user response and schema context
    const payload = {
      prompt: prompt?.text || prompt?.prompt || String(prompt || ""),
      response: userResponse || "",
      context: {
        sessionId: state.session.id,
        phaseId: metadata.phaseId || null,
        promptId: metadata.promptId || null,
        timestamp: nowISO(),
      },
      requestMeta: {
        want: acceptBoth ? ["json", "text"] : ["json"]
      }
    };

    const headers = {
      "Accept": HF_DEFAULT_ACCEPT,
      "Content-Type": "application/json"
    };
    if (state.adapters.ai.authHeader) {
      headers["Authorization"] = state.adapters.ai.authHeader;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), state.adapters.ai.timeoutMs);

    try {
      const resp = await fetch(state.adapters.ai.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
        cache: "no-store"
      });

      clearTimeout(timeout);

      if (!resp.ok) {
        saveLedgerEntry("ai_query_failed", "error", { status: resp.status, url: state.adapters.ai.endpoint });
        return aiStub({ prompt, userResponse });
      }

      // Try to parse JSON, but be tolerant: huggingface might return text
      const contentType = resp.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const json = await resp.json();
        // Expect structure: { text: "...", analysis: {...} } or similar
        saveLedgerEntry("ai_query_success_json", "info", { url: state.adapters.ai.endpoint });
        return { ok: true, raw: json, text: json.text || "", json: json.analysis || json };
      } else {
        const txt = await resp.text();
        // If acceptBoth, we can attempt to extract JSON blob within text
        let maybeJson = null;
        try {
          const jstart = txt.indexOf("{");
          if (jstart >= 0) {
            const substr = txt.slice(jstart);
            maybeJson = JSON.parse(substr);
          }
        } catch (e) {
          maybeJson = null;
        }
        saveLedgerEntry("ai_query_success_text", "info", { url: state.adapters.ai.endpoint });
        return { ok: true, raw: txt, text: txt, json: maybeJson };
      }
    } catch (e) {
      clearTimeout(timeout);
      saveLedgerEntry("ai_query_exception", "error", { message: e.message });
      return aiStub({ prompt, userResponse });
    }
  }

  // Local AI stub: deterministic lightweight feedback
  function aiStub({ prompt, userResponse } = {}) {
    const text = `Reflection: You focused on ${simpleTone(userResponse)} tone and ${tokenize(userResponse).length} tokens. Try naming 2 concrete actions.`;
    const analysis = {
      novelty: Math.min(1, tokenize(userResponse).length / 80),
      coherence: coherenceHeuristic(userResponse),
      tone: simpleTone(userResponse),
    };
    saveLedgerEntry("ai_stub_used", "info", { reason: "no_adapter", analysis });
    return Promise.resolve({ ok: true, raw: { text, analysis }, text, json: analysis });
  }

  // ---------------------------
  // Analysis orchestration
  // ---------------------------
  async function analyzeResponsesAndReturnReport() {
    // Prefer external analysis module if provided (window.MCIF_Analysis.analyzeResponses)
    saveLedgerEntry("analysis_start", "info", {});
    const external = window.MCIF_Analysis && typeof window.MCIF_Analysis.analyzeResponses === "function";

    const aggregated = aggregatePhaseScores();
    const composite = computeComposite(aggregated);
    const archetypeResult = inferArchetype(aggregated);
    const responseSummaries = (state.session.responses || []).map(r => ({
      flatIndex: r.flatIndex,
      promptId: r.promptId,
      phaseId: r.phaseId,
      tokenCount: r.tokenCount,
      tone: r.tone,
      short: (r.response || "").slice(0, 300)
    }));

    const localReport = {
      sessionId: state.session.id,
      timestamp: nowISO(),
      aggregated,
      composite, // 0..1
      compositePoints: Math.round(composite * (state.schema?.config?.reportScale?.totalPoints || 700)),
      archetype: archetypeResult.archetype,
      archetypeScores: archetypeResult.scores,
      responses: responseSummaries,
      notes: "Local analytic pipeline used."
    };

    if (external) {
      try {
        const ext = await window.MCIF_Analysis.analyzeResponses({ state: clone(state), localReport });
        saveLedgerEntry("analysis_external_used", "info", { provider: "MCIF_Analysis" });
        return ext;
      } catch (e) {
        saveLedgerEntry("analysis_external_failed", "error", { message: e.message });
        // fall back to local
      }
    }

    saveLedgerEntry("analysis_complete", "info", { composite: localReport.composite });
    return localReport;
  }

  // ---------------------------
  // Public orchestration methods
  // ---------------------------

  async function init(options = {}) {
    try {
      // merge options into adapters if provided
      if (options.adapters && options.adapters.ai) {
        state.adapters.ai = Object.assign({}, state.adapters.ai, options.adapters.ai);
        if (options.adapters.ai.key) {
          // user provided API key; map to Authorization header as needed
          state.adapters.ai.authHeader = `Bearer ${options.adapters.ai.key}`;
        }
      }

      await loadSchemaAndWeights();
      const resumed = resumeLastSession();
      if (!resumed) startNewSession(options.sessionMeta || {});
      saveLedgerEntry("engine_initialized", "info", { sessionId: state.session.id });
      return { ok: true, sessionId: state.session.id, schemaVersion: state.schema?.meta?.version || null };
    } catch (e) {
      saveLedgerEntry("engine_init_failed", "error", { message: e.message });
      throw e;
    }
  }

  function loadQuestionPublic(flatIndex) {
    // returns object the UI expects: { index, prompt: { id, text, ... }, phase }
    const q = loadQuestion(flatIndex);
    saveLedgerEntry("prompt_presented", "info", { index: flatIndex, promptId: q.prompt?.id });
    return q;
  }

  function totalQuestionsPublic() {
    return totalQuestions();
  }

  function recordResponsePublic(flatIndex, responseText, meta) {
    const entry = recordResponse(flatIndex, responseText, meta);
    // optionally invoke AI-adapter for immediate reflection
    (async () => {
      try {
        const ai = await queryAIEngine({ prompt: entry.prompt || {}, userResponse: responseText, metadata: { phaseId: entry.phaseId, promptId: entry.promptId } });
        saveLedgerEntry("ai_reflection_recorded", "info", { flatIndex, aiSummary: ai.text ? ai.text.slice(0,200) : null });
      } catch (e) {
        saveLedgerEntry("ai_reflection_error", "error", { message: e.message });
      }
    })();
    return entry;
  }

  async function analyzePublic() {
    const report = await analyzeResponsesAndReturnReport();
    saveLedgerEntry("report_generated", "info", { composite: report.composite });
    return report;
  }

  // Light admin helpers
  function setAIEndpoint(url) {
    state.adapters.ai.endpoint = url;
    saveLedgerEntry("ai_endpoint_set", "info", { url });
  }

  function setAIKey(key) {
    state.adapters.ai.authHeader = `Bearer ${key}`;
    saveLedgerEntry("ai_key_set", "info", { masked: typeof key === "string" ? `${key.slice(0,4)}...` : null });
  }

  function dumpState() {
    return clone(state);
  }

  function clearSession() {
    state.session = { id: null, createdAt: null, currentPhaseIndex: 0, responses: [], meta: {} };
    persistSession();
    saveLedgerEntry("session_cleared", "info", {});
  }

  // ---------------------------
  // Expose to window.MCIF
  // ---------------------------
  window.MCIF = window.MCIF || {};
  window.MCIF.Logic = {
    init,
    loadQuestion: loadQuestionPublic,
    totalQuestions: totalQuestionsPublic,
    recordResponse: recordResponsePublic,
    analyze: analyzePublic,
    setAIEndpoint,
    setAIKey,
    dumpState,
    clearSession
  };

  // Backwards compatibility (some UI modules expect MCIF.loadQuestion)
  window.MCIF.loadQuestion = loadQuestionPublic;
  window.MCIF.totalQuestions = totalQuestionsPublic;
  window.MCIF.recordResponse = recordResponsePublic;
  window.MCIF.analyze = analyzePublic;
  window.MCIF.init = init;

  // Auto-init attempt (non-blocking) if user didn't call explicitly
  (async () => {
    try {
      // initialization is optional and returns quickly if already done
      await init({});
      safeLog("MCIF engine auto-initialized (non-blocking).");
    } catch (e) {
      console.warn("MCIF engine auto-init failed (manual init recommended):", e.message);
    }
  })();

  // ---------------------------
  // End of engine
  // ---------------------------
})();
