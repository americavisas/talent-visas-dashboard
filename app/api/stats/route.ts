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
    // GoogleError objects from gRPC have message + details + code; format them nicely
    const error = e?.details || e?.message || (typeof e === 'string' ? e : JSON.stringify(e)) || 'Stats fetch failed';
    const hint = (e?.code === 7 || /permission/i.test(error))
      ? 'The service account does not have Viewer access on the GA4 property. Add talent-visas-dashboard@talent-portal-493417.iam.gserviceaccount.com in GA4 Admin → Property access management.'
      : undefined;
    return Response.json({ ok: false, error, hint }, { status: 500 });
  }
}
