/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * GA4 Data API client — uses the REST endpoint directly (not the SDK / gRPC)
 * because the SDK fails opaquely in some serverless environments. This is
 * lighter, has no native dependencies, and produces clean error messages.
 */

import crypto from 'crypto';

interface ServiceAccountJson {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

function loadCredentials(): ServiceAccountJson {
  const json = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!json) throw new Error('GOOGLE_APPLICATION_CREDENTIALS_JSON env var is not set');
  let parsed: ServiceAccountJson;
  try {
    parsed = JSON.parse(json);
  } catch (e: any) {
    throw new Error(`GOOGLE_APPLICATION_CREDENTIALS_JSON is not valid JSON: ${e?.message}`);
  }
  if (!parsed.client_email) throw new Error('Service account JSON is missing client_email');
  if (!parsed.private_key) throw new Error('Service account JSON is missing private_key');
  return parsed;
}

function getPropertyId(): string {
  const id = process.env.GA4_PROPERTY_ID;
  if (!id) throw new Error('GA4_PROPERTY_ID env var is not set');
  return id;
}

function base64UrlEncode(buf: Buffer | string): string {
  const b = typeof buf === 'string' ? Buffer.from(buf) : buf;
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Build a JWT signed with the service account's private key, exchange it for
 * an OAuth2 access token at Google's token endpoint, cache the token until
 * 5 minutes before expiry.
 */
async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) return cachedToken.token;

  const creds = loadCredentials();
  const tokenUri = creds.token_uri || 'https://oauth2.googleapis.com/token';

  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const iat = Math.floor(now / 1000);
  const exp = iat + 3600;
  const claim = base64UrlEncode(
    JSON.stringify({
      iss: creds.client_email,
      scope: 'https://www.googleapis.com/auth/analytics.readonly',
      aud: tokenUri,
      iat,
      exp,
    })
  );

  const signingInput = `${header}.${claim}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  const signature = base64UrlEncode(signer.sign(creds.private_key));
  const jwt = `${signingInput}.${signature}`;

  const tokenRes = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    throw new Error(`Token exchange failed (${tokenRes.status}): ${text.slice(0, 300)}`);
  }
  const tokenData = (await tokenRes.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: tokenData.access_token,
    expiresAt: now + tokenData.expires_in * 1000,
  };
  return tokenData.access_token;
}

async function callGA4(method: string, body: any): Promise<any> {
  const propertyId = getPropertyId();
  const token = await getAccessToken();
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:${method}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch {}
  if (!res.ok) {
    const msg = data?.error?.message || text || `GA4 ${res.status}`;
    const err: any = new Error(msg);
    err.code = data?.error?.code ?? res.status;
    err.status = data?.error?.status;
    throw err;
  }
  return data;
}

// ── Public surface ────────────────────────────────────────────

export interface GA4ReportInput {
  metrics: string[];
  dimensions?: string[];
  startDate?: string;
  endDate?: string;
  limit?: number;
}

export async function runGA4Report(input: GA4ReportInput) {
  const propertyId = getPropertyId();
  const data = await callGA4('runReport', {
    metrics: input.metrics.map((name) => ({ name })),
    dimensions: (input.dimensions || []).map((name) => ({ name })),
    dateRanges: [{ startDate: input.startDate || '30daysAgo', endDate: input.endDate || 'today' }],
    limit: input.limit || 50,
  });

  const rows = (data.rows || []).map((row: any) => {
    const r: Record<string, any> = {};
    (input.dimensions || []).forEach((name, i) => { r[name] = row.dimensionValues?.[i]?.value ?? ''; });
    input.metrics.forEach((name, i) => { r[name] = Number(row.metricValues?.[i]?.value || 0); });
    return r;
  });

  const totals: Record<string, number> = {};
  input.metrics.forEach((name, i) => {
    totals[name] = Number(data.totals?.[0]?.metricValues?.[i]?.value || 0);
  });

  return {
    propertyId,
    dateRange: { startDate: input.startDate || '30daysAgo', endDate: input.endDate || 'today' },
    rowCount: rows.length,
    rows,
    totals,
  };
}

/** Last 30 days vs prior 30 days, with sessions/users/conversions/engagement deltas. */
export async function getGA4Summary() {
  const propertyId = getPropertyId();
  const data = await callGA4('runReport', {
    metrics: [
      { name: 'sessions' },
      { name: 'totalUsers' },
      { name: 'conversions' },
      { name: 'engagementRate' },
    ],
    dateRanges: [
      { startDate: '30daysAgo', endDate: 'today', name: 'current' },
      { startDate: '60daysAgo', endDate: '31daysAgo', name: 'previous' },
    ],
  });

  const get = (rangeIdx: number, metricIdx: number) =>
    Number(data.totals?.[rangeIdx]?.metricValues?.[metricIdx]?.value || 0);

  const sessions = get(0, 0);
  const users = get(0, 1);
  const conversions = get(0, 2);
  const engagementRate = get(0, 3);
  const prevSessions = get(1, 0);
  const prevUsers = get(1, 1);
  const prevConversions = get(1, 2);

  const pct = (now: number, prev: number) => {
    if (prev === 0) return now === 0 ? 0 : 100;
    return Math.round(((now - prev) / prev) * 100);
  };

  return {
    propertyId,
    range: 'last_30_days',
    current: {
      sessions,
      users,
      conversions,
      engagementRate: Math.round(engagementRate * 100),
    },
    delta: {
      sessions: pct(sessions, prevSessions),
      users: pct(users, prevUsers),
      conversions: pct(conversions, prevConversions),
    },
  };
}

export async function getTopPages(limit = 10) {
  return runGA4Report({
    metrics: ['sessions', 'conversions'],
    dimensions: ['pagePath'],
    startDate: '30daysAgo',
    endDate: 'today',
    limit,
  });
}

export async function getTopSources(limit = 10) {
  return runGA4Report({
    metrics: ['sessions', 'conversions'],
    dimensions: ['sessionSourceMedium'],
    startDate: '30daysAgo',
    endDate: 'today',
    limit,
  });
}

export async function getConversionsByEvent(limit = 20) {
  return runGA4Report({
    metrics: ['eventCount'],
    dimensions: ['eventName'],
    startDate: '30daysAgo',
    endDate: 'today',
    limit,
  });
}
