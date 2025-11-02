/* ==========================================================
   logic.js
   MCIF 7.1 — Core Logic Engine
   Full-Scale Adaptive Meta-Cognitive Intelligence Framework
   Author: Hayden Andrew Carr | Meta-Cognitive Intelligence Project
   ========================================================== */

(function () {
  const MCIF = {
    schema: null,
    weights: null,
    prompts: null,
    ledger: [],
    currentPhase: 1,
    phaseStates: {},
    metrics: {},
    initialized: false,

    async init() {
      try {
        const [schema, weights, prompts] = await Promise.all([
          fetch('./schema/mcif-schema.json').then(r => r.json()),
          fetch('./schema/weights.json').then(r => r.json()),
          fetch('./schema/prompts.json').then(r => r.json())
        ]);
        this.schema = schema;
        this.weights = weights;
        this.prompts = prompts;
        this.buildMetrics();
        this.initialized = true;
        console.log('%cMCIF Logic Core Initialized', 'color:#00ffaa;font-weight:bold;');
      } catch (err) {
        console.error('MCIF Initialization Error:', err);
      }
    },

    buildMetrics() {
      // Initialize metrics based on schema domains and subdomains
      for (const domain of this.schema.domains) {
        this.metrics[domain.id] = {
          name: domain.name,
          total: 0,
          count: 0,
          score: 0,
          subdomains: {}
        };
        for (const sub of domain.subdomains) {
          this.metrics[domain.id].subdomains[sub.id] = {
            name: sub.name,
            total: 0,
            count: 0,
            score: 0
          };
        }
      }
    },

    recordResponse(response) {
      const { questionId, answer, phase } = response;
      const domain = this.findDomainByQuestion(questionId);
      if (!domain) return;

      const weight = this.weights.phaseWeights[`phase${phase}`] || 1;
      const cognitiveBias = this.getBiasAdjustment(answer, phase);
      const coherence = this.getCoherenceScore(answer, questionId);

      const finalScore = (weight * coherence * cognitiveBias).toFixed(3);

      // Ledger entry
      this.ledger.push({
        timestamp: Date.now(),
        phase,
        questionId,
        answer,
        finalScore,
        domain: domain.id
      });

      // Update domain + subdomain metrics
      const sub = this.findSubdomainByQuestion(domain, questionId);
      this.metrics[domain.id].total += parseFloat(finalScore);
      this.metrics[domain.id].count++;
      this.metrics[domain.id].score = (this.metrics[domain.id].total / this.metrics[domain.id].count).toFixed(3);

      if (sub) {
        this.metrics[domain.id].subdomains[sub.id].total += parseFloat(finalScore);
        this.metrics[domain.id].subdomains[sub.id].count++;
        this.metrics[domain.id].subdomains[sub.id].score = (
          this.metrics[domain.id].subdomains[sub.id].total /
          this.metrics[domain.id].subdomains[sub.id].count
        ).toFixed(3);
      }

      // Phase tracking
      if (!this.phaseStates[phase]) this.phaseStates[phase] = [];
      this.phaseStates[phase].push(finalScore);
      console.log(`%c[MCIF] Recorded: Q${questionId} P${phase} = ${finalScore}`, 'color:#aaa;');
    },

    findDomainByQuestion(id) {
      return this.schema.domains.find(d => d.subdomains.some(s => s.questions.includes(id)));
    },

    findSubdomainByQuestion(domain, id) {
      return domain.subdomains.find(s => s.questions.includes(id));
    },

    getBiasAdjustment(answer, phase) {
      // Adjust based on reflective and intuitive polarity (MCIF 7.1 principle)
      const phaseMod = this.weights.biasAdjustments.reflective[phase] || 1;
      const biasFactor = answer.length % 2 === 0 ? phaseMod * 1.05 : phaseMod * 0.95;
      return biasFactor;
    },

    getCoherenceScore(answer, questionId) {
      // Heuristic semantic coherence simulation (future local AI plug-in)
      const clarity = answer.match(/[a-zA-Z]/g)?.length || 0;
      const diversity = new Set(answer.toLowerCase().replace(/[^a-z]/g, '').split('')).size;
      const ratio = clarity > 0 ? diversity / clarity : 0;
      return Math.min(Math.max(ratio * 4, 0.5), 1.25); // normalized
    },

    computePhaseComposite(phase) {
      const scores = this.phaseStates[phase] || [];
      const avg = scores.reduce((a, b) => a + parseFloat(b), 0) / (scores.length || 1);
      const weight = this.weights.phaseWeights[`phase${phase}`] || 1;
      const composite = (avg * weight).toFixed(3);
      console.log(`%cPhase ${phase} Composite = ${composite}`, 'color:#00ccff;');
      return composite;
    },

    getArchetypeMapping() {
      // Reflect current scores against archetype matrix
      const archetypes = this.weights.archetypeWeights;
      const output = [];
      for (const [key, values] of Object.entries(archetypes)) {
        let score = 0;
        for (const [domain, w] of Object.entries(values)) {
          if (this.metrics[domain]) score += this.metrics[domain].score * w;
        }
        output.push({ archetype: key, alignment: (score / Object.keys(values).length).toFixed(3) });
      }
      output.sort((a, b) => b.alignment - a.alignment);
      return output;
    },

    computeFinalReport() {
      const composites = {};
      for (let p = 1; p <= 6; p++) {
        composites[`phase${p}`] = this.computePhaseComposite(p);
      }
      const archetypes = this.getArchetypeMapping();
      const totalScore = Object.values(this.metrics)
        .reduce((a, d) => a + parseFloat(d.score), 0) / Object.keys(this.metrics).length;
      return {
        timestamp: new Date().toISOString(),
        composites,
        archetypes,
        overall: totalScore.toFixed(3),
        ledger: this.ledger,
        metrics: this.metrics
      };
    },

    exportLedger() {
      const blob = new Blob([JSON.stringify(this.computeFinalReport(), null, 2)], {
        type: 'application/json'
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `MCIF_Report_${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      console.log('%cLedger exported successfully.', 'color:#00ff99;');
    },

    resetAll() {
      this.ledger = [];
      this.phaseStates = {};
      for (const d of Object.values(this.metrics)) {
        d.total = d.count = d.score = 0;
        for (const s of Object.values(d.subdomains)) {
          s.total = s.count = s.score = 0;
        }
      }
      console.log('%cMCIF Logic reset complete.', 'color:#ff6600;');
    }
  };

  window.MCIF = MCIF;
})();
