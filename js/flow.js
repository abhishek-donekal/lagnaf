// ── HubSpot Configuration ─────────────────────────────────────────────────
// Portal ID is used for reference only — API calls route through /api/hs
// which holds the Private App token server-side.
const LAGNAF_HS_CONFIG = {
  portalId: '245493473',
};
// ─────────────────────────────────────────────────────────────────────────

const Flow = {
  set(key, val) { localStorage.setItem('lagnaf_' + key, JSON.stringify(val)); },
  get(key) { const v = localStorage.getItem('lagnaf_' + key); return v ? JSON.parse(v) : null; },
  clear() { Object.keys(localStorage).filter(k => k.startsWith('lagnaf_')).forEach(k => localStorage.removeItem(k)); },

  // Returns a Promise<string> — calls /api/counter for a sequential code.
  // role: 'ba' (Brand Ambassador) | 'bo' (Business Owner) | 'tech' (Technician)
  generateUIN(role) {
    role = role || 'bo';
    const prefixMap = { ba: 'LagBA', bo: 'LagBO', tech: 'LagTECH' };
    const prefix = prefixMap[role] || 'LagBO';

    return fetch('/api/counter?role=' + role)
      .then(r => r.json())
      .then(d => {
        if (d.code) return d.code;
        throw new Error('no code in response');
      })
      .catch(() => {
        // Local fallback — not sequential but never blocks the funnel
        const n = (Math.floor(Date.now() / 1000) % 8999) + 1001;
        return prefix + '-' + String(n).padStart(4, '0');
      });
  },

  generateAmbassadorCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'LAGNAF-';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  },

  // Reads ?ref=LAGNAF-XXXXXX from the URL and persists it in localStorage.
  captureRefParam() {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('ref') || '';
    if (raw && /^LAGNAF-[A-Z0-9]{4,8}$/i.test(raw)) {
      const code = raw.toUpperCase();
      this.set('ref_param', code);
      return code;
    }
    return this.get('ref_param') || null;
  },

  // Guard — call on pages that require NDA completion
  requireNDA() {
    if (!this.get('nda_complete')) { window.location.href = 'entry-gateway.html'; }
  },

  // Guard — call on pages that require path selection
  requirePath(expectedPath) {
    this.requireNDA();
    if (expectedPath && this.get('path') !== expectedPath) { window.location.href = 'path-routing.html'; }
  },

  // Step 1: Entry form submit
  submitEntry(data) {
    this.set('entry', data);
    this.set('status', 'pending_nda');

    const referralRaw = (data.referral || '').trim();
    const codeMatch = referralRaw.match(/\b(LAGNAF-[A-Z0-9]{4,8})\b/i);
    const storedRef = this.get('ref_param');
    const ambassadorCode = codeMatch ? codeMatch[1].toUpperCase() : (storedRef || null);

    const isFounderDirect = !ambassadorCode && (
      referralRaw === '' ||
      referralRaw.toLowerCase() === 'direct' ||
      referralRaw.toLowerCase() === 'founder'
    );

    const attribution = {
      lagnaf_referral_source:            referralRaw || 'Direct',
      lagnaf_ambassador_referral_code:   ambassadorCode || '',
      lagnaf_referring_ambassador:       ambassadorCode ? ambassadorCode : '',
      lagnaf_attribution_source:         ambassadorCode ? 'Brand Ambassador' : (isFounderDirect ? 'Founder Direct' : 'Organic / Other'),
      lagnaf_direct_founder_attribution: String(isFounderDirect),
      lagnaf_entry_path:                 data.business_type || '',
      lagnaf_status:                     'Pending NDA',
    };

    this.set('attribution', attribution);

    this.hubspotUpsert({
      email:     data.email,
      firstname: data.first,
      lastname:  data.last,
      phone:     data.phone,
      ...attribution,
    }, 'Entry — Pending NDA');

    window.location.href = 'nda-gate.html';
  },

  // Step 2: NDA complete — assign sequential UIN, update HubSpot
  // Role-based prefixes: LagBA (ambassador) | LagBO (operator) | LagTECH (technician)
  completeNDA() {
    const role = this.get('ambassador_track') ? 'ba'
               : this.get('tech_track')       ? 'tech'
               : 'bo';

    this.generateUIN(role).then(uin => {
      this.set('nda_complete', true);
      this.set('uin', uin);
      this.set('status', 'nda_completed');

      const attribution = this.get('attribution') || {};
      const ambCode = this.get('ambassador_code');
      this.hubspotUpsert({
        ...attribution,
        lagnaf_uin:    uin,
        lagnaf_status: 'NDA Completed',
        ...(ambCode ? { lagnaf_ambassador_code: ambCode } : {}),
      }, 'NDA Completed');

      window.location.href = 'uin-issued.html';
    });
  },

  // Step 3: Path select
  selectPath(path) {
    this.set('path', path);
    this.set('status', 'path_' + path);

    this.hubspotUpsert({
      lagnaf_uin:         this.get('uin'),
      lagnaf_system_path: path,
      lagnaf_status:      'Path Selected – ' + path,
    }, 'Path Selected – ' + path);

    const map = {
      'new-operator':      'new-operator.html',
      'existing-operator': 'existing-operator.html',
      'ambassador':        'ambassador-agreement.html'
    };
    window.location.href = map[path];
  },

  // Step 4: Build select
  selectBuild(build, price) {
    this.set('build', { name: build, price });
    this.set('status', 'build_selected');

    this.hubspotUpsert({
      lagnaf_uin:            this.get('uin'),
      lagnaf_build_selected: build,
      lagnaf_build_price:    String(price),
      lagnaf_status:         'Build Selected – ' + build,
    }, 'Build Selected – ' + build);

    window.location.href = 'operator-dashboard.html';
  },

  // ── Ambassador Pre-NDA flow ──────────────────────────────────────────────

  // Step A: Pre-qualification form — generates .card code, fires to HubSpot
  submitAmbassadorPreQual(data) {
    const ambCode = this.generateAmbassadorCode();
    this.set('entry', data);
    this.set('ambassador_track', true);
    this.set('ambassador_code', ambCode);
    this.set('status', 'ambassador_prequalified');
    this.set('amb_modules_complete', 0);

    const storedRef = this.get('ref_param');
    const codeMatch = (data.referral || '').match(/\b(LAGNAF-[A-Z0-9]{4,8})\b/i);
    const referringCode = codeMatch ? codeMatch[1].toUpperCase() : (storedRef || null);

    this.hubspotUpsert({
      email:                             data.email,
      firstname:                         data.first,
      lastname:                          data.last,
      phone:                             data.phone,
      lagnaf_ambassador_code:            ambCode,
      lagnaf_ambassador_candidate:       'true',
      lagnaf_network_size:               data.network_size    || '',
      lagnaf_industry_connections:       data.industry_connections || '',
      lagnaf_referral_capability:        data.referral_capability  || '',
      lagnaf_referral_source:            data.referral        || '',
      lagnaf_ambassador_referral_code:   referringCode        || '',
      lagnaf_attribution_source:         referringCode ? 'Brand Ambassador' : 'Organic / Other',
      lagnaf_status:                     'Ambassador Pre-Qualified',
    }, 'Ambassador Pre-Qualified');

    window.location.href = 'ambassador-dot-setup.html';
  },

  // Step B: .card + Secure Activation Verification™ — routes to NDA
  confirmDOTSetup() {
    this.set('dot_setup_complete', true);
    this.set('status', 'dot_setup_confirmed');

    this.hubspotUpsert({
      lagnaf_ambassador_code: this.get('ambassador_code'),
      lagnaf_status:          '.card Setup Confirmed — Pending NDA',
    }, '.card Setup Confirmed');

    window.location.href = 'nda-gate.html';
  },

  // Guard — ambassador-track pages only
  requireAmbassadorTrack() {
    if (!this.get('ambassador_track')) {
      window.location.href = 'ambassador-entry.html';
    }
  },

  // ── Legacy ambassador path (post-path-selection fallback) ───────────────
  submitAmbassador(data) {
    const ambCode = this.get('ambassador_code') || this.generateAmbassadorCode();
    this.set('ambassador_data', data);
    this.set('ambassador_code', ambCode);
    this.set('status', 'ambassador_candidate');
    this.set('amb_modules_complete', 0);

    const entry = this.get('entry') || {};
    this.hubspotUpsert({
      email:                       entry.email   || '',
      firstname:                   entry.first   || '',
      lastname:                    entry.last    || '',
      phone:                       entry.phone   || '',
      lagnaf_uin:                  this.get('uin'),
      lagnaf_ambassador_candidate: 'true',
      lagnaf_network_size:         data.network_size         || '',
      lagnaf_industry_connections: data.industry_connections || '',
      lagnaf_referral_capability:  data.referral_capability  || '',
      lagnaf_ambassador_code:      ambCode,
      lagnaf_status:               'Ambassador Candidate',
    }, 'Ambassador Candidate');

    window.location.href = 'ambassador-agreement.html';
  },

  // Track ambassador module completion (1–5) — fires HubSpot update per module
  completeAmbassadorModule(moduleNum) {
    const current = this.get('amb_modules_complete') || 0;
    if (moduleNum > current) {
      this.set('amb_modules_complete', moduleNum);
      const isDeployed = moduleNum === 5;

      this.hubspotUpsert({
        lagnaf_uin:                 this.get('uin'),
        lagnaf_amb_module_complete: String(moduleNum),
        lagnaf_ambassador_code:     this.get('ambassador_code'),
        lagnaf_status:              isDeployed
          ? 'Brand Ambassador — Deployed'
          : 'Brand Ambassador Training — Module ' + moduleNum,
      }, 'Ambassador Module ' + moduleNum + ' Complete');
    }
    if (moduleNum === 5) {
      this.set('status', 'ambassador_active');
    }
  },

  // ── HubSpot Upsert — calls /api/hs (server-side token, never exposed) ───
  // Merges email from stored entry data automatically.
  // label is for console logging only.
  hubspotUpsert(properties, label) {
    const entry = this.get('entry') || {};
    const email = (properties.email || entry.email || '').trim().toLowerCase();

    if (!email) {
      console.log('[HubSpot] skipped — no email yet:', label);
      return Promise.resolve();
    }

    const { email: _e, ...rest } = properties;
    const payload = { email, properties: rest };

    console.log('[HubSpot] →', label, email);

    return fetch('/api/hs', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    })
    .then(r => r.json())
    .then(d => { console.log('[HubSpot] ←', label, d); })
    .catch(e => { console.error('[HubSpot] error', label, e); });
  },

  // ── Legacy stub — kept so any pages referencing these don't break ────────
  hubspotFormSubmit(formId, fields) {
    return this.hubspotUpsert(fields, 'form:' + formId);
  },
  hubspotIdentify(properties, eventLabel) {
    return this.hubspotUpsert(properties, eventLabel);
  },
};
