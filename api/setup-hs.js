// ── LAGNAF™ HubSpot One-Time Property Setup ──────────────────────────────────
// Hit GET /api/setup-hs once to create all 17 custom lagnaf_* properties.
// Safe to call multiple times — CONFLICT errors (already exists) are ignored.
// DELETE this file after properties are confirmed created in HubSpot.
// ─────────────────────────────────────────────────────────────────────────────

const PROPERTIES = [
  { name: 'lagnaf_status',                    label: 'LAGNAF Status' },
  { name: 'lagnaf_uin',                       label: 'LAGNAF UIN' },
  { name: 'lagnaf_ambassador_code',           label: 'LAGNAF Ambassador Code' },
  { name: 'lagnaf_referral_source',           label: 'LAGNAF Referral Source' },
  { name: 'lagnaf_ambassador_referral_code',  label: 'LAGNAF Ambassador Referral Code' },
  { name: 'lagnaf_referring_ambassador',      label: 'LAGNAF Referring Ambassador' },
  { name: 'lagnaf_attribution_source',        label: 'LAGNAF Attribution Source' },
  { name: 'lagnaf_direct_founder_attribution',label: 'LAGNAF Direct Founder Attribution' },
  { name: 'lagnaf_entry_path',                label: 'LAGNAF Entry Path' },
  { name: 'lagnaf_system_path',               label: 'LAGNAF System Path' },
  { name: 'lagnaf_build_selected',            label: 'LAGNAF Build Selected' },
  { name: 'lagnaf_build_price',               label: 'LAGNAF Build Price' },
  { name: 'lagnaf_ambassador_candidate',      label: 'LAGNAF Ambassador Candidate' },
  { name: 'lagnaf_network_size',              label: 'LAGNAF Network Size' },
  { name: 'lagnaf_industry_connections',      label: 'LAGNAF Industry Connections' },
  { name: 'lagnaf_referral_capability',       label: 'LAGNAF Referral Capability' },
  { name: 'lagnaf_amb_module_complete',       label: 'LAGNAF Ambassador Module Complete' },
];

export default async function handler(req, res) {
  const token = process.env.HUBSPOT_TOKEN;
  if (!token) return res.status(500).json({ error: 'HUBSPOT_TOKEN not set' });

  const results = [];

  for (const prop of PROPERTIES) {
    try {
      const r = await fetch('https://api.hubapi.com/crm/v3/properties/contacts', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name:      prop.name,
          label:     prop.label,
          type:      'string',
          fieldType: 'text',
          groupName: 'contactinformation',
        }),
      });
      const d = await r.json();

      if (r.ok) {
        results.push({ name: prop.name, status: 'created' });
      } else if (d.category === 'CONFLICT' || (d.message || '').includes('already exists')) {
        results.push({ name: prop.name, status: 'already_exists' });
      } else {
        results.push({ name: prop.name, status: 'error', message: d.message, category: d.category });
      }
    } catch (e) {
      results.push({ name: prop.name, status: 'exception', message: e.message });
    }
  }

  const errors  = results.filter(r => r.status === 'error' || r.status === 'exception');
  const created = results.filter(r => r.status === 'created');
  const existed = results.filter(r => r.status === 'already_exists');

  return res.status(200).json({
    summary: { created: created.length, already_existed: existed.length, errors: errors.length },
    results,
  });
}
