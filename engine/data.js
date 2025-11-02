/**
 * src/data/data.js
 * MCIF 7.1 — Data Layer (Hybrid-Ready)
 *
 * Responsibilities:
 *  - Session storage (create, read, update, delete)
 *  - Response persistence and validation
 *  - Append-only Ledger management with hash pointers
 *  - Export / GDPR delete flows (exportSessionAsJSON, deleteSession)
 *  - Adapters: localStorage (browser), IndexedDB (browser), file adapter (Node), remote adapter (stub)
 *  - Optional schema validator injection (e.g., AJV) for strict enforcement
 *
 * Design notes:
 *  - Privacy-first defaults: storePersonalData=false by default.
 *  - Ledger contains hashed pointers (configurable).
 *  - All adapter operations are async-returning Promises.
 *  - Deterministic IDs created via deterministic pseudo-random logic.
 *
 * Usage:
 *  - In browser: DataLayer.init({ adapter: 'indexeddb' or 'localstorage', validator: optionalValidator })
 *  - In Node: DataLayer.init({ adapter: 'fs', basePath: './data', validator })
 *
 * Exports global DataLayer object for browser; module.exports for Node.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('fs'), require('path'), require('crypto'));
  } else {
    root.MCIFData = factory(null, null, null);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (fs, path, cryptoLib) {
  'use strict';

  // -----------------------------
  // Helper Utilities
  // -----------------------------
  function now() { return Date.now(); }

  function makeId(prefix = '') {
    const ts = now();
    const rnd = Math.floor(Math.random() * 1e9).toString(36);
    return `${prefix}${ts.toString(36)}_${rnd}`;
  }

  async function hashPayload(payload) {
    const str = typeof payload === 'string' ? payload : JSON.stringify(payload);
    if (cryptoLib && typeof cryptoLib.createHash === 'function') {
      return cryptoLib.createHash('sha256').update(str, 'utf8').digest('hex');
    }
    // WebCrypto fallback (browser)
    if (typeof (self || globalThis).crypto !== 'undefined' && (self || globalThis).crypto.subtle) {
      const enc = new TextEncoder();
      const data = enc.encode(str);
      const digest = await (self || globalThis).crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(digest));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
    // fallback non-crypto
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = (h << 5) - h + str.charCodeAt(i);
      h |= 0;
    }
    return Math.abs(h).toString(16);
  }

  function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

  // Simple promise-based sleep (for tests)
  function delay(ms) { return new Promise(res => setTimeout(res, ms)); }

  // -----------------------------
  // Adapters
  // -----------------------------
  // Each adapter implements async: init(opts), get(key), set(key, value), delete(key), listKeys(prefix)
  // For more advanced operations, adapters can provide: exportAll(), importAll(json)

  // ---- LocalStorage Adapter (browser, synchronous under the hood; wrapped async) ----
  const LocalStorageAdapter = {
    name: 'localstorage',
    async init(opts = {}) {
      if (typeof localStorage === 'undefined') throw new Error('localStorage not available in this environment');
      this.prefix = opts.prefix || 'mcif:';
      return true;
    },
    async get(key) {
      const raw = localStorage.getItem(this.prefix + key);
      if (!raw) return null;
      try { return JSON.parse(raw); } catch (e) { return raw; }
    },
    async set(key, value) {
      localStorage.setItem(this.prefix + key, JSON.stringify(value));
      return true;
    },
    async delete(key) {
      localStorage.removeItem(this.prefix + key);
      return true;
    },
    async listKeys(prefix = '') {
      const out = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (k.startsWith(this.prefix + prefix)) out.push(k.replace(this.prefix, ''));
      }
      return out;
    },
    async exportAll() {
      const all = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (k.startsWith(this.prefix)) {
          try { all[k.replace(this.prefix, '')] = JSON.parse(localStorage.getItem(k)); } catch (e) { all[k.replace(this.prefix, '')] = localStorage.getItem(k); }
        }
      }
      return all;
    }
  };

  // ---- IndexedDB Adapter (browser, async, recommended for real sessions) ----
  const IndexedDBAdapter = {
    name: 'indexeddb',
    db: null,
    dbName: 'mcif-db-v1',
    storeName: 'mcif_store',
    async init(opts = {}) {
      if (typeof indexedDB === 'undefined') throw new Error('IndexedDB not available in environment');
      const request = indexedDB.open(this.dbName, 1);
      return new Promise((resolve, reject) => {
        request.onupgradeneeded = (ev) => {
          const db = ev.target.result;
          if (!db.objectStoreNames.contains(this.storeName)) {
            db.createObjectStore(this.storeName);
          }
        };
        request.onsuccess = (ev) => {
          this.db = ev.target.result;
          resolve(true);
        };
        request.onerror = (ev) => reject(ev.target.error || new Error('IndexedDB init error'));
      });
    },
    transaction(mode = 'readonly') {
      return this.db.transaction([this.storeName], mode).objectStore(this.storeName);
    },
    async get(key) {
      return new Promise((resolve, reject) => {
        try {
          const tx = this.db.transaction([this.storeName], 'readonly');
          const store = tx.objectStore(this.storeName);
          const req = store.get(key);
          req.onsuccess = () => resolve(req.result === undefined ? null : req.result);
          req.onerror = () => reject(req.error || new Error('IDB get error'));
        } catch (e) { reject(e); }
      });
    },
    async set(key, value) {
      return new Promise((resolve, reject) => {
        try {
          const tx = this.db.transaction([this.storeName], 'readwrite');
          const store = tx.objectStore(this.storeName);
          const req = store.put(value, key);
          req.onsuccess = () => resolve(true);
          req.onerror = () => reject(req.error || new Error('IDB set error'));
        } catch (e) { reject(e); }
      });
    },
    async delete(key) {
      return new Promise((resolve, reject) => {
        try {
          const tx = this.db.transaction([this.storeName], 'readwrite');
          const store = tx.objectStore(this.storeName);
          const req = store.delete(key);
          req.onsuccess = () => resolve(true);
          req.onerror = () => reject(req.error || new Error('IDB delete error'));
        } catch (e) { reject(e); }
      });
    },
    async listKeys(prefix = '') {
      return new Promise((resolve, reject) => {
        try {
          const tx = this.db.transaction([this.storeName], 'readonly');
          const store = tx.objectStore(this.storeName);
          const req = store.openCursor();
          const out = [];
          req.onsuccess = (ev) => {
            const cursor = ev.target.result;
            if (!cursor) { resolve(out); return; }
            const k = cursor.key;
            if (typeof k === 'string' && k.startsWith(prefix)) out.push(k);
            cursor.continue();
          };
          req.onerror = () => reject(req.error || new Error('IDB listKeys error'));
        } catch (e) { reject(e); }
      });
    },
    async exportAll() {
      return new Promise((resolve, reject) => {
        try {
          const tx = this.db.transaction([this.storeName], 'readonly');
          const store = tx.objectStore(this.storeName);
          const req = store.openCursor();
          const out = {};
          req.onsuccess = (ev) => {
            const cursor = ev.target.result;
            if (!cursor) { resolve(out); return; }
            out[cursor.key] = cursor.value;
            cursor.continue();
          };
          req.onerror = () => reject(req.error || new Error('IDB exportAll error'));
        } catch (e) { reject(e); }
      });
    }
  };

  // ---- FileSystem Adapter (Node) ----
  const FSAdapter = {
    name: 'fs',
    basePath: './mcif_data',
    async init(opts = {}) {
      if (!fs) throw new Error('fs not available in this environment (Node required)');
      this.basePath = opts.basePath || this.basePath;
      // ensure dir exists
      try { fs.mkdirSync(this.basePath, { recursive: true }); } catch (e) {}
      return true;
    },
    filePath(key) {
      return path.join(this.basePath, `${key}.json`);
    },
    async get(key) {
      try {
        const p = this.filePath(key);
        if (!fs.existsSync(p)) return null;
        const raw = fs.readFileSync(p, 'utf8');
        return JSON.parse(raw);
      } catch (e) { throw e; }
    },
    async set(key, value) {
      try {
        const p = this.filePath(key);
        fs.writeFileSync(p, JSON.stringify(value, null, 2), 'utf8');
        return true;
      } catch (e) { throw e; }
    },
    async delete(key) {
      try {
        const p = this.filePath(key);
        if (fs.existsSync(p)) fs.unlinkSync(p);
        return true;
      } catch (e) { throw e; }
    },
    async listKeys(prefix = '') {
      try {
        const files = fs.readdirSync(this.basePath);
        return files.filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, '')).filter(k => k.startsWith(prefix));
      } catch (e) { return []; }
    },
    async exportAll() {
      const keys = await this.listKeys();
      const out = {};
      for (const k of keys) out[k] = await this.get(k);
      return out;
    }
  };

  // ---- Remote Adapter (Stub) - must implement same interface; example shows fetch-based integration ----
  const RemoteAdapterStub = {
    name: 'remote',
    async init(opts = {}) {
      this.endpoint = opts.endpoint || null;
      if (!this.endpoint) throw new Error('Remote adapter requires endpoint config');
      this.authToken = opts.authToken || null;
      return true;
    },
    // adapter must implement get/set/delete/listKeys; here we throw unless user supplies functions
    async get(key) { throw new Error('Remote adapter get() not implemented - provide a custom adapter'); },
    async set(key, value) { throw new Error('Remote adapter set() not implemented - provide a custom adapter'); },
    async delete(key) { throw new Error('Remote adapter delete() not implemented - provide a custom adapter'); },
    async listKeys() { throw new Error('Remote adapter listKeys() not implemented - provide a custom adapter'); },
    async exportAll() { throw new Error('Remote adapter exportAll() not implemented - provide a custom adapter'); }
  };

  // -----------------------------
  // Main Data Layer
  // -----------------------------
  const DataLayer = {
    _adapter: null,
    _validator: null, // function(obj, schemaFragment) -> {valid: bool, errors: []}
    _inMemoryCache: new Map(),
    _opts: {
      adapter: 'indexeddb', // default in-browser; fallback to localstorage if not available
      // Node uses 'fs' adapter by default
      prefix: 'mcif:',
      validator: null,
      adapterOptions: {}
    },

    /**
     * Initialize DataLayer
     * opts: { adapter: 'indexeddb'|'localstorage'|'fs'|'remote'|customAdapter, adapterOptions, validator }
     */
    async init(opts = {}) {
      this._opts = Object.assign({}, this._opts, opts || {});
      if (opts.validator) this._validator = opts.validator;

      // choose adapter
      const name = this._opts.adapter;
      if (typeof name === 'object' && name !== null) {
        // custom adapter object provided directly
        this._adapter = name;
        if (!this._adapter.init) this._adapter.init = async () => true;
      } else if (name === 'indexeddb') {
        if (typeof indexedDB !== 'undefined') this._adapter = IndexedDBAdapter;
        else this._adapter = LocalStorageAdapter; // fallback
      } else if (name === 'localstorage') {
        this._adapter = LocalStorageAdapter;
      } else if (name === 'fs') {
        this._adapter = FSAdapter;
      } else if (name === 'remote') {
        this._adapter = RemoteAdapterStub; // user should override with real remote adapter
      } else {
        // unknown - default to localStorage if available, else throw
        if (typeof localStorage !== 'undefined') this._adapter = LocalStorageAdapter;
        else if (fs) this._adapter = FSAdapter;
        else throw new Error('No suitable adapter found for this environment');
      }

      // init adapter
      await this._adapter.init(this._opts.adapterOptions || {});
      return true;
    },

    /**
     * Inject a validator function (signature: async validate(obj, schemaFragment) => { valid: bool, errors: [] })
     */
    injectValidator(validatorFn) {
      this._validator = validatorFn;
    },

    // -------------------------
    // Session management
    // -------------------------
    /**
     * createSession(config)
     * config: { ownerId (optional), tier: 'Explorer'|'Architect'|'Visionary', mode: 'guided'|'self-paced'|'mentor', weightSet, privacy }
     */
    async createSession(config = {}) {
      const sessionId = makeId('s_');
      const nowTs = now();

      const defaultConfig = {
        weightSet: (config.weightSet || 'default'),
        mode: (config.mode || 'guided'),
        accessibility: (config.accessibility || { font: null, pacing: 'normal', voiceEnabled: false }),
        privacy: Object.assign({ storePersonalData: false, retainLedgerHashOnly: true }, (config.privacy || {}))
      };

      const session = {
        type: 'session',
        version: '7.1.0',
        session: {
          id: sessionId,
          owner: config.ownerId || null,
          createdAt: nowTs,
          updatedAt: nowTs,
          tier: config.tier || 'Explorer',
          status: 'initialized',
          phaseProgress: [],
          config: defaultConfig,
          coherenceWaveform: [],
          finalReport: null,
          archetype: null,
          auditHashes: []
        }
      };

      // validate if possible
      if (this._validator) {
        const v = await this._validator(session, 'SessionDocument').catch(e => ({ valid: false, errors: [e] }));
        if (!v || !v.valid) {
          throw new Error('Session validation failed: ' + JSON.stringify(v && v.errors ? v.errors : v));
        }
      }

      // persist
      await this._adapter.set(`session:${sessionId}`, session);
      // cache
      this._inMemoryCache.set(sessionId, session);
      // ledger entry
      const ledgerEntry = await this.appendLedgerEntry({
        actor: 'dataLayer',
        action: 'SESSION_CREATE',
        sessionId,
        payload: { sessionId, createdAt: nowTs },
        rationale: 'Initial session created'
      }, session.config.privacy);

      // store ledger hash pointer in session (opaque)
      if (session.session.config.privacy && session.session.config.privacy.retainLedgerHashOnly) {
        session.session.auditHashes = session.session.auditHashes || [];
        session.session.auditHashes.push(ledgerEntry.hash);
        await this._adapter.set(`session:${sessionId}`, session);
        this._inMemoryCache.set(sessionId, session);
      }

      return session;
    },

    /**
     * getSession(sessionId)
     */
    async getSession(sessionId) {
      if (this._inMemoryCache.has(sessionId)) return deepClone(this._inMemoryCache.get(sessionId));
      const s = await this._adapter.get(`session:${sessionId}`);
      if (s) this._inMemoryCache.set(sessionId, s);
      return deepClone(s);
    },

    /**
     * saveResponse(sessionId, responseObj)
     * responseObj must conform roughly to ResponseObject in schema
     * - Saves the response into phaseProgress.responses
     * - Validates if validator available
     * - Updates session.updatedAt
     * - Optionally persists an immediate ledger entry for audit
     */
    async saveResponse(sessionId, responseObj) {
      if (!responseObj || !responseObj.phaseId) throw new Error('Invalid response object (missing phaseId)');
      const session = await this.getSession(sessionId);
      if (!session) throw new Error('Session not found: ' + sessionId);

      // enforce privacy default: strip personal data unless allowed
      if (!session.session.config.privacy.storePersonalData) {
        if (responseObj.meta && responseObj.meta.device) {
          // keep device id only if explicitly allowed; else strip
          delete responseObj.meta.device;
        }
      }

      // validate response if validator provided
      if (this._validator) {
        const v = await this._validator(responseObj, 'ResponseObject').catch(e => ({ valid: false, errors: [e] }));
        if (!v || !v.valid) {
          throw new Error('Response validation failed: ' + JSON.stringify(v && v.errors ? v.errors : v));
        }
      }

      // find or create phaseProgress entry for this phase
      const phaseId = Number(responseObj.phaseId);
      let pp = (session.session.phaseProgress || []).find(p => Number(p.phaseId) === phaseId);
      if (!pp) {
        pp = {
          phaseId,
          startedAt: responseObj.timestamps ? responseObj.timestamps.startedAt || now() : now(),
          completedAt: null,
          metrics: {},
          responses: []
        };
        session.session.phaseProgress = session.session.phaseProgress || [];
        session.session.phaseProgress.push(pp);
      }

      // append response
      pp.responses = pp.responses || [];
      pp.responses.push(responseObj);

      // update completedAt tentatively if caller supplies submittedAt
      if (responseObj.timestamps && responseObj.timestamps.submittedAt) {
        pp.completedAt = responseObj.timestamps.submittedAt;
      } else {
        pp.completedAt = now();
      }

      // optional: update phase-level metrics placeholder (analysis will fill real metrics)
      pp.metrics = pp.metrics || {};
      // persist session
      session.session.updatedAt = now();
      await this._adapter.set(`session:${sessionId}`, session);
      this._inMemoryCache.set(sessionId, session);

      // ledger entry (store hashed pointer only if privacy settings say so)
      const ledgerEntry = await this.appendLedgerEntry({
        actor: 'dataLayer',
        action: 'RESPONSE_SAVE',
        sessionId,
        payload: { responseId: responseObj.id || makeId('r_'), phaseId: phaseId },
        rationale: 'Response stored'
      }, session.session.config.privacy);

      // if retainLedgerHashOnly, store the hash pointer in session.auditHashes (non-PII)
      if (session.session.config.privacy && session.session.config.privacy.retainLedgerHashOnly) {
        session.session.auditHashes = session.session.auditHashes || [];
        session.session.auditHashes.push(ledgerEntry.hash);
        await this._adapter.set(`session:${sessionId}`, session);
        this._inMemoryCache.set(sessionId, session);
      }

      return { ok: true, session, ledgerEntry };
    },

    /**
     * getSessionState(sessionId) returns a compact state for UI:
     * { sessionId, tier, status, phaseProgress: [{phaseId, startedAt, completedAt, responsesCount, metrics}] }
     */
    async getSessionState(sessionId) {
      const session = await this.getSession(sessionId);
      if (!session) return null;
      const state = {
        sessionId: session.session.id,
        tier: session.session.tier,
        status: session.session.status,
        phaseProgress: (session.session.phaseProgress || []).map(p => ({
          phaseId: p.phaseId,
          startedAt: p.startedAt,
          completedAt: p.completedAt,
          responsesCount: (p.responses || []).length,
          metrics: p.metrics || {}
        })),
        auditHashes: session.session.auditHashes || []
      };
      return state;
    },

    /**
     * appendLedgerEntry({ actor, action, sessionId, payload, rationale }, privacyConfig)
     * - creates ledger entry with hash using hashPayload
     * - persists to adapter at key ledger:<id>
     * - if privacyConfig.retainLedgerHashOnly true, payload may be stored hashed or minimized
     */
    async appendLedgerEntry(entry, privacyConfig = { storePersonalData: false, retainLedgerHashOnly: true }) {
      const id = makeId('ledger_');
      const timestamp = now();
      const base = {
        id,
        timestamp,
        actor: entry.actor || 'unknown',
        action: entry.action || 'UNKNOWN',
        sessionId: entry.sessionId || null,
        payload: null,
        payloadSummary: null,
        rationale: entry.rationale || ''
      };

      // minimize payload if privacy requires
      const payloadToStore = (privacyConfig.retainLedgerHashOnly && !privacyConfig.storePersonalData)
        ? { summary: (entry.payload && entry.payload.summary) || `${entry.action} for session ${entry.sessionId}` }
        : (entry.payload || {});

      base.payload = payloadToStore;
      base.payloadSummary = (payloadToStore && (payloadToStore.summary || JSON.stringify(Object.keys(payloadToStore).slice(0, 5)))) || '';

      const hash = await hashPayload(base);
      base.hash = hash;

      // persist
      await this._adapter.set(`ledger:${id}`, base);
      // optional: also persist session->ledger pointer (done by caller)
      return base;
    },

    /**
     * computeAndPersistReport(sessionId, analysisEngine)
     * - pulls session
     * - calls analysisEngine.computeComposite (or computeComposite(scoredPhases))
     * - persists finalReport and archetype into session document
     * - appends ledger entry for COMPOSITE_COMPUTE
     */
    async computeAndPersistReport(sessionId, analysisEngine, options = {}) {
      if (!analysisEngine || typeof analysisEngine.computeComposite !== 'function') throw new Error('analysisEngine with computeComposite required');
      const session = await this.getSession(sessionId);
      if (!session) throw new Error('session not found');

      // assemble scoredPhases array: for each phaseProgress, take response.analysis if present, else call analysisEngine.scoreResponse for each response.
      const scoredPhases = [];
      for (const pp of (session.session.phaseProgress || [])) {
        const responses = pp.responses || [];
        const phaseScored = {
          phaseId: pp.phaseId,
          domainContributions: {},
          subScores: {},
          probabilities: {},
          responses: [],
          timestamps: { startedAt: pp.startedAt, completedAt: pp.completedAt }
        };
        for (const r of responses) {
          let analysisResult = r.analysis;
          if (!analysisResult) {
            // try to score via analysisEngine
            try {
              // fetch phaseDef from prompts if possible for richer scoring
              let phaseDef = null;
              try {
                if (analysisEngine._prompts && Array.isArray(analysisEngine._prompts.prompts)) {
                  phaseDef = analysisEngine._prompts.prompts.find(p => p.phaseId === pp.phaseId || p.id === r.promptId);
                }
              } catch (e) { phaseDef = null; }
              if (!phaseDef) {
                // fallback minimal phaseDef
                phaseDef = { id: pp.phaseId, metrics: Object.keys(r.analysis && r.analysis.rawMetrics || {}).map(k => ({ id: k, name: k })) };
              }
              analysisResult = await analysisEngine.scoreResponse(r, phaseDef, { weightSet: (session.session.config && session.session.config.weightSet) || undefined });
              // attach to response and persist
              r.analysis = analysisResult;
              // persist updated response into session
            } catch (e) {
              // ignore analysis failure for a response; continue
              analysisResult = { rawMetrics: {}, subScores: {}, probabilities: {}, explanations: [{ metric: 'analysis_error', reason: String(e) }] };
            }
          }
          // merge into phaseScored aggregation
          // domainContributions from analysisResult if present
          if (analysisResult.domainContributions) {
            Object.keys(analysisResult.domainContributions).forEach(d => {
              phaseScored.domainContributions[d] = (phaseScored.domainContributions[d] || 0) + Number(analysisResult.domainContributions[d] || 0);
            });
          }
          // pick primary subScore if available
          if (analysisResult.subScores) {
            Object.assign(phaseScored.subScores, analysisResult.subScores);
          }
          if (analysisResult.probabilities) Object.assign(phaseScored.probabilities, analysisResult.probabilities);
          // push response copy
          phaseScored.responses.push({
            id: r.id,
            text: r.text,
            timestamps: r.timestamps,
            analysis: analysisResult
          });
        } // responses loop

        // normalize domainContributions by number of responses in phase (if >0)
        const respCount = Math.max(1, (phaseScored.responses || []).length);
        Object.keys(phaseScored.domainContributions).forEach(d => {
          phaseScored.domainContributions[d] = Number((phaseScored.domainContributions[d] / respCount).toFixed(4));
        });

        scoredPhases.push(phaseScored);
      } // phaseProgress loop

      // call analysisEngine.computeComposite
      const finalReport = await analysisEngine.computeComposite(scoredPhases, { weightSet: (this._opts && this._opts.weights) || undefined });
      // persist finalReport
      session.session.finalReport = finalReport;
      session.session.archetype = finalReport.archetype || null;
      session.session.updatedAt = now();
      session.session.status = 'completed';

      await this._adapter.set(`session:${sessionId}`, session);
      this._inMemoryCache.set(sessionId, session);

      // ledger entry
      const ledgerEntry = await this.appendLedgerEntry({
        actor: 'analysisEngine',
        action: 'COMPOSITE_COMPUTE',
        sessionId,
        payload: { compositeScore: finalReport.compositeScore, tier: finalReport.tier },
        rationale: 'Composite score computed and stored'
      }, session.session.config.privacy);

      // store ledger hash pointer
      if (session.session.config.privacy && session.session.config.privacy.retainLedgerHashOnly) {
        session.session.auditHashes = session.session.auditHashes || [];
        session.session.auditHashes.push(ledgerEntry.hash);
        await this._adapter.set(`session:${sessionId}`, session);
      }

      return { finalReport, ledgerEntry };
    },

    /**
     * exportSessionAsJSON(sessionId, options)
     * options: { includeLedger: bool (default false), anonymize: bool (default true) }
     * Returns JSON object.
     */
    async exportSessionAsJSON(sessionId, options = { includeLedger: false, anonymize: true }) {
      const session = await this.getSession(sessionId);
      if (!session) throw new Error('session not found');
      // clone
      const out = deepClone(session);
      if (options.anonymize) {
        // remove owner
        out.session.owner = null;
        // remove any meta.device or personal strings in responses (best-effort)
        (out.session.phaseProgress || []).forEach(pp => {
          (pp.responses || []).forEach(r => {
            if (r.meta) {
              delete r.meta.device;
              delete r.meta.ip;
            }
            // optional: redact long texts? We keep texts by default for research; caller chooses anonymize=false to keep.
          });
        });
      }
      if (!options.includeLedger) {
        // remove ledger objects, but keep auditHashes pointers
        // we do not enumerate ledger store; caller can request separate ledger export if needed
      } else {
        // attempt to export ledger entries referenced in auditHashes
        out.ledger = [];
        const hashes = out.session.auditHashes || [];
        for (const h of hashes) {
          // naive: list all ledger keys and try to find hashes - adapter supports exportAll
          try {
            const all = await this._adapter.exportAll();
            // adapter exportAll returns object keyed by raw keys; we will collect ledger:* entries whose 'hash' matches
            for (const [k, v] of Object.entries(all || {})) {
              if (k.startsWith('ledger:') && v && v.hash === h) out.ledger.push(v);
            }
          } catch (e) {
            // ignore inability to export ledger
          }
        }
      }
      return out;
    },

    /**
     * deleteSession(sessionId, options)
     * options: { removeLedgerEntries: boolean (default false) }
     * Behavior: removes session data; ledger entries are retained by default as hashed pointers for audit unless removeLedgerEntries=true
     */
    async deleteSession(sessionId, options = { removeLedgerEntries: false }) {
      const session = await this.getSession(sessionId);
      if (!session) return { ok: false, reason: 'not_found' };

      // remove session object
      await this._adapter.delete(`session:${sessionId}`);
      this._inMemoryCache.delete(sessionId);

      if (options.removeLedgerEntries) {
        // attempt to delete ledger keys matching sessionId (best-effort)
        try {
          const all = await this._adapter.exportAll();
          for (const [k, v] of Object.entries(all || {})) {
            if (k.startsWith('ledger:') && v && v.sessionId === sessionId) {
              await this._adapter.delete(k);
            }
          }
        } catch (e) {
          // ignore
        }
      } else {
        // write an audit deletion entry (hashed)
        await this.appendLedgerEntry({
          actor: 'dataLayer',
          action: 'SESSION_DELETE',
          sessionId,
          payload: { sessionId, deletedAt: now() },
          rationale: 'Session data deleted; ledger retained as hash pointer per privacy policy'
        }, { storePersonalData: false, retainLedgerHashOnly: true });
      }

      return { ok: true };
    },

    /**
     * listSessions(prefix)
     * Returns array of session ids (strings)
     */
    async listSessions(prefix = '') {
      const keys = await this._adapter.listKeys();
      return keys.filter(k => k.startsWith('session:')).map(k => k.replace('session:', '')).filter(k => k.startsWith(prefix));
    }
  };

  // -----------------------------
  // Export / compatibility
  // -----------------------------
  const exposed = DataLayer;
  // In Node, export module.exports
  if (typeof module === 'object' && module.exports) {
    return exposed;
  } else {
    return exposed; // attached to window as MCIFData by wrapper
  }
});
