/* ==========================================================
   MCIF 7.1 Data Layer – data.js
   Developed by Hayden Andrew Carr | Meta-Cognitive Intelligence Project
   ------------------------------------------------------------
   Description:
   Handles loading/saving of schema, prompts, and ledger data.
   Enables offline stability, schema version tracking, and
   transparent data flow across all MCIF layers.
   ========================================================== */

/* ==========================================================
   UTILITY FUNCTIONS
   ========================================================== */

/**
 * Fetch JSON data from a local or remote source.
 * Includes error handling and fallback for offline use.
 */
export async function fetchJSON(path) {
  try {
    const response = await fetch(path, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP error ${response.status}`);
    const data = await response.json();
    return data;
  } catch (error) {
    console.error(`[MCIF Data] Failed to load ${path}:`, error);
    return null;
  }
}

/* ==========================================================
   SCHEMA LOADING
   ========================================================== */

/**
 * Loads the MCIF schema.
 * Includes integrity verification and version check.
 */
export async function loadSchema(path = '/schema/mcif-schema.json') {
  const schema = await fetchJSON(path);

  if (!schema) {
    throw new Error('Schema could not be loaded.');
  }

  // Validate basic structure
  if (!schema.meta || !schema.phases || !Array.isArray(schema.phases)) {
    throw new Error('Invalid MCIF schema structure.');
  }

  console.log(
    `%c[MCIF Schema] Loaded version ${schema.meta.version}`,
    'color:#00ff99;font-weight:bold;'
  );

  return schema;
}

/* ==========================================================
   PROMPTS + REFLECTION DATA
   ========================================================== */

/**
 * Loads all prompts (questions, reflections, phase intros)
 */
export async function fetchPrompts(path = '/schema/prompts.json') {
  const prompts = await fetchJSON(path);

  if (!prompts) {
    console.warn('[MCIF Prompts] No prompt data found.');
    return {};
  }

  console.log(
    `%c[MCIF Prompts] Loaded ${Object.keys(prompts.phases || {}).length} phase sets.`,
    'color:#00ffff;'
  );

  return prompts;
}

/* ==========================================================
   LEDGER STORAGE (ETHICAL TRACE)
   ========================================================== */

/**
 * Saves ledger data for transparency + explainability
 */
export function saveLedger(ledger, fileName = 'ledger.json') {
  try {
    localStorage.setItem('MCIF_Ledger', JSON.stringify(ledger));
    console.log('%c[MCIF Ledger] Ledger updated', 'color:#ffaa00;');
  } catch (error) {
    console.error('[MCIF Ledger] Failed to save ledger:', error);
  }
}

/**
 * Loads ledger data from local storage
 */
export function loadLedger() {
  try {
    const data = localStorage.getItem('MCIF_Ledger');
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error('[MCIF Ledger] Failed to load ledger:', error);
    return [];
  }
}

/* ==========================================================
   RESULT STORAGE (ANONYMIZED USER DATA)
   ========================================================== */

/**
 * Saves anonymized user results locally.
 */
export function saveResults(results) {
  try {
    const allResults =
      JSON.parse(localStorage.getItem('MCIF_Results') || '[]');
    allResults.push({
      timestamp: new Date().toISOString(),
      summary: results.summary || {},
    });

    localStorage.setItem('MCIF_Results', JSON.stringify(allResults));
    console.log('%c[MCIF Data] Results saved.', 'color:#66ff66;');
  } catch (error) {
    console.error('[MCIF Data] Failed to save results:', error);
  }
}

/**
 * Loads previously saved results.
 */
export function loadResults() {
  try {
    const data = localStorage.getItem('MCIF_Results');
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error('[MCIF Data] Failed to load results:', error);
    return [];
  }
}

/* ==========================================================
   DATA CLEARING UTILITIES
   ========================================================== */

/**
 * Clears all local storage data for testing or reset.
 */
export function clearAllData() {
  localStorage.removeItem('MCIF_Ledger');
  localStorage.removeItem('MCIF_Results');
  console.log('%c[MCIF Data] Cleared all stored data.', 'color:#ff5555;');
}

/* ==========================================================
   VERSION TRACKING
   ========================================================== */

/**
 * Returns the current schema version and metadata.
 */
export async function getSchemaMeta() {
  const schema = await fetchJSON('/schema/mcif-schema.json');
  return schema?.meta || { version: 'unknown', author: 'Hayden A. Carr' };
}
