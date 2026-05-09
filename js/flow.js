// ── HubSpot Configuration ─────────────────────────────────────────────────
// Replace these values with your actual HubSpot portal and form IDs.
// Find Portal ID: HubSpot → Settings → Account Setup → Integrations → HubSpot API Key
// Find Form IDs: HubSpot → Marketing → Forms → [form] → Share → Embed Code (look for formId)
const LAGNAF_HS_CONFIG = {
  portalId:        'YOUR_PORTAL_ID',       // e.g. '12345678'
  formEntry:       'YOUR_ENTRY_FORM_ID',   // entry-gateway form GUID
  formAmbassador:  'YOUR_AMBASSADOR_FORM_ID', // ambassador candidacy form GUID
};
// ─────────────────────────────────────────────────────────────────────────

const Flow = {
  set(key, val) { localStorage.setItem('lagnaf_' + key, JSON.stringify(val)); },
  get(key) { const v = localStorage.getItem('lagnaf_' + key); return v ? JSON.parse(v) : null; },
  clear() { Object.keys(localStorage).filter(k => k.startsWith('lagnaf_')).forEach(k => localStorage.removeItem(k)); },

  generateUIN() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let id = 'DRY-';
    for (let i = 0; i < 8; i++) id += chars[Math.floor(Math.random() * chars.length)];
    return id;
  },

  generateAmbassadorCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'LAGNAF-';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  },

  // Reads ?ref=LAGNAF-XXXXXX from the URL and persists it in localStorage.
  // Call on any page that may receive a referral link — value survives navigation.
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

    // Match LAGNAF-XXXXXX referral code format (e.g. LAGNAF-144B41)
    const codeMatch = referralRaw.match(/\b(LAGNAF-[A-Z0-9]{4,8})\b/i);
    // Fall back to URL param captured earlier if no code typed
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
      lagnaf_direct_founder_attribution: isFounderDirect,
      lagnaf_entry_path:                 data.business_type || '',
      lagnaf_hs_lifecycle_stage:         'lead',
      lagnaf_status:                     'Pending NDA',
    };

    this.set('attribution', attribution);

    const hsFields = {
      email:                             data.email,
      firstname:                         data.first,
      lastname:                          data.last,
      phone:                             data.phone,
      lagnaf_referral_source:            attribution.lagnaf_referral_source,
      lagnaf_ambassador_referral_code:   attribution.lagnaf_ambassador_referral_code,
      lagnaf_referring_ambassador:       attribution.lagnaf_referring_ambassador,
      lagnaf_attribution_source:         attribution.lagnaf_attribution_source,
      lagnaf_direct_founder_attribution: String(attribution.lagnaf_direct_founder_attribution),
      lagnaf_entry_path:                 attribution.lagnaf_entry_path,
      lagnaf_status:                     'Pending NDA',
    };
    this.hubspotFormSubmit(LAGNAF_HS_CONFIG.formEntry, hsFields);
    this.hubspotIdentify({ ...data, ...attribution }, 'New Entry – Pending NDA');
    window.location.href = 'nda-gate.html';
  },

  // Step 2: NDA complete — update contact with UIN
  completeNDA() {
    const uin = this.generateUIN();
    this.set('nda_complete', true);
    this.set('uin', uin);
    this.set('status', 'nda_completed');

    const attribution = this.get('attribution') || {};
    this.hubspotIdentify({
      ...attribution,
      lagnaf_uin:    uin,
      lagnaf_status: 'NDA Completed',
    }, 'NDA Completed');

    window.location.href = 'uin-issued.html';
  },

  // Step 3: Path select
  selectPath(path) {
    this.set('path', path);
    this.set('status', 'path_' + path);

    this.hubspotIdentify({
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

    this.hubspotIdentify({
      lagnaf_uin:            this.get('uin'),
      lagnaf_build_selected: build,
      lagnaf_build_price:    price,
      lagnaf_status:         'Build Selected – ' + build,
    }, 'Build Selected – ' + build);

    window.location.href = 'operator-dashboard.html';
  },

  // ── Ambassador Pre-NDA flow (new primary path) ──────────────────────────

  // Step A: Pre-qualification form (public, before NDA)
  // Generates internal activation reference (never exposed client-side per SAV™ protocol)
  // Stores as entry data so nda-gate.html can read name/email
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

    this.hubspotFormSubmit(LAGNAF_HS_CONFIG.formAmbassador, {
      email:                             data.email,
      firstname:                         data.first,
      lastname:                          data.last,
      phone:                             data.phone,
      lagnaf_ambassador_code:            ambCode,
      lagnaf_ambassador_candidate:       'true',
      lagnaf_network_size:               data.network_size,
      lagnaf_industry_connections:       data.industry_connections,
      lagnaf_referral_capability:        data.referral_capability,
      lagnaf_referral_source:            data.referral || '',
      lagnaf_ambassador_referral_code:   referringCode || '',
      lagnaf_attribution_source:         referringCode ? 'Brand Ambassador' : 'Organic / Other',
      lagnaf_status:                     'Ambassador Pre-Qualified',
    });
    this.hubspotIdentify({
      lagnaf_ambassador_code: ambCode,
      lagnaf_status:          'Ambassador Pre-Qualified',
    }, 'Ambassador Pre-Qualified');

    window.location.href = 'ambassador-dot-setup.html';
  },

  // Step B: DOT card + Secure Activation Verification™ acknowledgment — routes to NDA
  confirmDOTSetup() {
    this.set('dot_setup_complete', true);
    this.set('status', 'dot_setup_confirmed');
    this.hubspotIdentify({
      lagnaf_ambassador_code: this.get('ambassador_code'),
      lagnaf_status:          'DOT Setup Confirmed',
    }, 'DOT Setup Confirmed');
    window.location.href = 'nda-gate.html';
  },

  // Guard — ambassador-track pages only
  requireAmbassadorTrack() {
    if (!this.get('ambassador_track')) {
      window.location.href = 'ambassador-entry.html';
    }
  },

  // ── Legacy ambassador candidacy form (post-path-selection fallback) ──────
  // Used if someone reaches path-routing.html via the operator entry flow
  // and selects the ambassador path. Code may already exist from pre-qual.
  submitAmbassador(data) {
    const ambCode = this.get('ambassador_code') || this.generateAmbassadorCode();
    this.set('ambassador_data', data);
    this.set('ambassador_code', ambCode);
    this.set('status', 'ambassador_candidate');
    this.set('amb_modules_complete', 0);

    const entry = this.get('entry') || {};
    this.hubspotFormSubmit(LAGNAF_HS_CONFIG.formAmbassador, {
      email:                       entry.email   || '',
      firstname:                   entry.first   || '',
      lastname:                    entry.last    || '',
      phone:                       entry.phone   || '',
      lagnaf_uin:                  this.get('uin'),
      lagnaf_ambassador_candidate: 'true',
      lagnaf_network_size:         data.network_size,
      lagnaf_industry_connections: data.industry_connections,
      lagnaf_referral_capability:  data.referral_capability,
      lagnaf_ambassador_code:      ambCode,
      lagnaf_status:               'Ambassador Candidate',
    });
    this.hubspotIdentify({
      lagnaf_uin:                  this.get('uin'),
      lagnaf_ambassador_candidate: true,
      lagnaf_ambassador_code:      ambCode,
      lagnaf_status:               'Ambassador Candidate',
    }, 'Ambassador Candidate');

    window.location.href = 'ambassador-agreement.html';
  },

  // Track ambassador module completion (1–5)
  completeAmbassadorModule(moduleNum) {
    const current = this.get('amb_modules_complete') || 0;
    if (moduleNum > current) {
      this.set('amb_modules_complete', moduleNum);
      this.hubspotIdentify({
        lagnaf_uin:                      this.get('uin'),
        lagnaf_amb_module_complete:      moduleNum,
        lagnaf_status:                   moduleNum === 5 ? 'Ambassador Active' : 'Ambassador Training – Module ' + moduleNum,
      }, 'Ambassador Module ' + moduleNum + ' Complete');
    }
    if (moduleNum === 5) {
      this.set('status', 'ambassador_active');
    }
  },

  // ── HubSpot Forms API v3 ─────────────────────────────────────────────────
  // Submits directly to HubSpot via the Forms API — creates/updates contact
  // regardless of whether the tracking pixel has fired.
  // Requires LAGNAF_HS_CONFIG.portalId + the relevant form ID to be set above.
  //
  // Internal property names must match exactly what is configured in
  // HubSpot → Settings → Properties → Contact properties.
  hubspotFormSubmit(formId, fields) {
    const pid = LAGNAF_HS_CONFIG.portalId;
    if (!pid || pid === 'YOUR_PORTAL_ID' || !formId || formId.startsWith('YOUR_')) {
      console.log('[HubSpot Forms API – not configured]', formId, fields);
      return Promise.resolve();
    }
    const url = 'https://api.hsforms.com/submissions/v3/integration/submit/' + pid + '/' + formId;
    const body = {
      fields: Object.entries(fields)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([name, value]) => ({ name, value: String(value) })),
      context: {
        pageUri:  window.location.href,
        pageName: document.title,
      }
    };
    return fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })
    .then(function(r) { console.log('[HubSpot Forms API]', r.status, formId); })
    .catch(function(e) { console.error('[HubSpot Forms API error]', e); });
  },

  // ── HubSpot Tracking Pixel ────────────────────────────────────────────────
  // Uses HubSpot tracking code (_hsq) for identify + event calls.
  // Requires the HubSpot tracking snippet on each page.
  hubspotIdentify(properties, eventLabel) {
    if (typeof window._hsq === 'undefined') {
      console.log('[HubSpot – not loaded]', eventLabel, properties);
      return;
    }

    const entry = this.get('entry');

    if (entry && entry.email) {
      window._hsq.push(['identify', {
        email:     entry.email,
        firstname: entry.first  || '',
        lastname:  entry.last   || '',
        phone:     entry.phone  || '',
        ...properties
      }]);
    } else {
      window._hsq.push(['identify', properties]);
    }

    window._hsq.push(['trackEvent', { id: 'lagnaf_funnel_' + eventLabel.toLowerCase().replace(/[^a-z0-9]+/g, '_') }]);
    window._hsq.push(['trackPageView']);

    console.log('[HubSpot]', eventLabel, properties);
  }
};
