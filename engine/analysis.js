/**
 * src/analysis/analysis.js
 * MCIF 7.1 — Analysis Engine
 *
 * Responsibilities:
 *  - psycholinguistic parsing
 *  - per-phase raw metric scoring
 *  - Bayesian reflective inference for coherence/adaptability
 *  - composite domain scoring (0-700) using weights.json
 *  - archetype mapping with explainable rationale
 *  - coherence waveform generation
 *  - ledger entry creation (append-only) with hashing for audit
 *
 * Designed to run in Node.js and modern browsers.
 *
 * IMPORTANT:
 *  - expects weights config at ../config/weights.json
 *  - expects prompts at ../prompts/prompts.json (used for phase metadata)
 *
 * ALGORITHM_VERSION should be bumped when making non-backwards-compatible changes.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    // Node.js
    module.exports = factory(require('crypto'));
  } else {
    // Browser global
    root.MCIFAnalysis = factory(window.crypto || null);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (cryptoLib) {
  'use strict';

  // -------------------------------
  // Configuration & Imports (attempts to load weights/prompts but allows overrides)
  // -------------------------------
  let weightsManifest = null;
  let promptsManifest = null;

  try {
    // In Node environment this will work if repo layout matches.
    // In browser, host app should call init({weights, prompts}) to inject them.
    if (typeof require === 'function') {
      const path = require;
      try {
        weightsManifest = require('../config/weights.json');
      } catch (e) {
        // ignore — will require injection
      }
      try {
        promptsManifest = require('../prompts/prompts.json');
      } catch (e) {
        // ignore
      }
    }
  } catch (e) {
    // ignore
  }

  const ALGORITHM_VERSION = 'analysis_v1.0.0'; // bump on any significant change

  // Defaults if nothing supplied
  const DEFAULT_WEIGHTS = weightsManifest || {
    version: 'default@0.0.0',
    domains: {
      perception: 0.15,
      logic: 0.15,
      creativity: 0.15,
      emotion: 0.15,
      adaptability: 0.10,
      metaAwareness: 0.15,
      philosophy: 0.15
    },
    archetype_mapping: {}
  };

  // -------------------------------
  // Helpers
  // -------------------------------

  /**
   * Safe numeric normalization: clamp and map to [0,1]
   * @param {number} value
   * @param {number} min
   * @param {number} max
   * @returns {number}
   */
  function normalize(value, min, max) {
    if (!isFinite(value)) return 0;
    if (max === min) return 0;
    const v = (value - min) / (max - min);
    if (v !== v) return 0; // NaN guard
    return Math.max(0, Math.min(1, v));
  }

  /**
   * Safe average
   * @param {number[]} arr
   */
  function avg(arr) {
    if (!Array.isArray(arr) || arr.length === 0) return 0;
    let s = 0;
    for (let i = 0; i < arr.length; i++) s += Number(arr[i]) || 0;
    return s / arr.length;
  }

  /**
   * Euclidean similarity between two vectors (object maps)
   * Returns similarity in [0,1] where 1 is identical after normalization.
   * @param {Object<string, number>} a
   * @param {Object<string, number>} b
   */
  function similarityScore(a, b) {
    // normalize both to unit vectors
    const keys = Array.from(new Set([...Object.keys(a || {}), ...Object.keys(b || {})]));
    let sumSqA = 0, sumSqB = 0, dot = 0;
    keys.forEach(k => {
      const va = Number(a[k] || 0);
      const vb = Number(b[k] || 0);
      dot += va * vb;
      sumSqA += va * va;
      sumSqB += vb * vb;
    });
    const magA = Math.sqrt(sumSqA) || 1;
    const magB = Math.sqrt(sumSqB) || 1;
    const cos = dot / (magA * magB);
    // ensure in range -1..1
    const safeCos = Math.max(-1, Math.min(1, cos || 0));
    // map cosine [-1,1] -> [0,1]
    return (safeCos + 1) / 2;
  }

  /**
   * Create a simple unique id (timestamp + random)
   */
  function makeId(prefix = '') {
    const ts = Date.now();
    const rnd = Math.floor(Math.random() * 1e9).toString(36);
    return `${prefix}${ts.toString(36)}_${rnd}`;
  }

  /**
   * Cross-platform SHA-256 hex hash of JSON-able payload.
   * Returns Promise<string>
   * Works with Node's crypto module or Web Crypto (subtle).
   */
  async function hashPayload(payload) {
    const str = typeof payload === 'string' ? payload : JSON.stringify(payload);
    // Node.js cryptoLib will be non-null if module required; otherwise rely on Subtle
    if (cryptoLib && typeof cryptoLib.createHash === 'function') {
      // Node synchronous
      try {
        const h = cryptoLib.createHash('sha256').update(str, 'utf8').digest('hex');
        return h;
      } catch (e) {
        // fallthrough to WebCrypto
      }
    }
    // Web Crypto API
    if (typeof (self || globalThis).crypto !== 'undefined' && (self || globalThis).crypto.subtle) {
      const enc = new TextEncoder();
      const data = enc.encode(str);
      const digest = await (self || globalThis).crypto.subtle.digest('SHA-256', data);
      // convert to hex
      const hashArray = Array.from(new Uint8Array(digest));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
    // Fallback: not cryptographically secure but deterministic-ish
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = (h << 5) - h + str.charCodeAt(i);
      h |= 0;
    }
    return Math.abs(h).toString(16);
  }

  // -------------------------------
  // Psycholinguistic Parser
  // -------------------------------
  // Heuristic-based parser tuned for MCIF signals; not a full NLP pipeline,
  // but deterministic, explainable, and useful for research-mode signals.

  const CONNECTOR_LIST = {
    causal: ['because','therefore','hence','thus','as a result','consequently','so','due to','since'],
    temporal: ['first','then','next','after','before','while','during','when','afterwards','later'],
    contrast: ['however','but','although','nevertheless','yet','still'],
    modal: ['could','would','should','might','may','can','will']
  };

  const METAPHOR_MARKERS = ['like','as if','as though','resembles','resembled','metaphor','symbolic','as a','akin to','similar to'];

  /**
   * Very lightweight sentence splitter by periods / question / exclamation.
   * Returns array of sentences (trimmed).
   * @param {string} text
   * @returns {string[]}
   */
  function splitSentences(text) {
    if (!text || typeof text !== 'string') return [];
    // naive split
    return text
      .replace(/\n+/g, '. ')
      .split(/[.?!]+/)
      .map(s => s.trim())
      .filter(Boolean);
  }

  /**
   * Token count (very naive, whitespace split)
   * @param {string} text
   */
  function tokenCount(text) {
    if (!text || typeof text !== 'string') return 0;
    return text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
  }

  /**
   * Extract psycholinguistic signatures from text.
   * Returns object with counts and normalized heuristics (0-1).
   * @param {string} text
   */
  function parsePsycholinguisticSignatures(text) {
    const sentences = splitSentences(text);
    const tokens = tokenCount(text);
    const sentenceCount = Math.max(1, sentences.length);
    const avgTokensPerSentence = tokens / sentenceCount;

    // connector densities
    const lower = (text || '').toLowerCase();
    const connectorCounts = {};
    Object.keys(CONNECTOR_LIST).forEach(k => {
      connectorCounts[k] = 0;
      CONNECTOR_LIST[k].forEach(w => {
        // count occurrences
        const re = new RegExp('\\b' + w.replace(/\s+/g, '\\s+') + '\\b', 'gi');
        const m = lower.match(re);
        if (m) connectorCounts[k] += m.length;
      });
    });

    // metaphors
    let metaphorMatches = 0;
    METAPHOR_MARKERS.forEach(mk => {
      const re = new RegExp('\\b' + mk.replace(/\s+/g, '\\s+') + '\\b', 'gi');
      const mm = lower.match(re);
      if (mm) metaphorMatches += mm.length;
    });

    // self-reference / personal pronouns detection (for meta-awareness clues)
    const pronounRe = /\b(I|me|my|we|our|us|mine)\b/gi;
    const selfRefs = (lower.match(pronounRe) || []).length;

    // emotional-word heuristics (small lexicon for affect density)
    const affectWords = ['anxious','anxiety','sad','happy','joy','anger','angry','calm','scared','fear','dread','relief','excited','depressed','comfort'];
    let affectCount = 0;
    affectWords.forEach(w => {
      const re = new RegExp('\\b' + w + '\\b', 'gi');
      const m = lower.match(re);
      if (m) affectCount += m.length;
    });

    // causalDensity: causal connectors per sentence
    const causalDensity = connectorCounts.causal / sentenceCount;
    const temporalDensity = connectorCounts.temporal / sentenceCount;
    const contrastDensity = connectorCounts.contrast / sentenceCount;

    // novelty proxy: lower use of modal verbs and higher metaphors might proxy novelty
    const modalDensity = connectorCounts.modal / sentenceCount;

    // coherence heuristic: combines causalDensity, temporalDensity, avgTokensPerSentence, lower metaphor explosion
    // we will compute raw coherence and normalize later externally
    const raw = {
      tokens,
      sentenceCount,
      avgTokensPerSentence,
      connectorCounts,
      metaphorMatches,
      selfRefs,
      affectCount,
      causalDensity,
      temporalDensity,
      contrastDensity,
      modalDensity
    };

    // normalized heuristics
    const heuristics = {
      metaphorDensity: normalize(metaphorMatches, 0, Math.max(4, sentenceCount)), // more metaphors per sentence suggests creative density
      causalDensity: normalize(causalDensity, 0, 1),
      temporalDensity: normalize(temporalDensity, 0, 1),
      avgSentenceComplexity: normalize(avgTokensPerSentence, 0, 40),
      affectDensity: normalize(affectCount, 0, Math.max(4, sentenceCount)),
      selfReference: normalize(selfRefs, 0, Math.max(4, sentenceCount))
    };

    return { raw, heuristics, sentences, tokens };
  }

  // -------------------------------
  // Score a single response for a given phase definition
  // phaseDef: { id, name, metrics: [{id,name,range,weight?}, ...], ... }
  // responseObj: schema-compatible ResponseObject
  // weightSet: the active weightSet object from weights.json
  // Returns: { rawMetrics, domainContributions, subScores, explanations, probabilities }
  // -------------------------------
  function scoreResponseForPhase(responseObj, phaseDef, weightSet = DEFAULT_WEIGHTS) {
    // Defensive guards
    if (!responseObj || typeof responseObj.text !== 'string') {
      throw new Error('Invalid response object: missing text');
    }
    if (!phaseDef || !phaseDef.metrics) {
      throw new Error('Invalid phase definition for scoring');
    }

    const text = responseObj.text;
    const sig = parsePsycholinguisticSignatures(text);

    // Build raw metrics map keyed by metric.id from phaseDef.metrics
    const rawMetrics = {};
    const explanations = [];

    // Heuristic mappings from phase metric names (per white page)
    // Phase-specific mapping logic:
    phaseDef.metrics.forEach(metric => {
      const mid = metric.id || metric.name.replace(/\s+/g, '_').toLowerCase();
      const mname = (metric.name || mid).toLowerCase();

      // default fallback
      let rawValue = 0;
      let reason = '';

      // Phase 1 heuristics
      if (mname.includes('detail') || mname.includes('detail')) {
        // detail ~ token count and avg tokens/sentence, penalize extreme shortness
        rawValue = sig.heuristics.avgSentenceComplexity * 0.6 + normalize(sig.tokens, 0, 400) * 0.4;
        reason = `Detail derived from token count (${sig.tokens}) and avg sentence complexity (${sig.raw.avgTokensPerSentence.toFixed(1)}).`;
      } else if (mname.includes('sensory') || mname.includes('sensoryemotion') || mname.includes('sensoryemotionlink')) {
        // sensoryEmotionLink ~ presence of affect language + sensory adjectives (best-effort via affect density)
        rawValue = sig.heuristics.affectDensity * 0.6 + normalize(sig.selfRefs, 0, 4) * 0.1 + sig.heuristics.metaphorDensity * 0.3;
        reason = `Sensory-emotion link uses affect density (${sig.raw.affectCount}) and metaphor density (${sig.heuristics.metaphorDensity.toFixed(2)}).`;
      } else if (mname.includes('concept') || mname.includes('conceptdepth') || mname.includes('depth')) {
        // concept depth ~ causal density and temporal linking, coherence (proxy)
        rawValue = sig.heuristics.causalDensity * 0.6 + sig.heuristics.temporalDensity * 0.25 + (1 - sig.heuristics.metaphorDensity) * 0.15;
        reason = `Concept depth inferred from causal connectors (${sig.raw.connectorCounts.causal}) and temporal linking (${sig.raw.connectorCounts.temporal}).`;
      } else if (mname.includes('logic') || mname.includes('analytical') || mname.includes('coher')) {
        rawValue = sig.heuristics.causalDensity * 0.7 + sig.heuristics.avgSentenceComplexity * 0.3;
        reason = `Logic score uses causal density (${sig.raw.connectorCounts.causal}) and sentence complexity.`;
      } else if (mname.includes('systems') || mname.includes('causal')) {
        rawValue = sig.heuristics.causalDensity * 0.7 + sig.heuristics.temporalDensity * 0.2;
        reason = `Systems thinking derived from causal and temporal connectors.`;
      } else if (mname.includes('novel') || mname.includes('novelty') || mname.includes('metaphor')) {
        rawValue = sig.heuristics.metaphorDensity * 0.65 + (1 - sig.heuristics.avgSentenceComplexity) * 0.35;
        reason = `Novelty proxied by metaphor density and lower sentence complexity (creative brevity).`;
      } else if (mname.includes('empath') || mname.includes('empathic') || mname.includes('emotional')) {
        rawValue = sig.heuristics.affectDensity * 0.7 + sig.heuristics.selfReference * 0.3;
        reason = `Emotion metric uses explicit affect language and self-referential cues.`;
      } else if (mname.includes('causalinsight') || mname.includes('causal')) {
        rawValue = sig.heuristics.causalDensity * 0.8 + sig.heuristics.temporalDensity * 0.2;
        reason = `Causal insight derived from causal connector usage.`;
      } else if (mname.includes('self') || mname.includes('meta') || mname.includes('process')) {
        // meta-awareness - direct self references and sequential language
        rawValue = sig.heuristics.selfReference * 0.6 + sig.heuristics.temporalDensity * 0.25 + sig.heuristics.causalDensity * 0.15;
        reason = `Meta-awareness uses self-reference and sequential language.`;
      } else {
        // fallback: blend of coherence proxies
        rawValue = (sig.heuristics.causalDensity + (1 - sig.heuristics.metaphorDensity) + sig.heuristics.avgSentenceComplexity) / 3;
        reason = `Fallback metric computed from causal, metaphor, and complexity heuristics.`;
      }

      // normalize each rawValue to 0..1 (metrics may expect different ranges)
      rawValue = Math.max(0, Math.min(1, rawValue));

      rawMetrics[mid] = Number(rawValue.toFixed(4));
      explanations.push({ metric: mid, reason });
    });

    // Map rawMetrics to domain contributions using weightSet and phase mapping
    // Each phaseDef should be associated with domain list and submetric keys mapping.
    // We expect phaseDef.submetrics mapping keys match metric ids in phaseDef.metrics (if available).
    const domainContributions = {}; // domain -> aggregated normalized score
    const subScores = {}; // sub-scores per phase normalized to 0..100 (phase-level aggregated)

    // If phaseDef.submetrics present: use them
    const phaseSubmetrics = (phaseDef.submetrics && typeof phaseDef.submetrics === 'object')
      ? phaseDef.submetrics
      : (phaseDef.metrics || []).reduce((acc, m) => {
          const id = m.id || (m.name || '').replace(/\s+/g, '_').toLowerCase();
          acc[id] = 1 / (phaseDef.metrics.length || 1);
          return acc;
        }, {});

    // compute subScore (phase-level) = weighted sum of rawMetrics * submetric weights
    let phaseScoreRaw = 0;
    let totalSubWeight = 0;
    Object.keys(phaseSubmetrics).forEach(key => {
      const w = Number(phaseSubmetrics[key] || 0);
      totalSubWeight += w;
      const rawVal = Number(rawMetrics[key] || 0);
      phaseScoreRaw += rawVal * w;
    });
    if (totalSubWeight <= 0) totalSubWeight = 1;
    const phaseScoreNormalized = phaseScoreRaw / totalSubWeight; // 0..1
    subScores[phaseDef.id || phaseDef.name || 'phase'] = Number((phaseScoreNormalized * 100).toFixed(2)); // scaled 0..100

    // distribute phaseScoreNormalized to domains (phaseDef.domains expected)
    const phaseDomains = phaseDef.domains || (phaseDef.domainsList || []);
    if (Array.isArray(phaseDomains) && phaseDomains.length > 0) {
      const perDomainShare = phaseScoreNormalized / phaseDomains.length;
      phaseDomains.forEach(d => {
        domainContributions[d] = (domainContributions[d] || 0) + perDomainShare;
      });
    } else {
      // Fallback: assign to metaAwareness
      domainContributions.metaAwareness = (domainContributions.metaAwareness || 0) + phaseScoreNormalized;
    }

    // compute probability proxies (coherence, novelty)
    const coherenceProxy = (sig.heuristics.causalDensity * 0.5 + (1 - sig.heuristics.metaphorDensity) * 0.2 + sig.heuristics.avgSentenceComplexity * 0.3);
    const noveltyProxy = (sig.heuristics.metaphorDensity * 0.6 + (1 - sig.heuristics.causalDensity) * 0.4);

    const probabilities = {
      coherence: Number(normalize(coherenceProxy, 0, 1).toFixed(4)),
      novelty: Number(normalize(noveltyProxy, 0, 1).toFixed(4))
    };

    return {
      rawMetrics,
      domainContributions,
      subScores,
      explanations,
      probabilities,
      psycholinguistic: sig
    };
  }

  // -------------------------------
  // Bayesian Reflective Engine (simple, auditable)
  // - We treat 'coherence' as an observable signal and update posterior belief about user's reflective stability.
  // - Prior: mean 0.5, variance 0.04 (std 0.2)
  // - Likelihood: observed coherence ~ Normal(obs, obsVar)
  // - Posterior via conjugate update (approx)
  // -------------------------------
  function bayesianUpdateReflective(prior = { mean: 0.5, var: 0.04 }, observation = 0.5, obsVar = 0.02) {
    // Using normal-normal conjugate update:
    // posterior_var = 1 / (1/prior.var + 1/obsVar)
    // posterior_mean = posterior_var * (prior.mean/prior.var + observation/obsVar)
    const priorVar = Math.max(1e-6, Number(prior.var || 0.04));
    const obsVariance = Math.max(1e-6, Number(obsVar || 0.02));
    const invPrior = 1 / priorVar;
    const invObs = 1 / obsVariance;
    const postVar = 1 / (invPrior + invObs);
    const postMean = postVar * (prior.mean * invPrior + observation * invObs);
    return { mean: Number(postMean.toFixed(4)), var: Number(postVar.toFixed(6)) };
  }

  // -------------------------------
  // Coherence waveform generator
  // Given an array of scored response items with timestamps and a per-response coherence measure,
  // generate a time-series waveform normalized to 0..1 amplitude.
  // -------------------------------
  function generateCoherenceWaveform(scoredResponses = []) {
    if (!Array.isArray(scoredResponses) || scoredResponses.length === 0) return [];
    // Each item: { timestamps: { startedAt, endedAt, submittedAt }, probabilities: {coherence,...} }
    const arr = scoredResponses.map(r => {
      const t = (r.timestamps && r.timestamps.submittedAt) ? r.timestamps.submittedAt : Date.now();
      const ampRaw = (r.probabilities && typeof r.probabilities.coherence === 'number') ? r.probabilities.coherence : 0;
      return { t, ampRaw };
    });
    // normalize amps relative to min/max
    const amps = arr.map(a => a.ampRaw);
    const minAmp = Math.min(...amps);
    const maxAmp = Math.max(...amps);
    const denom = maxAmp - minAmp || 1;
    return arr.map(a => ({
      t: a.t,
      amplitude: Number(((a.ampRaw - minAmp) / denom).toFixed(4))
    }));
  }

  // -------------------------------
  // Composite computation
  // Combine domain contributions across phases into domainScores and composite 0..700
  // Steps:
  //  - accumulate domain contributions from all phases (each phase returns fractions)
  //  - normalize per-domain to [0,1] by dividing by maximum theoretical (we assume 1.0 max)
  //  - apply domain weights from weightSet
  //  - scale composite to 0..700 using domain_baseline constant in weights or default mapping
  // -------------------------------
  function computeCompositeFromDomainContributions(domainContribsMap, weightSet = DEFAULT_WEIGHTS) {
    // domainContribsMap: array or object of domain -> numeric (0..1 typical)
    const domainScores = {};
    const domains = Object.keys(weightSet.domains || DEFAULT_WEIGHTS.domains);
    let compositeRaw = 0;
    let weightSum = 0;
    domains.forEach(d => {
      const contrib = Number(domainContribsMap[d] || 0);
      // conservative clamp
      const c = Math.max(0, Math.min(1, contrib));
      domainScores[d] = Number((c * 100).toFixed(2)); // store as 0..100 for each domain score
      const w = Number((weightSet.domains && weightSet.domains[d]) || DEFAULT_WEIGHTS.domains[d] || 0);
      compositeRaw += c * w;
      weightSum += w;
    });
    if (weightSum <= 0) weightSum = 1;
    // compositeRaw in 0..1 *might* be less than 1; scale to 0..700 using domain_baseline or default mapping
    const baselineScale = (weightSet.normalization_constants && weightSet.normalization_constants.domain_baseline) || 100;
    // map compositeRaw (0..1) to 0 .. (baselineScale * weightSum)
    // But white page defines total = 700, so we scale linearly to 700 using weightSum normalization
    const compositeScaled = compositeRaw / weightSum; // 0..1 normalized by total weight
    const composite700 = Number((compositeScaled * 700).toFixed(2));
    // Tier mapping: Explorer 0–350, Architect 351–525, Visionary 526–700 (per white page)
    let tier = 'Explorer';
    if (composite700 >= 526) tier = 'Visionary';
    else if (composite700 >= 351) tier = 'Architect';
    else tier = 'Explorer';
    return { domainScores, compositeScore: composite700, tier };
  }

  // -------------------------------
  // Archetype mapping
  // Given domainScores (0..100 per domain), map to archetype using weightSet.archetype_mapping
  // Strategy:
  //  - Normalize domainScores to 0..1
  //  - For each archetype signature vector, compute similarityScore
  //  - Choose archetype that both matches threshold range for compositeScore (if present) and has highest similarity
  //  - Provide explanation & confidence
  // -------------------------------
  function mapArchetype(domainScoresObj = {}, compositeScore = 0, weightSet = DEFAULT_WEIGHTS) {
    const mapping = weightSet.archetype_mapping || {};
    const normalized = {};
    Object.keys(domainScoresObj).forEach(k => {
      normalized[k] = (Number(domainScoresObj[k] || 0)) / 100;
    });
    let best = { name: 'Other', score: 0, confidence: 0, evidence: [] };

    Object.keys(mapping).forEach(name => {
      const def = mapping[name];
      // check threshold if provided (array [min,max])
      if (Array.isArray(def.threshold) && def.threshold.length === 2) {
        const [minT, maxT] = def.threshold;
        if (!(compositeScore >= minT && compositeScore <= maxT)) {
          // skip if composite not in range
          // but still allow if no better candidate found later
        }
      }
      const signature = def.signature_vector || {};
      const sim = similarityScore(normalized, signature);
      // compute evidence: find top 2 domains where normalized differs positively
      const dominant = (def.dominant_domains || def.dominantDomains || []).slice(0, 3);
      const evidence = dominant.map(d => ({
        domain: d,
        value: Number((normalized[d] || 0).toFixed(3)),
        signature: Number((signature[d] || 0).toFixed(3))
      }));
      if (sim > best.score) {
        best = {
          name,
          score: sim,
          confidence: Number(sim.toFixed(4)),
          evidence
        };
      }
    });

    // fallback: Balanced Strategist if domain variance small
    const vals = Object.values(normalized);
    const variance = vals.length > 1 ? vals.reduce((s, v) => s + ((v - avg(vals)) ** 2), 0) / vals.length : 0;
    if (variance < 0.01 && best.score < 0.5) {
      best = {
        name: 'Balanced Strategist',
        score: 0.75,
        confidence: 0.75,
        evidence: []
      };
    }

    const archetypeObj = {
      id: makeId('arch_'),
      name: best.name,
      confidence: best.confidence,
      dominantDomains: best.evidence.map(e => e.domain),
      evidence: best.evidence.map(e => ({ phaseId: null, quote: null, metricEvidence: { [e.domain]: e.value } }))
    };

    return archetypeObj;
  }

  // -------------------------------
  // Primary exported API
  // -------------------------------

  /**
   * Initialize engine with injected manifests (weights, prompts).
   * @param {Object} opts { weights: Object, prompts: Object }
   */
  function init(opts = {}) {
    if (opts.weights) weightsManifest = opts.weights;
    if (opts.prompts) promptsManifest = opts.prompts;
  }

  /**
   * Score a single response object against a phase definition.
   * @param {Object} responseObj - ResponseObject from schema
   * @param {Object} phaseDef - PhaseDefinition (should include .metrics and .domains and .submetrics)
   * @param {Object} options - optional overrides { weightSet }
   * @returns {Object} scoring result matching schema.analysis shape
   */
  async function scoreResponse(responseObj, phaseDef, options = {}) {
    const weightSet = options.weightSet || weightsManifest || DEFAULT_WEIGHTS;
    const result = scoreResponseForPhase(responseObj, phaseDef, weightSet);

    // produce mirror explanation (1-3 sentences) per prompts.ai_instructions guidance
    const mirror = generateMirrorExplanation(responseObj.text, phaseDef, result);
    // attach mirror into explanations array first
    const explanations = Array.isArray(result.explanations) ? [...result.explanations] : [];
    explanations.unshift({ metric: 'mirror', reason: mirror });

    // return per-schema expected fields
    return {
      rawMetrics: result.rawMetrics,
      subScores: result.subScores,
      probabilities: result.probabilities,
      explanations,
      psycholinguistic: result.psycholinguistic
    };
  }

  /**
   * Generate a short mirror explanation text for a response and phase
   * @param {string} text
   * @param {Object} phaseDef
   * @param {Object} scoreResult
   * @returns {string}
   */
  function generateMirrorExplanation(text, phaseDef, scoreResult) {
    // Use phaseDef.name and strongest metric evidence to craft 1-3 sentences.
    try {
      const sig = scoreResult.psycholinguistic;
      const topMetric = Object.keys(scoreResult.rawMetrics || {}).reduce((best, k) => {
        const v = scoreResult.rawMetrics[k] || 0;
        return (v > (scoreResult.rawMetrics[best] || 0)) ? k : best;
      }, Object.keys(scoreResult.rawMetrics || {})[0] || 'metric');

      const coherence = scoreResult.probabilities && scoreResult.probabilities.coherence ? Math.round(scoreResult.probabilities.coherence * 100) : 0;
      const mirror = `You emphasized ${topMetric.replace(/[_\-]/g, ' ')} and used ${sig.tokens} words across ${sig.sentences.length} sentences. Coherence proxy: ${coherence}%.`;
      return mirror;
    } catch (e) {
      return 'Response structure mirrored: descriptors and logical connectors detected.';
    }
  }

  /**
   * Compute session-level composite from an array of phase-level scored outputs.
   * Each scored output must include domainContributions (domain->0..1), probabilities.coherence, timestamps.
   *
   * @param {Object[]} scoredPhases - each item { phaseId, domainContributions: {domain:val}, probabilities, timestamps, responses: [..] }
   * @param {Object} options { weightSet }
   */
  async function computeComposite(scoredPhases = [], options = {}) {
    const weightSet = options.weightSet || weightsManifest || DEFAULT_WEIGHTS;
    // aggregate domain contributions across phases
    const accum = {};
    scoredPhases.forEach(sp => {
      const dc = sp.domainContributions || {};
      Object.keys(dc).forEach(d => {
        accum[d] = (accum[d] || 0) + Number(dc[d] || 0);
      });
    });
    // normalize by number of phases to keep 0..1 scale
    const phaseCount = Math.max(1, scoredPhases.length);
    Object.keys(accum).forEach(k => accum[k] = accum[k] / phaseCount);

    // Compute composite
    const compositeObj = computeCompositeFromDomainContributions(accum, weightSet);
    // compute archetype
    const archetype = mapArchetype(compositeObj.domainScores, compositeObj.compositeScore, weightSet);

    // generate final report structure
    const finalReport = {
      compositeScore: compositeObj.compositeScore,
      domainScores: compositeObj.domainScores,
      tier: compositeObj.tier,
      archetype,
      insightSummary: generateInsightSummary(compositeObj, archetype),
      evidence: generateEvidenceForReport(scoredPhases),
      coherenceWaveform: generateCoherenceWaveform(scoredPhases.map(sp => ({ timestamps: sp.timestamps || {}, probabilities: sp.probabilities || {} }))),
      insightDensity: computeInsightDensity(scoredPhases),
      generatedBy: {
        algorithmVersion: ALGORITHM_VERSION,
        weightsVersion: (weightSet.version || 'unknown'),
        timestamp: Date.now()
      }
    };

    return finalReport;
  }

  function generateInsightSummary(compositeObj, archetype) {
    // Short human readable summary
    const highDomains = Object.keys(compositeObj.domainScores)
      .sort((a, b) => compositeObj.domainScores[b] - compositeObj.domainScores[a])
      .slice(0, 3);
    const hd = highDomains.map(d => `${d} (${compositeObj.domainScores[d]})`).join(', ');
    return `Dominant domains: ${hd}. Archetype: ${archetype.name} (confidence ${Math.round(archetype.confidence * 100)}%).`;
  }

  function generateEvidenceForReport(scoredPhases) {
    const evidence = [];
    scoredPhases.forEach(sp => {
      const phaseId = sp.phaseId;
      // pick a representative quote from the first response if present
      const resp = (sp.responses && sp.responses[0]) || null;
      const quote = resp ? (resp.text || '').slice(0, 240) : '';
      // choose top metric of that phase
      const topMetric = resp && resp.analysis && resp.analysis.rawMetrics
        ? Object.keys(resp.analysis.rawMetrics).reduce((best, k) => {
            const v = resp.analysis.rawMetrics[k] || 0;
            return (v > (resp.analysis.rawMetrics[best] || 0)) ? k : best;
          }, Object.keys(resp.analysis.rawMetrics || {})[0] || null)
        : null;
      evidence.push({
        phaseId,
        metric: topMetric || null,
        value: resp && resp.analysis && resp.analysis.subScores ? Object.values(resp.analysis.subScores)[0] : null,
        quote
      });
    });
    return evidence;
  }

  function computeInsightDensity(scoredPhases) {
    // insight density: measure of subScore jumps over time normalized
    const points = scoredPhases.map((sp, idx) => {
      const score = sp && sp.subScores ? Number(Object.values(sp.subScores)[0] || 0) : 0;
      const t = (sp.timestamps && sp.timestamps.submittedAt) ? sp.timestamps.submittedAt : Date.now() + idx;
      return { t, density: Number((score / 100).toFixed(4)) };
    });
    return points;
  }

  // -------------------------------
  // Ledger creation (append-only)
  // -------------------------------
  async function createLedgerEntry({ actor = ALGORITHM_VERSION, action = 'UNKNOWN', sessionId = null, payload = {}, rationale = '' }) {
    const id = makeId('ledger_');
    const timestamp = Date.now();
    const payloadSummary = typeof payload === 'string' ? payload : (payload && payload.summary) || JSON.stringify(Object.keys(payload || {}).slice(0, 5));
    const entry = {
      id,
      timestamp,
      actor,
      action,
      sessionId,
      payload,
      payloadSummary: typeof payloadSummary === 'string' ? payloadSummary : JSON.stringify(payloadSummary),
      rationale: rationale || '',
      // hash to be filled in after content computed
      hash: null
    };
    const h = await hashPayload(entry);
    entry.hash = h;
    return entry;
  }

  // -------------------------------
  // Public API object
  // -------------------------------
  const API = {
    init,
    scoreResponse,
    computeComposite,
    generateCoherenceWaveform,
    generateInsightDensity: computeInsightDensity,
    createLedgerEntry,
    ALGORITHM_VERSION,
    // Expose helpers for testing / research
    _internals: {
      parsePsycholinguisticSignatures,
      scoreResponseForPhase,
      bayesianUpdateReflective,
      normalize,
      similarityScore
    }
  };

  return API;
});
