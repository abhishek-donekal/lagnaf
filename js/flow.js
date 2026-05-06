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
  submitEntry(data) {
    this.set('entry', data);
    this.set('status', 'pending_nda');
    this.hubspot(data, 'New Entry – Pending NDA');
    window.location.href = 'nda-gate.html';
  },

  // Step 2: NDA complete
  completeNDA() {
    const uin = this.generateUIN();
    this.set('nda_complete', true);
    this.set('uin', uin);
    this.set('status', 'nda_completed');
    this.hubspot({ uin }, 'NDA Completed');
    window.location.href = 'uin-issued.html';
  },

  // Step 3: Path select
  selectPath(path) {
    this.set('path', path);
    this.set('status', 'path_' + path);
    const map = { 'new-operator': 'new-operator.html', 'existing-operator': 'existing-operator.html', 'ambassador': 'ambassador-onboarding.html' };
    window.location.href = map[path];
  },

  // Step 4: Build select
  selectBuild(build, price) {
    this.set('build', { name: build, price });
    this.set('status', 'build_selected');
    this.hubspot({ build, price }, 'Build Selected – ' + build);
    window.location.href = 'operator-dashboard.html';
  },

  // HubSpot stub — replace with actual portal/form IDs
  hubspot(data, tag) {
    if (typeof window._hsq !== 'undefined') {
      window._hsq.push(['identify', data]);
      window._hsq.push(['trackEvent', { id: tag }]);
    }
    console.log('[HubSpot]', tag, data);
  }
};
