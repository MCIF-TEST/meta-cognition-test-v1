/* ==========================================================
   engine/analysis.js
   MCIF 7.1 — Enterprise Analysis Module (Hybrid AI + Local)
   - Accepts structured AI responses (JSON) or text and merges them
   - Exposes window.MCIF_Analysis.analyzeResponses(stateWrapper)
   - Loads and honors weights.json, supports Bayesian smoothing
   Author: Hayden Andrew Carr | Meta-Cognitive Intelligence Project
   Date: 2025-10-31
   ========================================================== */

(function () {
  const LEDGER_KEY = "MCIF_Ledger_v1";
  const WEIGHTS_PATHS = ["./weights.json", "./data/weights.json", "./schema/weights.json"];
  const DEFAULT_ROUND = 3;

  // Internal cache
  let weightsCache = null;

  // Utility helpers (shared pattern with logic.js)
  function safeLog(...args) {
    console.debug("[MCIF.Analysis]", ...args);
  }

  function nowISO() {
    return new Date().toISOString();
  }

  function uid(prefix = "ma") {
    return `${prefix}_${Math.random().toString(36).slice(2, 9)}_${Date.now()}`;
  }

  function loadLedger() {
    try {
      const raw = localStorage.getItem(LEDGER_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function appendLedger(event, type = "info", data = {}) {
    const ledger = loadLedger();
    ledger.push({ id: uid("ledger"), event, type, data, timestamp: nowISO() });
    try {
      localStorage.setItem(LEDGER_KEY, JSON.stringify(ledger));
    } catch (e) {
      console.warn("MCIF.Analysis: ledger save failed", e);
    }
  }

  // Safe JSON loader across candidate paths
  async function loadJSONCandidate(paths = []) {
    for (const p of paths) {
      try {
        const resp = await fetch(p, { cache: "no-store" });
        if (!resp.ok) continue;
        const json = await resp.json();
        safeLog("Loaded JSON:", p);
        return { path: p, json };
      } catch (e) {
        /* ignore and try next */
      }
    }
    return null;
  }

  // Load weights (synchronous wrapper that caches)
  async function loadWeights() {
    if (weightsCache) return weightsCache;
    const cand = await loadJSONCandidate(WEIGHTS_PATHS);
    if (cand && cand.json) {
      weightsCache = cand.json;
      appendLedger("weights_loaded", "info", { path: cand.path });
      return weightsCache;
    }
    // fallback default minimal weights
    const fallback = { version: "auto", phases: {}, archetypes: {}, normalization: { method: "minmax", scale_range: [0, 1], round_to: DEFAULT_ROUND } };
    appendLedger("weights_missing_fallback", "warning", {});
    weightsCache = fallback;
    return fallback;
  }

  // Numerical helpers
  function clamp01(v) { return Math.max(0, Math.min(1, v)); }
  function roundTo(v, n = DEFAULT_ROUND) { const f = Math.pow(10, n); return Math.round((v + Number.EPSILON) * f) / f; }

  // Bayesian smoothing helper: posterior = (prior*alpha + obs*beta) / (alpha + beta)
  function bayesianSmooth(prior, obs, alpha = 1, beta = 1) {
    const post = ((prior * alpha) + (obs * beta)) / (alpha + beta);
    return clamp01(post);
  }

  // normalize object values to 0..1 via min-max or soft-max
  function normalizeObject(obj, method = "minmax") {
    const keys = Object.keys(obj);
    const vals = keys.map(k => obj[k]);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const out = {};
    if (method === "minmax" && max > min) {
      for (const k of keys) out[k] = clamp01((obj[k] - min) / (max - min));
    } else {
      // fallback linear scaling (if all equal)
      const denom = max || 1;
      for (const k of keys) out[k] = clamp01(obj[k] / denom);
    }
    return out;
  }

  // merge two numeric maps with optional weight (primaryWins true -> primary has alpha)
  function mergeNumericMaps(primary = {}, secondary = {}, alpha = 1, beta = 0.5) {
    const keys = new Set([...Object.keys(primary), ...Object.keys(secondary)]);
    const out = {};
    for (const k of keys) {
      const p = (primary[k] !== undefined) ? primary[k] : 0;
      const s = (secondary[k] !== undefined) ? secondary[k] : 0;
      out[k] = bayesianSmooth(p, s, alpha, beta);
    }
    return out;
  }

  // Safe merge for archetype score maps
  function mergeArchetypeScores(localScores = {}, aiScores = {}, alpha = 1.2, beta = 0.8) {
    return mergeNumericMaps(localScores, aiScores, alpha, beta);
  }

  // Parse AI-provided analysis payloads and extract numeric dimensions and narrative
  function parseAIResponse(aiRaw) {
    // Accept multiple forms:
    // - { text: "...", analysis: { metricA: 0.5, ... } }
    // - raw JSON of metrics
    // - plain text with embedded JSON (attempt parse)
    if (!aiRaw) return { text: null, metrics: {}, archetypes: {} };

    try {
      // if it's a Response-like object from fetch, it should already have been parsed to json by logic.js
      if (typeof aiRaw === "string") {
        // attempt to find JSON blob
        const jstart = aiRaw.indexOf("{");
        if (jstart >= 0) {
          try {
            const maybe = JSON.parse(aiRaw.slice(jstart));
            // if contains analysis field
            if (maybe.analysis) return { text: aiRaw, metrics: maybe.analysis.metrics || maybe.analysis || {}, archetypes: maybe.analysis?.archetypes || {} };
            return { text: aiRaw, metrics: maybe.metrics || maybe, archetypes: maybe.archetypes || {} };
          } catch (e) {
            return { text: aiRaw, metrics: {}, archetypes: {} };
          }
        } else {
          return { text: aiRaw, metrics: {}, archetypes: {} };
        }
      } else if (typeof aiRaw === "object") {
        const text = aiRaw.text || aiRaw.summary || aiRaw.comment || null;
        const rawMetrics = aiRaw.analysis || aiRaw.metrics || aiRaw.json || {};
        const archetypes = aiRaw.archetypes || rawMetrics.archetypes || {};
        return { text, metrics: rawMetrics, archetypes };
      }
    } catch (e) {
      return { text: null, metrics: {}, archetypes: {} };
    }
    return { text: null, metrics: {}, archetypes: {} };
  }

  // Local metric derivation (from session responses) — conservative, explainable heuristics
  function deriveLocalMetricsFromResponses(state) {
    // Expected input: state.session.responses[] with {flatIndex, response, tokenCount, tone, phaseId}
    const metricMap = {}; // name -> numeric
    const phaseMap = {}; // phaseId -> { sums, count }

    const responses = (state.session && state.session.responses) ? state.session.responses.filter(Boolean) : [];
    for (const r of responses) {
      const text = r.response || "";
      const tokens = r.tokenCount || (text ? text.split(/\s+/).length : 0);
      const coherence = computeCoherence(text);
      const novelty = Math.min(1, tokens / 100); // rough
      const reflection = computeReflectionDepth(text);
      const clarity = computeClarity(text);
      // aggregate per-phase
      const pid = r.phaseId || "undefined_phase";
      phaseMap[pid] = phaseMap[pid] || { count: 0, sums: { coherence: 0, novelty: 0, reflection: 0, clarity: 0 } };
      phaseMap[pid].count++;
      phaseMap[pid].sums.coherence += coherence;
      phaseMap[pid].sums.novelty += novelty;
      phaseMap[pid].sums.reflection += reflection;
      phaseMap[pid].sums.clarity += clarity;
    }

    // compute per-phase normalized measures
    const perPhase = {};
    for (const pid of Object.keys(phaseMap)) {
      const obj = phaseMap[pid];
      const count = obj.count || 1;
      perPhase[pid] = {
        coherence: clamp01(obj.sums.coherence / count),
        novelty: clamp01(obj.sums.novelty / count),
        reflection: clamp01(obj.sums.reflection / count),
        clarity: clamp01(obj.sums.clarity / count),
      };
    }

    // create summary metrics (averages across phases)
    const dims = { coherence: 0, novelty: 0, reflection: 0, clarity: 0 }; let pcount = 0;
    for (const pid of Object.keys(perPhase)) {
      pcount++;
      dims.coherence += perPhase[pid].coherence;
      dims.novelty += perPhase[pid].novelty;
      dims.reflection += perPhase[pid].reflection;
      dims.clarity += perPhase[pid].clarity;
    }
    if (pcount > 0) {
      dims.coherence = clamp01(dims.coherence / pcount);
      dims.novelty = clamp01(dims.novelty / pcount);
      dims.reflection = clamp01(dims.reflection / pcount);
      dims.clarity = clamp01(dims.clarity / pcount);
    }

    // fill metricMap
    metricMap.coherence = dims.coherence;
    metricMap.novelty = dims.novelty;
    metricMap.reflection = dims.reflection;
    metricMap.clarity = dims.clarity;

    return { perPhase, metricMap };
  }

  // Lightweight NLP heuristics (explainable)
  function computeCoherence(text) {
    if (!text) return 0;
    const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(Boolean);
    if (sentences.length === 0) return 0;
    const avgLen = Math.min(40, text.split(/\s+/).length / sentences.length);
    const connectors = ["because", "therefore", "thus", "however", "consequently", "thereby", "meanwhile"];
    let connCount = 0;
    for (const c of connectors) if (text.toLowerCase().includes(c)) connCount++;
    const connScore = Math.min(1, connCount / sentences.length);
    return clamp01(0.6 * (avgLen / 40) + 0.4 * connScore);
  }

  function computeReflectionDepth(text) {
    if (!text) return 0;
    // reflection depth: presence of meta-words and first-person introspective markers
    const metaWords = ["I noticed", "I observed", "I realized", "I learned", "I see that", "I think", "I feel"];
    let found = 0;
    for (const mw of metaWords) if (text.toLowerCase().includes(mw.toLowerCase())) found++;
    return clamp01(found / Math.max(1, metaWords.length));
  }

  function computeClarity(text) {
    if (!text) return 0;
    // clarity heuristic: ratio of short sentences and concrete nouns presence (rough)
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length === 0) return 0;
    const shortSentences = text.split(/[.!?]+/).map(s => s.trim()).filter(Boolean).filter(s => s.split(/\s+/).length <= 12).length;
    const shortRatio = shortSentences / Math.max(1, text.split(/[.!?]+/).map(s=>s.trim()).filter(Boolean).length);
    return clamp01(shortRatio);
  }

  // ---------------------------
  // Main analyze function (exposed)
  // ---------------------------
  /**
   * analyzeResponses accepts:
   * - { state, localReport } OR
   * - { state } OR
   * - raw session object { session: { responses: [...] } }
   *
   * Returns a Promise resolving to a comprehensive report object:
   * {
   *   sessionId, timestamp, aggregatedPhaseScores, normalizedPhaseScores,
   *   composite (0..1), compositePoints, archetype, archetypeScores,
   *   metrics: {coherence,novelty,reflection,clarity}, narrative: {text,explain},
   *   provenance: { local: {...}, ai: {...} }
   * }
   */
  async function analyzeResponses(input = {}) {
    appendLedger("analysis_invoked", "info", { inputShape: Object.keys(input) });
    // normalize input shape
    const state = input.state || input || {};
    const localReport = input.localReport || null;

    // ensure weights loaded
    const weights = await loadWeights();

    // derive local metrics
    const derived = deriveLocalMetricsFromResponses(state);
    const localMetrics = derived.metricMap || {};
    const perPhase = derived.perPhase || {};

    appendLedger("local_metrics_derived", "info", { metrics: localMetrics });

    // If localReport exists (engine quick-pass), merge certain fields
    const localComposite = (localReport && typeof localReport.composite === "number") ? localReport.composite : null;

    // Ask AI for analysis summaries if logic.js attached ai reflection results
    // logic.js may have called AI per response and stored results in state.session.responses entries under aiSummary or such.
    // We'll attempt to merge any available AI analyses from the session
    let aiAccumMetrics = {}; // numeric
    let aiAccumArchetypes = {};
    let aiNarratives = [];

    try {
      const responses = (state.session && Array.isArray(state.session.responses)) ? state.session.responses : [];
      for (const r of responses) {
        if (r && r.ai) {
          // logic.js might have stored r.ai = { raw, text, json } — or stored ai reflection elsewhere
          const ai = r.ai || r.aiResult || null;
          if (!ai) continue;
          const parsed = parseAIResponse(ai.raw || ai.json || ai);
          // merge parsed.metrics into aiAccumMetrics
          for (const k of Object.keys(parsed.metrics || {})) {
            aiAccumMetrics[k] = (aiAccumMetrics[k] || 0) + (parsed.metrics[k] || 0);
          }
          // archetypes
          for (const a of Object.keys(parsed.archetypes || {})) {
            aiAccumArchetypes[a] = (aiAccumArchetypes[a] || 0) + (parsed.archetypes[a] || 0);
          }
          if (parsed.text) aiNarratives.push(parsed.text);
        }
      }
      // normalize aiAccumMetrics by count
      const respCount = Math.max(1, responses.length);
      for (const k of Object.keys(aiAccumMetrics)) aiAccumMetrics[k] = clamp01(aiAccumMetrics[k] / respCount);
      for (const a of Object.keys(aiAccumArchetypes)) aiAccumArchetypes[a] = clamp01(aiAccumArchetypes[a] / respCount);
    } catch (e) {
      appendLedger("ai_accumulation_failed", "error", { message: e.message });
    }

    // Merge local metrics with AI metrics (if any) using Bayesian smoothing
    const mergedMetrics = mergeNumericMaps(localMetrics, aiAccumMetrics, 1.2, 0.8);
    appendLedger("metrics_merged", "info", { local: localMetrics, ai: aiAccumMetrics, merged: mergedMetrics });

    // Phase-level aggregation: create normalizedPhaseScores by mapping perPhase derived to weights.phases mapping
    const phaseScores = {};
    const schemaPhases = (state.schema && Array.isArray(state.schema.phases)) ? state.schema.phases : [];
    // if weights define phases keyed by name, prefer that mapping
    const weightsPhases = weights && weights.phases ? weights.phases : {};

    // Build phaseScores using perPhase coherence/reflection/clarity/novelty blend
    for (const pid of Object.keys(perPhase)) {
      const v = perPhase[pid];
      // composition logic: weighted blend emphasizing reflection & coherence
      const score = clamp01(0.35 * (v.reflection || 0) + 0.35 * (v.coherence || 0) + 0.15 * (v.clarity || 0) + 0.15 * (v.novelty || 0));
      phaseScores[pid] = { raw: score, normalized: score }; // will normalize later across phases using weights
    }

    // If AI provided per-phase metrics in aiAccumMetrics keyed with phase ids, merge those
    // (e.g., ai may return { phaseScores: { phaseA: 0.8, ... } })
    if (aiAccumMetrics && Object.keys(aiAccumMetrics).length > 0) {
      for (const k of Object.keys(aiAccumMetrics)) {
        if (phaseScores[k]) {
          phaseScores[k].normalized = clamp01(bayesianSmooth(phaseScores[k].normalized, aiAccumMetrics[k], 1.2, 0.8));
        } else {
          phaseScores[k] = { raw: aiAccumMetrics[k], normalized: aiAccumMetrics[k] };
        }
      }
    }

    // Now apply weights.json to compute composite score
    // weights.phases may use keys like "perception", "analysis" matching schema phase ids/names
    let composite = 0;
    let totalW = 0;
    const normalizedPhaseScores = {};

    // If no explicit weights mapping, average normalized values
    if (!weightsPhases || Object.keys(weightsPhases).length === 0) {
      const vals = Object.keys(phaseScores).map(k => phaseScores[k].normalized || 0);
      const avg = vals.length ? (vals.reduce((a,b)=>a+b,0) / vals.length) : 0;
      composite = clamp01(avg);
      for (const k of Object.keys(phaseScores)) normalizedPhaseScores[k] = roundTo(phaseScores[k].normalized || 0);
    } else {
      // map phaseScores keys to weight keys (by exact match or by best fuzzy match)
      for (const [k, wobj] of Object.entries(weightsPhases)) {
        const w = wobj.weight || 0;
        // try to find a matching phase id in phaseScores: exact match first
        let matchedKey = null;
        if (phaseScores[k]) matchedKey = k;
        else {
          // try find by name (case-insensitive)
          const candidate = Object.keys(phaseScores).find(pk => pk.toLowerCase() === k.toLowerCase());
          if (candidate) matchedKey = candidate;
        }
        const val = matchedKey ? (phaseScores[matchedKey].normalized || 0) : 0;
        composite += val * w;
        totalW += w;
        normalizedPhaseScores[matchedKey || k] = roundTo(val);
      }
      if (totalW > 0) composite = clamp01(composite / totalW);
    }

    // Composite points scale (if weights specify totalPoints)
    const totalPoints = (weights && weights.meta && weights.meta.totalPoints) ? weights.meta.totalPoints : (state.schema?.config?.reportScale?.totalPoints || 700);
    const compositePoints = Math.round(composite * totalPoints);

    // Archetype inference: local + ai merge
    const localArchetypes = inferArchetypesFromPhaseScores(phaseScores, weights);
    const mergedArchetypeScores = mergeArchetypeScores(localArchetypes.scores || {}, aiAccumArchetypes || {});
    // pick best
    const archetypePick = Object.entries(mergedArchetypeScores).sort((a,b)=>b[1]-a[1])[0] || ['',0];
    const archetypeName = archetypePick[0] || localArchetypes.best || null;

    // Narrative generation: combine local explanation + AI narratives
    const narrativeParts = [];
    narrativeParts.push(generateLocalNarrative({ composite, compositePoints, normalizedPhaseScores, mergedMetrics: mergedMetrics }));
    if (aiNarratives && aiNarratives.length) {
      narrativeParts.push("AI Reflections:");
      narrativeParts.push(aiNarratives.join("\n\n"));
    }

    const narrative = { text: narrativeParts.join("\n\n"), explain: "Merged local heuristics with AI reflections where available." };

    // Final report object
    const report = {
      id: uid("report"),
      timestamp: nowISO(),
      sessionId: state.session?.id || (localReport && localReport.sessionId) || null,
      composite,
      compositePoints,
      normalizedPhaseScores,
      phaseScores, // raw object with details
      metrics: mergedMetrics,
      archetype: archetypeName,
      archetypeScores: mergedArchetypeScores,
      narrative,
      provenance: {
        local: { derived: localMetrics, perPhase },
        ai: { accumulatedMetrics: aiAccumMetrics, narratives: aiNarratives },
        merged: { metrics: mergedMetrics }
      },
      rawLocalReport: localReport || null
    };

    appendLedger("analysis_report_ready", "info", { composite, archetype: archetypeName });

    // Return promise-resolved report
    return report;
  }

  // Infer archetypes from phase scores using weights.archetypes bias vectors
  function inferArchetypesFromPhaseScores(phaseScores, weights) {
    const archetypes = (weights && weights.archetypes) ? weights.archetypes : {};
    const phaseIds = Object.keys(phaseScores);
    const result = { scores: {}, best: null };

    if (Object.keys(archetypes).length === 0) {
      // fallback simple mapping
      const avg = Object.values(phaseScores).reduce((a,b)=>a+(b.normalized||0),0) / Math.max(1, Object.keys(phaseScores).length);
      result.scores = { balanced: clamp01(avg) };
      result.best = "balanced";
      return result;
    }

    for (const [name, conf] of Object.entries(archetypes)) {
      const bias = conf.bias_vector || [];
      let align = 0;
      if (bias.length === phaseIds.length) {
        for (let i = 0; i < phaseIds.length; i++) {
          align += (phaseScores[phaseIds[i]].normalized || 0) * bias[i];
        }
      } else {
        // try to map bias vector by heuristic ordering of weights.phases
        const weightsPhases = weights.phases || {};
        const weightKeys = Object.keys(weightsPhases);
        if (bias.length === weightKeys.length) {
          for (let i = 0; i < weightKeys.length; i++) {
            const pid = weightKeys[i];
            align += (phaseScores[pid] && phaseScores[pid].normalized ? phaseScores[pid].normalized : 0) * bias[i];
          }
        } else {
          // fallback average
          const avgPhase = Object.values(phaseScores).reduce((a,b)=>a+(b.normalized||0),0) / Math.max(1, Object.keys(phaseScores).length);
          const avgBias = bias.length ? (bias.reduce((a,b)=>a+b,0)/bias.length) : 1;
          align = avgPhase * avgBias;
        }
      }
      result.scores[name] = clamp01(align);
    }
    // pick best
    const best = Object.entries(result.scores).sort((a,b)=>b[1]-a[1])[0] || ['',0];
    result.best = best[0];
    return result;
  }

  // local narrative generator (explainable)
  function generateLocalNarrative({ composite, compositePoints, normalizedPhaseScores, mergedMetrics }) {
    const lines = [];
    lines.push(`Composite Index: ${(composite * 100).toFixed(1)}% (${compositePoints} points)`);
    lines.push("Phase snapshot:");
    for (const [phase, val] of Object.entries(normalizedPhaseScores || {})) {
      lines.push(`- ${phase}: ${(val * 100).toFixed(1)}%`);
    }

    lines.push("Key metric highlights:");
    for (const [k, v] of Object.entries(mergedMetrics || {})) {
      lines.push(`- ${k}: ${(v * 100).toFixed(1)}%`);
    }

    lines.push("Interpretation: This profile blends reflective depth with coherence and clarity. Use the archetype report for targeted practice.");
    return lines.join("\n");
  }

  // small coherence/clarity helpers duplicated to ensure analysis independence
  function computeCoherence(text) {
    if (!text) return 0;
    const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(Boolean);
    if (sentences.length === 0) return 0;
    const avgLen = Math.min(40, text.split(/\s+/).length / sentences.length);
    const connectors = ["because", "therefore", "thus", "however", "consequently"];
    let connCount = 0;
    for (const c of connectors) if (text.toLowerCase().includes(c)) connCount++;
    const connScore = Math.min(1, connCount / sentences.length);
    return clamp01(0.6 * (avgLen / 40) + 0.4 * connScore);
  }

  // Expose the analyzeResponses API
  window.MCIF_Analysis = window.MCIF_Analysis || {};
  window.MCIF_Analysis.analyzeResponses = analyzeResponses;
  window.MCIF_Analysis.loadWeights = loadWeights;
  window.MCIF_Analysis._internal = { deriveLocalMetricsFromResponses }; // for debug/testing

  safeLog("MCIF.Analysis module loaded and ready");

})();
