// ── LAGNAF™ HubSpot Proxy — Vercel Serverless Function ──────────────────────
// Keeps the HubSpot Private App token server-side.
// All pages call POST /api/hs with { email, properties } — this upserts the
// contact in HubSpot using the Contacts API v3 batch upsert (idProperty: email).
//
// Self-healing: if a lagnaf_* custom property doesn't exist yet, this function
// auto-creates it as a plain text field and retries the upsert automatically.
//
// Environment variable required (set in Vercel dashboard):
//   HUBSPOT_TOKEN  — your Private App access token
// ─────────────────────────────────────────────────────────────────────────────

const HS_BASE = 'https://api.hubapi.com';

// Human-readable labels for each custom property
const PROP_LABELS = {
  lagnaf_status:                    'LAGNAF Status',
  lagnaf_uin:                       'LAGNAF UIN',
  lagnaf_ambassador_code:           'LAGNAF Ambassador Code',
  lagnaf_referral_source:           'LAGNAF Referral Source',
  lagnaf_ambassador_referral_code:  'LAGNAF Ambassador Referral Code',
  lagnaf_referring_ambassador:      'LAGNAF Referring Ambassador',
  lagnaf_attribution_source:        'LAGNAF Attribution Source',
  lagnaf_direct_founder_attribution:'LAGNAF Direct Founder Attribution',
  lagnaf_entry_path:                'LAGNAF Entry Path',
  lagnaf_system_path:               'LAGNAF System Path',
  lagnaf_build_selected:            'LAGNAF Build Selected',
  lagnaf_build_price:               'LAGNAF Build Price',
  lagnaf_ambassador_candidate:      'LAGNAF Ambassador Candidate',
  lagnaf_network_size:              'LAGNAF Network Size',
  lagnaf_industry_connections:      'LAGNAF Industry Connections',
  lagnaf_referral_capability:       'LAGNAF Referral Capability',
  lagnaf_amb_module_complete:       'LAGNAF Ambassador Module Complete',
};

// Create a single missing custom property in HubSpot
async function createProperty(name, token) {
  const label = PROP_LABELS[name] || name;
  const r = await fetch(`${HS_BASE}/crm/v3/properties/contacts`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name,
      label,
      type:       'string',
      fieldType:  'text',
      groupName:  'contactinformation',
    }),
  });
  const d = await r.json();
  if (!r.ok && d.category !== 'CONFLICT') {
    // CONFLICT means it already exists — that's fine
    console.error('[LAGNAF HubSpot] failed to create property', name, d.message);
  } else {
    console.log('[LAGNAF HubSpot] created property', name);
  }
}

// Run the batch upsert
async function upsertContact(email, properties, token) {
  return fetch(`${HS_BASE}/crm/v3/objects/contacts/batch/upsert`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      inputs: [{
        idProperty: 'email',
        id: email,
        properties,
      }],
    }),
  });
}

export default async function handler(req, res) {
  // CORS — allow same-origin + local dev
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.HUBSPOT_TOKEN;
  if (!token) {
    console.warn('[LAGNAF HubSpot] HUBSPOT_TOKEN not set — skipping upsert');
    return res.status(200).json({ skipped: true, reason: 'token_not_configured' });
  }

  const body = req.body || {};
  const email = (body.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'email is required' });

  // Merge email + strip empty values
  const properties = { email, ...body.properties };
  const cleaned = Object.fromEntries(
    Object.entries(properties).filter(([, v]) => v !== undefined && v !== null && v !== '')
  );

  try {
    // ── First attempt ────────────────────────────────────────────────────────
    let hsRes  = await upsertContact(email, cleaned, token);
    let data   = await hsRes.json();

    // ── Auto-create missing properties then retry once ───────────────────────
    if (!hsRes.ok && data.message && data.message.includes('PROPERTY_DOESNT_EXIST')) {
      // HubSpot embeds errors as a JSON array inside the message string.
      // Try data.errors first, then parse from the message string as fallback.
      let missing = (data.errors || [])
        .filter(e => e.error === 'PROPERTY_DOESNT_EXIST')
        .map(e => e.name)
        .filter(Boolean);

      if (!missing.length) {
        try {
          const start = data.message.indexOf('[');
          const end   = data.message.lastIndexOf(']') + 1;
          if (start !== -1 && end > start) {
            const arr = JSON.parse(data.message.slice(start, end));
            missing = arr
              .filter(e => e.error === 'PROPERTY_DOESNT_EXIST')
              .map(e => e.name)
              .filter(Boolean);
          }
        } catch (pe) {
          console.error('[LAGNAF HubSpot] could not parse missing props from message', pe.message);
        }
      }

      if (missing.length) {
        console.log('[LAGNAF HubSpot] missing properties — creating:', missing.join(', '));
        await Promise.all(missing.map(p => createProperty(p, token)));

        // Retry
        hsRes = await upsertContact(email, cleaned, token);
        data  = await hsRes.json();
      }
    }

    if (!hsRes.ok) {
      console.error('[LAGNAF HubSpot] upsert error', hsRes.status, JSON.stringify(data));
      return res.status(200).json({ hubspot_error: data.message || 'unknown', status: hsRes.status });
    }

    const contactId = data.results?.[0]?.id || null;
    console.log('[LAGNAF HubSpot] upserted', email, '→ contact', contactId);
    return res.status(200).json({ ok: true, contactId });

  } catch (err) {
    console.error('[LAGNAF HubSpot] fetch error', err.message);
    return res.status(200).json({ error: err.message });
  }
}
