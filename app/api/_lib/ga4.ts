/* eslint-disable @typescript-eslint/no-explicit-any */
import { BetaAnalyticsDataClient } from '@google-analytics/data';

let cachedClient: BetaAnalyticsDataClient | null = null;

function getClient(): BetaAnalyticsDataClient {
  if (cachedClient) return cachedClient;
  const json = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!json) throw new Error('GOOGLE_APPLICATION_CREDENTIALS_JSON env var is not set');
  const credentials = JSON.parse(json);
  cachedClient = new BetaAnalyticsDataClient({ credentials });
  return cachedClient;
}

function getPropertyId(): string {
  const id = process.env.GA4_PROPERTY_ID;
  if (!id) throw new Error('GA4_PROPERTY_ID env var is not set');
  return id;
}

export interface GA4ReportInput {
  metrics: string[];
  dimensions?: string[];
  startDate?: string; // 'YYYY-MM-DD' or '7daysAgo' / '30daysAgo' / 'today' / 'yesterday'
  endDate?: string;
  limit?: number;
  dimensionFilter?: any;
}

export async function runGA4Report(input: GA4ReportInput) {
  const client = getClient();
  const propertyId = getPropertyId();
  const [response] = await client.runReport({
    property: `properties/${propertyId}`,
    metrics: input.metrics.map((name) => ({ name })),
    dimensions: (input.dimensions || []).map((name) => ({ name })),
    dateRanges: [
      {
        startDate: input.startDate || '30daysAgo',
        endDate: input.endDate || 'today',
      },
    ],
    limit: input.limit ? Number(input.limit) : 50,
    ...(input.dimensionFilter ? { dimensionFilter: input.dimensionFilter } : {}),
  });

  // Format response into a tidy shape
  const rows = (response.rows || []).map((row) => {
    const dims: Record<string, string> = {};
    (input.dimensions || []).forEach((name, i) => {
      dims[name] = row.dimensionValues?.[i]?.value ?? '';
    });
    const mets: Record<string, number> = {};
    input.metrics.forEach((name, i) => {
      const raw = row.metricValues?.[i]?.value;
      mets[name] = raw ? Number(raw) : 0;
    });
    return { ...dims, ...mets };
  });

  const totals: Record<string, number> = {};
  input.metrics.forEach((name, i) => {
    const raw = response.totals?.[0]?.metricValues?.[i]?.value;
    totals[name] = raw ? Number(raw) : 0;
  });

  return {
    propertyId,
    dateRange: {
      startDate: input.startDate || '30daysAgo',
      endDate: input.endDate || 'today',
    },
    rowCount: rows.length,
    rows,
    totals,
  };
}

/**
 * Get a high-level summary for the sidebar: last 30 days vs prior 30 days.
 * Returns sessions, totalUsers, conversions, plus deltas vs the previous period.
 */
export async function getGA4Summary() {
  const client = getClient();
  const propertyId = getPropertyId();
  const [current] = await client.runReport({
    property: `properties/${propertyId}`,
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

  const get = (rangeIdx: number, metricIdx: number) => {
    const row = current.rows?.find((r) => r.dimensionValues?.[0]?.value === undefined && rangeIdx === 0)
      || current.rows?.[rangeIdx];
    // Multi-range reports return per-range totals
    const t = current.totals?.[rangeIdx];
    const v = t?.metricValues?.[metricIdx]?.value;
    return v ? Number(v) : 0;
  };

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

/** Top N pages by sessions, last 30 days. */
export async function getTopPages(limit = 10) {
  const result = await runGA4Report({
    metrics: ['sessions', 'conversions'],
    dimensions: ['pagePath'],
    startDate: '30daysAgo',
    endDate: 'today',
    limit,
  });
  // Sort already done by GA4 (descending by first metric); ensure
  result.rows.sort((a: any, b: any) => (b.sessions ?? 0) - (a.sessions ?? 0));
  return result;
}

/** Top traffic sources, last 30 days. */
export async function getTopSources(limit = 10) {
  return runGA4Report({
    metrics: ['sessions', 'conversions'],
    dimensions: ['sessionSourceMedium'],
    startDate: '30daysAgo',
    endDate: 'today',
    limit,
  });
}

/** Conversion events by name, last 30 days. */
export async function getConversionsByEvent(limit = 20) {
  return runGA4Report({
    metrics: ['eventCount'],
    dimensions: ['eventName'],
    startDate: '30daysAgo',
    endDate: 'today',
    limit,
  });
}
