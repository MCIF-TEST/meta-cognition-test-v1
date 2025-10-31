/* ==========================================================
   engine/analysis.js
   MCIF 7.1 — Enterprise Analysis Module (Hybrid AI + Local)
   Extended: psycholinguistic signatures and improved metric derivation
   Author: Hayden Andrew Carr | Meta-Cognitive Intelligence Project
   Revised: 2025-10-31
   ========================================================== */

(function () {
  const LEDGER_KEY = "MCIF_Ledger_v1";
  const WEIGHTS_PATHS = ["./schema/weights.json", "./weights.json", "./data/weights.json"];
  const DEFAULT_ROUND = 3;

  // Utility
  function safeLog(...args) { console.debug("[MCIF.Analysis]", ...args); }
  function nowISO() { return new Date().toISOString(); }
  function uid(prefix = "ma") { return `${prefix}_${Math.random().toString(36).slice(2,9)}_${Date.now()}`; }
  function clamp01(v) { return Math.max(0, Math.min(1, v)); }
  function roundTo(v, n = DEFAULT_ROUND) { const f = Math.pow(10, n); return Math.round((v + Number.EPSILON) * f) / f; }

  // ledger helpers
  function loadLedger() { try { const raw = localStorage.getItem(LEDGER_KEY); return raw ? JSON.parse(raw) : []; } catch (e) { return []; } }
  function appendLedger(event, type = "info", data = {}) { const ledger = loadLedger(); ledger.push({ id: uid("ledger"), event, type, data, timestamp: nowISO() }); try { localStorage.setItem(LEDGER_KEY, JSON.stringify(ledger)); } catch (e) { console.warn("MCIF.Analysis: ledger save failed", e); } }

  // Load JSON helper
  async function loadJSONCandidate(paths = []) {
    for (const p of paths) {
      try {
        const resp = await fetch(p, { cache: "no-store" });
        if (!resp.ok) continue;
        const json = await resp.json();
        safeLog("Loaded JSON:", p);
        return { path: p, json };
      } catch (e) {
        /* ignore */ 
      }
    }
    return null;
  }

  // compute lexical diversity (type-token ratio)
  function lexicalDiversity(text) {
    if (!text) return 0;
    const tokens = text.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean);
    const unique = Array.from(new Set(tokens));
    if (tokens.length === 0) return 0;
    return clamp01(unique.length / tokens.length);
  }

  // metaphoric language: heuristic detection of simile/metaphor words (very simple)
  function computeMetaphorFrequency(text) {
    if (!text) return 0;
    const t = text.toLowerCase();
    const cues = ["like a", "as a", "as if", "resembles", "is like", "metaphor", "metaphorically", "imagine"];
    let count = 0;
    for (const c of cues) if (t.includes(c)) count++;
    // normalized by sentence count
    const sCount = Math.max(1, text.split(/[.!?]+/).map(s=>s.trim()).filter(Boolean).length);
    return clamp01(count / sCount);
  }

  // connector density: occurrences of connective words per sentence
  function computeConnectorDensity(text) {
    if (!text) return 0;
    const connectors = ["because","therefore","however","thus","consequently","thereby","meanwhile","and","but","so","if","when"];
    const sentences = text.split(/[.!?]+/).map(s=>s.trim()).filter(Boolean);
    if (sentences.length === 0) return 0;
    let totalConn = 0;
    for (const s of sentences) {
      const lower = s.toLowerCase();
      for (const c of connectors) {
        // basic word boundary check
        const re = new RegExp(`\\b${c}\\b`, 'g');
        const m = lower.match(re);
        totalConn += (m ? m.length : 0);
      }
    }
    return clamp01(totalConn / Math.max(1, sentences.length * 2)); // normalized heuristic
  }

  // temporal linking: use of words linking time/order (then, first, next)
  function computeTemporalLinking(text) {
    if (!text) return 0;
    const cues = ["then","first","next","after","before","finally","subsequently","meanwhile"];
    const sentences = text.split(/[.!?]+/).map(s=>s.trim()).filter(Boolean);
    if (sentences.length === 0) return 0;
    let found = 0;
    for (const c of cues) if (text.toLowerCase().includes(` ${c} `)) found++;
    return clamp01(found / Math.max(1, sentences.length));
  }

  // reflection depth (presence of first-person introspective markers)
  function computeReflectionDepth(text) {
    if (!text) return 0;
    const metaWords = ["i noticed","i observed","i realized","i learned","i see that","i think","i feel","i decided","i plan"];
    const lower = text.toLowerCase();
    let found = 0;
    for (const mw of metaWords) if (lower.includes(mw)) found++;
    return clamp01(found / Math.max(1, metaWords.length));
  }

  // clarity heuristic: short sentences ratio
  function computeClarity(text) {
    if (!text) return 0;
    const sentences = text.split(/[.!?]+/).map(s=>s.trim()).filter(Boolean);
    if (sentences.length === 0) return 0;
    const short = sentences.filter(s => s.split(/\s+/).length <= 12).length;
    return clamp01(short / sentences.length);
  }

  // coherence: reuse connector density & structural ratio
  function computeCoherence(text) {
    const conn = computeConnectorDensity(text);
    const temporal = computeTemporalLinking(text);
    return clamp01(0.6 * conn + 0.4 * temporal);
  }

  // novelty: lexical diversity + metaphor frequency
  function computeNovelty(text) {
    const ld = lexicalDiversity(text);
    const mf = computeMetaphorFrequency(text);
    return clamp01(0.7 * ld + 0.3 * mf);
  }

  // deriveLocalMetricsFromResponses: updated to produce metricMap including psycholinguistic signatures
  function deriveLocalMetricsFromResponses(state) {
    const metricMap = {}; // aggregated metrics
    const phaseMap = {};
    const responses = (state.session && state.session.responses) ? state.session.responses.filter(Boolean) : [];

    for (const r of responses) {
      const text = r.response || "";
      const tokens = r.tokenCount || (text ? text.split(/\s+/).length : 0);
      const coherence = computeCoherence(text);
      const novelty = computeNovelty(text);
      const reflection = computeReflectionDepth(text);
      const clarity = computeClarity(text);
      const metaphors = computeMetaphorFrequency(text);
      const lexDiv = lexicalDiversity(text);

      const pid = r.phaseId || "undefined_phase";
      phaseMap[pid] = phaseMap[pid] || { count: 0, sums: { coherence: 0, novelty: 0, reflection: 0, clarity: 0, metaphors: 0, lexDiv: 0 } };
      phaseMap[pid].count++;
      phaseMap[pid].sums.coherence += coherence;
      phaseMap[pid].sums.novelty += novelty;
      phaseMap[pid].sums.reflection += reflection;
      phaseMap[pid].sums.clarity += clarity;
      phaseMap[pid].sums.metaphors += metaphors;
      phaseMap[pid].sums.lexDiv += lexDiv;
    }

    const perPhase = {};
    for (const pid of Object.keys(phaseMap)) {
      const obj = phaseMap[pid];
      const count = obj.count || 1;
      perPhase[pid] = {
        coherence: clamp01(obj.sums.coherence / count),
        novelty: clamp01(obj.sums.novelty / count),
        reflection: clamp01(obj.sums.reflection / count),
        clarity: clamp01(obj.sums.clarity / count),
        metaphors: clamp01(obj.sums.metaphors / count),
        lexDiv: clamp01(obj.sums.lexDiv / count)
      };
    }

    // summary metrics (averaged across phases)
    const dims = { coherence: 0, novelty: 0, reflection: 0, clarity: 0, metaphors: 0, lexDiv: 0 };
    let pcount = 0;
    for (const pid of Object.keys(perPhase)) {
      pcount++;
      dims.coherence += perPhase[pid].coherence;
      dims.novelty += perPhase[pid].novelty;
      dims.reflection += perPhase[pid].reflection;
      dims.clarity += perPhase[pid].clarity;
      dims.metaphors += perPhase[pid].metaphors;
      dims.lexDiv += perPhase[pid].lexDiv;
    }
    if (pcount > 0) {
      dims.coherence = clamp01(dims.coherence / pcount);
      dims.novelty = clamp01(dims.novelty / pcount);
      dims.reflection = clamp01(dims.reflection / pcount);
      dims.clarity = clamp01(dims.clarity / pcount);
      dims.metaphors = clamp01(dims.metaphors / pcount);
      dims.lexDiv = clamp01(dims.lexDiv / pcount);
    }

    metricMap.coherence = dims.coherence;
    metricMap.novelty = dims.novelty;
    metricMap.reflection = dims.reflection;
    metricMap.clarity = dims.clarity;
    metricMap.metaphors = dims.metaphors;
    metricMap.lexicalDiversity = dims.lexDiv;

    return { perPhase, metricMap };
  }

  // mergeNumericMaps and simple Bayesian smoothing helpers
  function bayesianSmooth(prior, obs, alpha = 1, beta = 1) {
    const post = ((prior * alpha) + (obs * beta)) / (alpha + beta);
    return clamp01(post);
  }
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

  // Parse AI response (tolerant)
  function parseAIResponse(aiRaw) {
    if (!aiRaw) return { text: null, metrics: {}, archetypes: {} };
    try {
      if (typeof aiRaw === "string") {
        const jstart = aiRaw.indexOf("{");
        if (jstart >= 0) {
          try {
            const maybe = JSON.parse(aiRaw.slice(jstart));
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

  // Main analyzeResponses function (exposed)
  async function analyzeResponses(input = {}) {
    appendLedger("analysis_invoked", "info", { inputShape: Object.keys(input) });
    const state = input.state || input || {};
    const localReport = input.localReport || null;

    // derive local metrics
    const derived = deriveLocalMetricsFromResponses(state);
    const localMetrics = derived.metricMap || {};
    const perPhase = derived.perPhase || {};
    appendLedger("local_metrics_derived", "info", { metrics: localMetrics });

    // accumulate AI metrics if present in session responses (logic.js may add ai results)
    let aiAccumMetrics = {};
    let aiNarratives = [];
    try {
      const responses = (state.session && Array.isArray(state.session.responses)) ? state.session.responses : [];
      for (const r of responses) {
        if (r && r.ai) {
          const ai = r.ai || r.aiResult || null;
          if (!ai) continue;
          const parsed = parseAIResponse(ai.raw || ai.json || ai);
          for (const k of Object.keys(parsed.metrics || {})) aiAccumMetrics[k] = (aiAccumMetrics[k] || 0) + (parsed.metrics[k] || 0);
          if (parsed.text) aiNarratives.push(parsed.text);
        }
      }
      const respCount = Math.max(1, (state.session && state.session.responses) ? state.session.responses.length : 1);
      for (const k of Object.keys(aiAccumMetrics)) aiAccumMetrics[k] = clamp01(aiAccumMetrics[k] / respCount);
    } catch (e) {
      appendLedger("ai_accumulation_failed", "error", { message: e.message });
    }

    // Merge local & ai metrics
    const mergedMetrics = mergeNumericMaps(localMetrics, aiAccumMetrics, 1.2, 0.8);
    appendLedger("metrics_merged", "info", { local: localMetrics, ai: aiAccumMetrics });

    // Build phaseScores from perPhase using white-page composition rules
    const phaseScores = {};
    for (const pid of Object.keys(perPhase)) {
      const v = perPhase[pid];
      const score = clamp01(0.35 * (v.reflection || 0) + 0.35 * (v.coherence || 0) + 0.15 * (v.clarity || 0) + 0.15 * (v.novelty || 0));
      phaseScores[pid] = { raw: score, normalized: score };
    }

    // If AI provided phase-level metrics keyed by phase, we can merge them here (not required)

    // Load weights (if available)
    const weightsCandidate = await loadJSONCandidate(WEIGHTS_PATHS);
    const weights = (weightsCandidate && weightsCandidate.json) ? weightsCandidate.json : (state.weights || { phases: {}, derived: {} });

    // Apply weights to compute composite
    let composite = 0;
    let totalW = 0;
    const normalizedPhaseScores = {};
    const weightsPhases = weights && weights.phases ? weights.phases : {};
    if (!weightsPhases || Object.keys(weightsPhases).length === 0) {
      const vals = Object.keys(phaseScores).map(k => phaseScores[k].normalized || 0);
      composite = clamp01(vals.length ? (vals.reduce((a,b)=>a+b,0)/vals.length) : 0);
      for (const k of Object.keys(phaseScores)) normalizedPhaseScores[k] = roundTo(phaseScores[k].normalized || 0);
    } else {
      for (const [k, wobj] of Object.entries(weightsPhases)) {
        const w = wobj.weight || 0;
        let matchedKey = null;
        if (phaseScores[k]) matchedKey = k;
        else {
          const candidate = Object.keys(phaseScores).find(pk => pk.toLowerCase() === k.toLowerCase());
          if (candidate) matchedKey = candidate;
        }
        const val = matchedKey ? (phaseScores[matchedKey].normalized || 0) : 0;
        composite += val * w;
        totalW += w;
        normalizedPhaseScores[matchedKey || k] = roundTo(val);
      }
      // include derived adaptability weight if present
      const adaptW = (weights && weights.derived && weights.derived.adaptability) ? weights.derived.adaptability.weight : 0;
      if (typeof adaptW === 'number' && adaptW > 0) {
        // adaptability compute: inverse variance across phase normalized scores
        const vals = Object.values(phaseScores).map(p => p.normalized || 0);
        const mean = vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : 0;
        const variance = vals.length ? (vals.reduce((a,b)=>a + Math.pow((b-mean),2),0) / vals.length) : 0;
        const adaptability = clamp01(1 - variance);
        composite += adaptability * adaptW;
        totalW += adaptW;
        // store adaptability in merged metrics as well
        mergedMetrics.adaptability = adaptability;
      }
      if (totalW > 0) composite = clamp01(composite / totalW);
    }

    const totalPoints = (weights && weights.meta && weights.meta.totalPoints) ? weights.meta.totalPoints : (state.schema?.config?.reportScale?.totalPoints || 700);
    const compositePoints = Math.round(composite * totalPoints);

    // Construct report
    const report = {
      id: uid("report"),
      timestamp: nowISO(),
      sessionId: state.session?.id || (localReport && localReport.sessionId) || null,
      composite,
      compositePoints,
      normalizedPhaseScores,
      phaseScores,
      metrics: mergedMetrics,
      archetype: null,
      archetypeScores: {},
      narrative: { text: aiNarratives.join("\n\n") || "Local analysis used.", explain: "Merged local heuristics with any available AI reflections." },
      provenance: {
        local: { derived: localMetrics, perPhase },
        ai: { accumulatedMetrics: aiAccumMetrics, narratives: aiNarratives },
        merged: { metrics: mergedMetrics }
      },
      rawLocalReport: localReport || null
    };

    // Infer archetype if weights.archetypes available
    const archetypes = weights && weights.archetypes ? weights.archetypes : {};
    if (Object.keys(archetypes).length > 0) {
      const archetypeScores = {};
      const phaseIds = Object.keys(phaseScores);
      for (const [name, conf] of Object.entries(archetypes)) {
        const bias = conf.bias_vector || [];
        let align = 0;
        if (bias.length === phaseIds.length) {
          for (let i=0;i<phaseIds.length;i++) align += (phaseScores[phaseIds[i]].normalized || 0) * bias[i];
        } else {
          const avg = phaseIds.length ? (phaseIds.reduce((a,b)=>a+(phaseScores[b].normalized||0),0) / phaseIds.length) : 0;
          const avgBias = bias.length ? (bias.reduce((a,b)=>a+b,0)/bias.length) : 1;
          align = avg * avgBias;
        }
        archetypeScores[name] = clamp01(align);
      }
      const best = Object.entries(archetypeScores).sort((a,b)=>b[1]-a[1])[0] || ['',0];
      report.archetype = best[0];
      report.archetypeScores = archetypeScores;
    }

    appendLedger("analysis_report_ready", "info", { composite: composite, archetype: report.archetype });
    return report;
  }

  // Expose API
  window.MCIF_Analysis = window.MCIF_Analysis || {};
  window.MCIF_Analysis.analyzeResponses = analyzeResponses;
  window.MCIF_Analysis._internal = { deriveLocalMetricsFromResponses, computeCoherence, computeNovelty, computeReflectionDepth };

  safeLog("MCIF.Analysis module loaded and ready");
})();
