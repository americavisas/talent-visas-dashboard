/* eslint-disable @typescript-eslint/no-explicit-any */
import { getGA4Summary } from '../_lib/ga4';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const summary = await getGA4Summary();
    return Response.json({
      ok: true,
      ga4: summary,
      // Placeholders for future API integrations
      googleAds: { available: false, reason: 'Google Ads Developer Token not yet approved' },
      searchConsole: { available: false, reason: 'Search Console API not yet wired' },
    });
  } catch (e: any) {
    return Response.json(
      { ok: false, error: e?.message || 'Stats fetch failed' },
      { status: 500 }
    );
  }
}
