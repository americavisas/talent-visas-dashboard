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
    // Build a useful error string from whatever shape we got.
    // gRPC GoogleError has .code (number) + .details (string).
    // Other errors have .message; otherwise fall through to Object.prototype check.
    console.error('[/api/stats] failed:', e);
    let error = 'Unknown error';
    if (typeof e === 'string') error = e;
    else if (typeof e?.details === 'string' && e.details && e.details !== 'undefined undefined: undefined') error = e.details;
    else if (typeof e?.message === 'string' && e.message && e.message !== 'undefined undefined: undefined') error = e.message;
    else if (e?.errors?.[0]?.message) error = e.errors[0].message;
    else if (e?.cause?.message) error = e.cause.message;
    else if (e?.name) error = `${e.name}${e.code ? ` (code ${e.code})` : ''}`;
    else {
      // Last resort: serialize own enumerable props
      try { error = JSON.stringify(e, Object.getOwnPropertyNames(e)).slice(0, 400); } catch {}
    }

    const hint = (e?.code === 7 || /permission/i.test(error))
      ? 'The service account does not have Viewer access on the GA4 property. Add talent-visas-dashboard@talent-portal-493417.iam.gserviceaccount.com in GA4 Admin → Property access management.'
      : (/credentials|json|parse/i.test(error))
        ? 'GOOGLE_APPLICATION_CREDENTIALS_JSON env var is missing or malformed.'
        : undefined;

    return Response.json(
      {
        ok: false,
        error,
        hint,
        // Debug breadcrumb: which fields existed on the original error
        debug: { code: e?.code, name: e?.name, hasDetails: typeof e?.details === 'string', hasMessage: typeof e?.message === 'string' },
      },
      { status: 500 }
    );
  }
}
