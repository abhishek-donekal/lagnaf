// ── LAGNAF™ Sequential Code Counter — Vercel Serverless Function ─────────────
// Issues role-based sequential identity codes:
//   LagBA-0001  (Brand Ambassador)
//   LagBO-0002  (Business Owner / Operator)
//   LagTECH-0003 (Technician)
//
// Uses Vercel KV (Upstash Redis) via REST API for atomic INCR.
//
// Environment variables (auto-added when you connect a KV database in Vercel):
//   KV_REST_API_URL    — https://xxxx.kv.vercel-storage.com
//   KV_REST_API_TOKEN  — your KV REST token
//
// If KV is not yet configured the endpoint returns a timestamp-derived fallback
// so the funnel never breaks.
// ─────────────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const role = (req.query.role || '').toLowerCase();
  const prefixMap = { ba: 'LagBA', bo: 'LagBO', tech: 'LagTECH' };

  if (!prefixMap[role]) {
    return res.status(400).json({ error: 'invalid_role', valid: Object.keys(prefixMap) });
  }

  const prefix = prefixMap[role];
  // Support both Vercel KV naming and Upstash direct naming
  const kvUrl   = process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL;
  const kvToken = process.env.KV_REST_API_TOKEN  || process.env.UPSTASH_REDIS_REST_TOKEN;

  // ── KV not yet configured — return timestamp-derived fallback ──────────────
  if (!kvUrl || !kvToken) {
    console.warn('[LAGNAF Counter] KV not configured — returning fallback code');
    const n = (Math.floor(Date.now() / 1000) % 8999) + 1001;
    return res.status(200).json({
      code:     `${prefix}-${String(n).padStart(4, '0')}`,
      fallback: true,
      reason:   'kv_not_configured',
    });
  }

  // ── Atomic increment via Vercel KV REST API (Upstash Redis INCR) ───────────
  try {
    const key = `lagnaf_counter_${role}`;
    const r = await fetch(`${kvUrl}/incr/${key}`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${kvToken}` },
    });

    if (!r.ok) {
      const errText = await r.text();
      console.error('[LAGNAF Counter] KV error', r.status, errText);
      throw new Error(`KV HTTP ${r.status}`);
    }

    const d = await r.json();
    const next = d.result;

    if (typeof next !== 'number') throw new Error('unexpected KV response: ' + JSON.stringify(d));

    const code = `${prefix}-${String(next).padStart(4, '0')}`;
    console.log(`[LAGNAF Counter] issued ${code}`);

    return res.status(200).json({ code, sequential: true });

  } catch (err) {
    console.error('[LAGNAF Counter] fetch error', err.message);
    // Fallback — unique but not sequential
    const n = (Math.floor(Date.now() / 1000) % 8999) + 1001;
    return res.status(200).json({
      code:     `${prefix}-${String(n).padStart(4, '0')}`,
      fallback: true,
      error:    err.message,
    });
  }
}
