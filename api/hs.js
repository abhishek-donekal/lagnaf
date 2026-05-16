// ── LAGNAF™ HubSpot Proxy — Vercel Serverless Function ──────────────────────
// Keeps the HubSpot Private App token server-side.
// All pages call POST /api/hs with { email, properties } — this upserts the
// contact in HubSpot using the Contacts API v3 batch upsert (idProperty: email).
//
// Environment variable required (set in Vercel dashboard):
//   HUBSPOT_TOKEN  — your Private App access token
// ─────────────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  // CORS — allow same-origin + local dev
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.HUBSPOT_TOKEN;
  if (!token) {
    // Token not yet configured — log and return success so the funnel keeps moving
    console.warn('[LAGNAF HubSpot] HUBSPOT_TOKEN not set — skipping upsert');
    return res.status(200).json({ skipped: true, reason: 'token_not_configured' });
  }

  const body = req.body || {};
  const email = (body.email || '').trim().toLowerCase();

  if (!email) {
    return res.status(400).json({ error: 'email is required' });
  }

  // Merge email into properties so it's always present in the upsert payload
  const properties = { email, ...body.properties };

  // Strip undefined / null / empty strings so HubSpot doesn't complain
  const cleaned = Object.fromEntries(
    Object.entries(properties).filter(([, v]) => v !== undefined && v !== null && v !== '')
  );

  try {
    const hsRes = await fetch(
      'https://api.hubapi.com/crm/v3/objects/contacts/batch/upsert',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          inputs: [{
            idProperty: 'email',
            id: email,
            properties: cleaned,
          }],
        }),
      }
    );

    const data = await hsRes.json();

    if (!hsRes.ok) {
      console.error('[LAGNAF HubSpot] upsert error', hsRes.status, JSON.stringify(data));
      // Return 200 so the funnel keeps moving even on HS errors
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
