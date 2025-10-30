/* ==========================================================
   MCIF 7.1 Analytical Engine – analysis.js
   Developed by Hayden Andrew Carr | Meta-Cognitive Intelligence Project
   ------------------------------------------------------------
   Description:
   Performs cognitive analysis, Bayesian weighting, and
   archetype synthesis from user responses.
   ========================================================== */

import { saveResults } from './data.js';

/* ==========================================================
   GLOBAL ANALYTICAL FUNCTIONS
   ========================================================== */

export async function analyzeResponses(state) {
  const { userResponses, activeMetrics, archetypeProfile } = state;

  console.log('%c[MCIF Analysis] Starting Bayesian synthesis...', 'color:#00ffaa;');

  // Step 1: Normalize metric scores
  const normalized = normalizeMetrics(activeMetrics);

  // Step 2: Apply Bayesian weighting (dynamic relevance scoring)
  const bayesianScores = applyBayesianModel(normalized);

  // Step 3: Derive Cognitive Composite Index (CCI)
  const compositeIndex = computeCompositeIndex(bayesianScores);

  // Step 4: Map archetype correlations
  const archetypeMatrix = computeArchetypeMatrix(archetypeProfile, bayesianScores);

  // Step 5: Generate adaptive reflection narrative
  const reflection = generateReflectionSummary(compositeIndex, archetypeMatrix);

  // Step 6: Package final result
  const results = {
    summary: {
      compositeIndex,
      reflection,
      archetypeMatrix,
    },
    details: {
      bayesianScores,
      normalized,
      responses: userResponses,
    },
  };

  // Save locally for transparency
  saveResults(results);
  console.log('%c[MCIF Analysis] Complete.', 'color:#00ffcc;');

  return results;
}

/* ==========================================================
   METRIC NORMALIZATION
   ========================================================== */

function normalizeMetrics(metrics) {
  const values = Object.values(metrics);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const normalized = {};

  for (let key in metrics) {
    normalized[key] =
      max === min ? 0.5 : (metrics[key] - min) / (max - min);
  }

  console.log('[MCIF Analysis] Metrics normalized:', normalized);
  return normalized;
}

/* ==========================================================
   BAYESIAN MODEL
   ========================================================== */

function applyBayesianModel(metrics) {
  const bayesian = {};
  const alpha = 1.2; // Adaptive learning rate
  const beta = 0.8; // Resistance / stability factor

  for (let key in metrics) {
    const prior = 0.5;
    const likelihood = metrics[key];
    const posterior = (likelihood * alpha) / ((likelihood * alpha) + ((1 - likelihood) * beta));
    bayesian[key] = posterior;
  }

  console.log('[MCIF Analysis] Bayesian model applied:', bayesian);
  return bayesian;
}

/* ==========================================================
   COMPOSITE INDEX
   ========================================================== */

function computeCompositeIndex(bayesianScores) {
  const weights = {
    reflection: 0.25,
    adaptability: 0.25,
    coherence: 0.2,
    resilience: 0.15,
    awareness: 0.15,
  };

  let score = 0;
  let totalWeight = 0;

  for (let key in bayesianScores) {
    const w = weights[key] || 0.1;
    score += bayesianScores[key] * w;
    totalWeight += w;
  }

  const compositeIndex = parseFloat((score / totalWeight).toFixed(3));

  console.log('[MCIF Analysis] Composite index computed:', compositeIndex);
  return compositeIndex;
}

/* ==========================================================
   ARCHETYPE MATRIX
   ========================================================== */

function computeArchetypeMatrix(archetypes, bayesianScores) {
  const matrix = {};

  for (let arch in archetypes) {
    const influence = archetypes[arch];
    const keys = Object.keys(bayesianScores);
    let alignment = 0;

    for (let key of keys) {
      alignment += (bayesianScores[key] || 0) * (influence / keys.length);
    }

    matrix[arch] = parseFloat(alignment.toFixed(3));
  }

  console.log('[MCIF Analysis] Archetype matrix computed:', matrix);
  return matrix;
}

/* ==========================================================
   REFLECTION SUMMARY (NARRATIVE OUTPUT)
   ========================================================== */

function generateReflectionSummary(compositeIndex, matrix) {
  let tone, summary;

  if (compositeIndex >= 0.8) {
    tone = 'synthesizer';
    summary =
      'You demonstrate advanced meta-cognitive synthesis — awareness and adaptability are harmonized.';
  } else if (compositeIndex >= 0.6) {
    tone = 'harmonizer';
    summary =
      'You display balanced reflection with emerging depth. You adapt without losing coherence.';
  } else if (compositeIndex >= 0.4) {
    tone = 'analyzer';
    summary =
      'You exhibit strong analytical tendencies. Reflection depth can be improved through mindfulness.';
  } else {
    tone = 'initiator';
    summary =
      'You are developing foundational awareness. Continue practicing observation before interpretation.';
  }

  const archetypeAlignments = Object.entries(matrix)
    .map(([key, val]) => `${key}: ${(val * 100).toFixed(1)}%`)
    .join(', ');

  return {
    tone,
    summary,
    archetypeAlignments,
  };
}

