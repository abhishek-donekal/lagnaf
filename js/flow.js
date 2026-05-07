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
  // Maps referral_source → HubSpot attribution properties surfaced on contact record
  submitEntry(data) {
    this.set('entry', data);
    this.set('status', 'pending_nda');

    // Determine if this is a direct founder attribution (no referral code, direct contact)
    const referralRaw = (data.referral || '').trim();
    const isFounderDirect = referralRaw === '' || referralRaw.toLowerCase() === 'direct' || referralRaw.toLowerCase() === 'founder';

    // Extract ambassador referral code if present (format: AMB-XXXXXXXX or similar)
    const ambassadorCodeMatch = referralRaw.match(/\b([A-Z]{2,4}-[A-Z0-9]{4,10})\b/i);
    const ambassadorCode = ambassadorCodeMatch ? ambassadorCodeMatch[1].toUpperCase() : null;

    const attribution = {
      // HubSpot property internal names — match exactly to your contact record properties
      lagnaf_referral_source:            referralRaw || 'Direct',
      lagnaf_ambassador_referral_code:   ambassadorCode || '',
      lagnaf_referring_ambassador:       ambassadorCode ? referralRaw : '',
      lagnaf_attribution_source:         ambassadorCode ? 'Brand Ambassador' : (isFounderDirect ? 'Founder Direct' : 'Organic / Other'),
      lagnaf_direct_founder_attribution: isFounderDirect,
      lagnaf_entry_path:                 data.business_type || '',
      lagnaf_hs_lifecycle_stage:         'lead',
      lagnaf_status:                     'Pending NDA',
    };

    this.set('attribution', attribution);
    this.hubspotIdentify({ ...data, ...attribution }, 'New Entry – Pending NDA');
    window.location.href = 'nda-gate.html';
  },

  // Step 2: NDA complete — update contact with UIN + attribution confirmed
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
      lagnaf_uin:          this.get('uin'),
      lagnaf_system_path:  path,
      lagnaf_status:       'Path Selected – ' + path,
    }, 'Path Selected – ' + path);

    const map = {
      'new-operator':      'new-operator.html',
      'existing-operator': 'existing-operator.html',
      'ambassador':        'ambassador-onboarding.html'
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

  // Ambassador submit
  submitAmbassador(data) {
    this.set('ambassador_data', data);
    this.set('status', 'ambassador_candidate');

    this.hubspotIdentify({
      lagnaf_uin:                  this.get('uin'),
      lagnaf_ambassador_candidate: true,
      lagnaf_network_size:         data.network_size,
      lagnaf_industry_connections: data.industry_connections,
      lagnaf_referral_capability:  data.referral_capability,
      lagnaf_status:               'Ambassador Candidate',
    }, 'Ambassador Candidate');
  },

  // ── HubSpot Integration ──────────────────────────────────────────────────
  // Uses HubSpot tracking code (_hsq) for identify + event calls.
  // Properties must match the internal names in your HubSpot portal exactly.
  //
  // To activate:
  //   1. Add HubSpot tracking code to each page (replace PORTAL_ID below)
  //   2. Confirm property internal names in HubSpot → Settings → Properties
  //   3. Set the four attribution properties in the contact record layout
  //      (Settings → Objects → Contacts → Record Customization → add to top card)
  //
  // PORTAL_ID: replace 'YOUR_PORTAL_ID' in the tracking snippet with your ID
  hubspotIdentify(properties, eventLabel) {
    if (typeof window._hsq === 'undefined') {
      console.log('[HubSpot – not loaded]', eventLabel, properties);
      return;
    }

    const entry = this.get('entry');

    // Identify by email so all property updates merge onto the same contact record
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

    // Track the funnel step as a named event
    window._hsq.push(['trackEvent', { id: 'lagnaf_funnel_' + eventLabel.toLowerCase().replace(/[^a-z0-9]+/g, '_') }]);

    // Force a page view flush so the identify call fires immediately
    window._hsq.push(['trackPageView']);

    console.log('[HubSpot]', eventLabel, properties);
  }
};
