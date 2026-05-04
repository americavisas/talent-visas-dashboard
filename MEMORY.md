# Talent Visas — Persistent Project Memory

This file is auto-loaded into the agent's system prompt at the start of every chat.
The agent can update it via the `rememberThis` (append a note) or `updateMemory` (full rewrite) tools.

**Last updated:** 2026-05-04

---

## Business

- **Focus visas:** O-1A (founders, scientists, athletes) and O-1B (artists, performers).
- Other visas the firm handles but are NOT the current marketing priority: EB-1, EB-2 NIW, H-1B, L-1, EB-5, TN.
- Domain: **talent-visas.com**
- Calendly booking: **https://calendly.com/talentvisas/consultation**
- Owner / sole operator: Joni (info@america-visas.com)

## Tech

- **Website repo:** `americavisas/lighthouse-talent-hub` — **Vite + React + React Router** (NOT Next.js).
  - Pages live in `src/pages/*.tsx`, routes in `src/App.tsx`.
  - Auto-deploys to Vercel on push to `main` (project `prj_iZ6rdBVdjhZPjpRmEhHtbKS07Qu5`).
  - Existing pages: O-1B at `src/pages/O1BVisaPage.tsx`, O-1A at `src/pages/O1AVisaPage.tsx`.
- **Dashboard repo:** `americavisas/talent-visas-dashboard` (this project, Next.js 16 on Vercel, project `prj_fPKjaCMNSHuoWZbqAcfsps5dbpQZ`).
- **GTM container:** `GTM-MXTFHC33`
- **GA4 measurement ID:** `G-MNWWSXMR0B`
- **GA4 numeric Property ID:** `530259629` (used by the Data API tools below)
- **GA4 service account:** `talent-visas-dashboard@talent-portal-493417.iam.gserviceaccount.com` (Viewer access on the property; credentials in Vercel env `GOOGLE_APPLICATION_CREDENTIALS_JSON` + `GA4_PROPERTY_ID`)
- **GA4 tools available to the agent:** `ga4Summary`, `ga4TopPages`, `ga4TopSources`, `ga4ConversionsByEvent`, `ga4Report` (custom). Use these when the user asks about traffic, conversions, page performance, or where leads come from.

## Conversion tracking (LIVE as of 2026-05-04)

`src/lib/gtag.ts` in lighthouse-talent-hub fires three events. They are wired into `EligibilityQuiz.tsx` and `SEOPageLayout.tsx`:

| Event | Fired when | Params |
|---|---|---|
| `quiz_started` | User clicks Find Profile in EligibilityQuiz (top-of-funnel) | — |
| `generate_lead` (GA4) / `lead_captured` (GTM dataLayer) | User submits email at quiz gate — **PRIMARY conversion** | `visa_type`, `tier` |
| `consultation_click` | User clicks Schedule a call / Book Free Consultation — **HIGHEST INTENT** | `visa_type`, `tier` |

The `gtagConversion()` lines for direct Google Ads conversion firing are commented out in gtag.ts pending real Ads conversion IDs.

## Marketing

- **Initial Google Ads budget:** $2,000 / month
- **Top competitors observed:** Murthy Law (murthy.com), Avvo, Fragomen
- **Google Ads Developer Token:** NOT YET APPLIED — must be applied for at https://developers.google.com/google-ads/api/docs/get-started/dev-token before the agent can read or write to Google Ads (1–3 day approval).

## Open / pending action items

- [ ] Apply for Google Ads Developer Token
- [ ] In GA4: mark `generate_lead` and `consultation_click` as key events / conversions
- [ ] In GA4: register `visa_type` and `tier` as custom dimensions
- [ ] Link GA4 to Google Ads, import conversions
- [ ] Build out site extensions (sitelinks for /o1a-visa and /o1b-visa) — needs Ads token first
- [ ] Wire a real web search API (Brave / Tavily) so `webSearch` returns real results
- [ ] Add Search Console (same service account email needs Restricted user access in Search Console settings)

## Conventions the agent should follow

- Prefer `editFile` over `writeFile` for small changes.
- Always poll `vercelLatestDeploy('lighthouse-talent-hub', waitForReady: true)` after a commit, then verify with `webFetch`.
- Output a one-line `✅ ...` ack after every mutating tool call.
- For multi-step plans, post the plan first, then execute sequentially with acks between, then a Done/Skipped tally at the end.
- If you learn a stable new fact about the project the user might ask again later (a new ID, a new repo, a new convention), call `rememberThis` to persist it here.
