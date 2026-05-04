// @ts-nocheck
/* eslint-disable @typescript-eslint/no-explicit-any */
import { anthropic } from '@ai-sdk/anthropic';
import { streamText, tool, convertToModelMessages, stepCountIs } from 'ai';
import { z } from 'zod';
import {
  runGA4Report,
  getGA4Summary,
  getTopPages,
  getTopSources,
  getConversionsByEvent,
} from '../_lib/ga4';

// Explicit Vercel function config — Fluid Compute, 300s max, Node runtime.
// The 'network error' the user saw was the function timing out at the
// previous default while the agent was still streaming.
export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

// ── Persistent project memory ────────────────────────────────
// Reads MEMORY.md from americavisas/talent-visas-dashboard at request time,
// cached in module memory for 30s, injected into the system prompt so the
// agent remembers stable facts (visa focus, GTM IDs, repo paths, open items)
// across sessions without you having to repeat them.
const DASHBOARD_REPO = 'americavisas/talent-visas-dashboard';
const MEMORY_PATH = 'MEMORY.md';
let memoryCache: { content: string; sha: string; expiresAt: number } | null = null;

async function loadMemory(): Promise<{ content: string; sha: string }> {
  const now = Date.now();
  if (memoryCache && memoryCache.expiresAt > now) {
    return { content: memoryCache.content, sha: memoryCache.sha };
  }
  try {
    const token = process.env.GITHUB_TOKEN;
    if (!token) return { content: '(no GITHUB_TOKEN — memory not available)', sha: '' };
    const r = await fetch(`https://api.github.com/repos/${DASHBOARD_REPO}/contents/${MEMORY_PATH}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!r.ok) return { content: `(memory load failed: ${r.status})`, sha: '' };
    const d: any = await r.json();
    const content = Buffer.from(d.content, 'base64').toString('utf8');
    memoryCache = { content, sha: d.sha, expiresAt: now + 30_000 };
    return { content, sha: d.sha };
  } catch (e: any) {
    return { content: `(memory load error: ${e?.message})`, sha: '' };
  }
}

function invalidateMemoryCache() {
  memoryCache = null;
}

const DEFAULT_REPO = 'americavisas/lighthouse-talent-hub';
const DEFAULT_BRANCH = 'main';

// Friendly project name → Vercel project ID
const VERCEL_PROJECTS: Record<string, string> = {
  'lighthouse-talent-hub': 'prj_iZ6rdBVdjhZPjpRmEhHtbKS07Qu5',
  'talent-visas-dashboard': 'prj_fPKjaCMNSHuoWZbqAcfsps5dbpQZ',
  'talent-flow': 'prj_saFtPBX2futNW1t7zoAlPnJvHOOK',
  'visa-dream-launch': 'prj_Gysa6ZDkWZAZavS2onbt8cDM81TA',
  'bridges-launchpad': 'prj_ugwCBzgsN8sdjefTPBU73HQPA13z',
  'visa-media-gateway': 'prj_kKq8jYMJVFreaoCxZpgd3jZRVVQO',
};

const SYSTEM_PROMPT = `You are the digital marketing command center for talent-visas.com — an immigration law firm specializing in US talent visas (EB-1, EB-2 NIW, O-1, H-1B, L-1, EB-5, TN and more).

You manage:
- Website code & landing pages (GitHub: ${DEFAULT_REPO}, framework: Vite + React + React Router, pages live in src/pages/)
- Google Ads: strategy, keywords, ad copy
- Social media, analytics, competitor research

# YOUR JOB IS TO EXECUTE, NOT TO ASK

When the user says "fix X", "update Y", "change Z" — DO IT. Don't ask "should I?" — execute, watch it deploy, verify, then report.

# HANDLING MULTI-PART REQUESTS (this matters)

When the user gives you a list of tasks (e.g. "do A, B, C, D, E"):

1. **First message back: a short numbered plan** (one line per task) — even before any tool call. Use simple text like:
   "Plan:
    1. <task A> — will do via toolX
    2. <task B> — will do via toolY
    3. <task C> — needs API access I don't have, will explain"
2. **Then execute ONE task at a time.** Finish task 1 fully (edit + deploy + verify), report it ("✅ task 1 done — <live URL>"), THEN start task 2.
3. **NEVER say "executing all tasks simultaneously"** — context grows fast, the run will time out and the user sees nothing.
4. **If a task is blocked** (no API token, no tool exists), say so explicitly with what would unblock it. Don't pretend you did it.

# THE PER-TASK WORKFLOW

For each website change task:

  1. **INVESTIGATE** — webFetch the live URL + readFile/searchCode the source. Limit to 1–2 fetches max per task.
  2. **EDIT** — editFile (preferred) or writeFile. This commits to GitHub.
  3. **WATCH THE DEPLOY** — vercelLatestDeploy('lighthouse-talent-hub', waitForReady: true).
  4. **IF DEPLOY ERROR** — vercelBuildLogs(deploymentId), fix the cause, repeat from step 2.
  5. **VERIFY** — webFetch the live URL once more to confirm.
  6. **REPORT BRIEFLY** — 2–3 sentences max with the live URL, then either move to the next task or hand back to the user.

# INLINE ACKNOWLEDGMENT RULE (do not skip this)

After EVERY mutating tool call (writeFile, editFile, vercelTriggerDeploy), output a one-line text acknowledgment in chat BEFORE moving on:

  - Success: "✅ Created \`src/lib/gtag.ts\` (2.3 KB) — commit \`abc1234\`"
  - Edit success: "✅ Edited \`src/components/Foo.tsx\` — wired the new event"
  - Deploy ready: "✅ Deployed — talent-visas.com/o1a-visa is live with the change"
  - Failure: "❌ writeFile failed: <reason> — trying X instead" (then actually try)

This is non-negotiable. The user cannot see tool results inline in the UI; they only see your text. If you don't acknowledge, they think nothing happened.

# DON'T STOP HALF-WAY

If your plan has 2 steps (e.g. "create the utility" + "wire it into the component"), you must complete BOTH or explicitly say "step 2 not done because <reason>". Never silently skip the second step. After a multi-step plan, output a final tally:

  "Done: ✅ created gtag.ts ✅ wired 3 events into EligibilityQuiz ✅ deployed
   Skipped: ⏭️ Google Ads sitelink push (needs Developer Token)"

# CRITICAL RULES

- The repo is **Vite + React + React Router**, NOT Next.js. Pages live in \`src/pages/*.tsx\` with routes in \`src/App.tsx\`. Never write to \`app/\` paths.
- Repo defaults: repo='${DEFAULT_REPO}', branch='${DEFAULT_BRANCH}'.
- The dashboard's own project (talent-visas-dashboard) is different from the website (lighthouse-talent-hub). Don't confuse them.
- After editFile/writeFile commits, Vercel auto-deploys. ALWAYS poll vercelLatestDeploy until READY before reporting success.
- **BUDGET YOUR TOOL CALLS.** Each chat turn has a 20-step ceiling and a 5-minute timeout. Don't burn 8 steps investigating before making the first edit. Investigate just enough.
- **If a competitor URL returns 403/404, MOVE ON.** Don't retry — Cloudflare blocks scrapers, that's expected.
- Never ask permission for routine fixes. The user wants you to act.

# CAPABILITIES YOU DON'T HAVE (yet)

If the user asks for any of these, say so clearly — DO NOT pretend or fake it:
- **Google Ads campaigns / keywords / bids / sitelink extensions** — needs Google Ads Developer Token (1–3 day approval) + OAuth wired up
- **Google Ads Transparency Center scraping** — no public API, would need a headless browser backend
- **Google Analytics 4 / Search Console data** — needs OAuth wired up
- **LinkedIn / Instagram posting** — needs platform API tokens
- **Web search** — webSearch tool returns a placeholder until a search API is added

# Tools at your disposal

- **GitHub**: readFile, writeFile, editFile, listFiles, searchCode
- **Web**: webFetch (read any URL), webSearch (placeholder)
- **Vercel**: vercelLatestDeploy, vercelBuildLogs, vercelRuntimeLogs, vercelTriggerDeploy
- **Templates**: generateKeywords, generateAdCopy, recommendBudget, generateLandingPage, generateBlogPost, generateSocialPost, analyzeCompetitor

Be terse in chat. Show your work via tool calls. Final reply: 2–4 sentences max with the live URL.`;

// ── GitHub helpers ────────────────────────────────────────────
async function gh(path: string, init: RequestInit = {}) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN not configured');
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.headers || {}),
    },
  });
  return res;
}

async function getFileSha(repo: string, path: string, branch: string): Promise<string | null> {
  const r = await gh(`/repos/${repo}/contents/${path}?ref=${branch}`);
  if (r.status !== 200) return null;
  const d: any = await r.json();
  return d.sha || null;
}

// ── Vercel helpers ────────────────────────────────────────────
async function vercel(path: string, init: RequestInit = {}) {
  const token = process.env.VERCEL_API_TOKEN;
  const team = process.env.VERCEL_TEAM_ID;
  if (!token) throw new Error('VERCEL_API_TOKEN not configured');
  const sep = path.includes('?') ? '&' : '?';
  const url = `https://api.vercel.com${path}${team ? `${sep}teamId=${team}` : ''}`;
  return fetch(url, {
    ...init,
    headers: { 'Authorization': `Bearer ${token}`, ...(init.headers || {}) },
  });
}

function resolveProject(name: string): string {
  if (name && name.startsWith('prj_')) return name;
  const id = VERCEL_PROJECTS[name];
  if (!id) throw new Error(`Unknown Vercel project '${name}'. Known: ${Object.keys(VERCEL_PROJECTS).join(', ')}`);
  return id;
}

export async function POST(req: Request) {
  const { messages } = await req.json();

  // Load persistent memory and inject into the system prompt
  const memory = await loadMemory();
  const systemWithMemory = `${SYSTEM_PROMPT}

---
# PROJECT MEMORY (loaded from MEMORY.md in the dashboard repo)

${memory.content}

---
End of project memory. The user does NOT have to remind you of these facts in chat — they are always loaded.`;

  const result = streamText({
    model: anthropic('claude-sonnet-4-6'),
    system: systemWithMemory,
    messages: await convertToModelMessages(messages),
    // 12 steps × ~20s avg = ~240s, comfortably under the 300s function ceiling.
    stopWhen: stepCountIs(12),
    // Per-step output cap — prevents one runaway 8K-token essay from blowing the timeout.
    // The agent can still emit total >8K across multiple steps if needed.
    maxOutputTokens: 4096,
    tools: {
      // ── General-purpose agentic tools ──────────────────────
      readFile: tool({
        description: 'Read a file from a GitHub repo. Returns up to 6000 chars; for larger files, use offset+limit to read in chunks. Defaults to americavisas/lighthouse-talent-hub on main.',
        inputSchema: z.object({
          path: z.string().describe('Path inside the repo, e.g. "app/page.tsx"'),
          repo: z.string().optional().describe('owner/repo, default americavisas/lighthouse-talent-hub'),
          branch: z.string().optional(),
          offset: z.number().optional().describe('Start char offset (for chunked reads of large files)'),
          limit: z.number().optional().describe('Max chars to return (default 6000, hard max 12000)'),
        }),
        execute: async (params: any) => {
          const repo = params.repo || DEFAULT_REPO;
          const branch = params.branch || DEFAULT_BRANCH;
          const r = await gh(`/repos/${repo}/contents/${params.path}?ref=${branch}`);
          if (r.status === 404) return { error: `File not found: ${params.path}` };
          if (!r.ok) return { error: `GitHub ${r.status}: ${(await r.json()).message}` };
          const d: any = await r.json();
          if (Array.isArray(d)) return { error: `${params.path} is a directory — use listFiles instead` };
          const fullContent = Buffer.from(d.content, 'base64').toString('utf8');
          const offset = params.offset || 0;
          const limit = Math.min(params.limit || 6000, 12000);
          const content = fullContent.slice(offset, offset + limit);
          const truncated = fullContent.length > offset + limit;
          return {
            path: params.path,
            repo,
            branch,
            totalSize: d.size,
            totalChars: fullContent.length,
            offset,
            content,
            truncated,
            ...(truncated ? { hint: `File continues at offset=${offset + limit}` } : {}),
          };
        },
      }),

      writeFile: tool({
        description: 'Create or overwrite a file in a GitHub repo and commit it. Auto-deploys via Vercel on the lighthouse-talent-hub repo.',
        inputSchema: z.object({
          path: z.string(),
          content: z.string().describe('Full file contents'),
          message: z.string().describe('Commit message'),
          repo: z.string().optional(),
          branch: z.string().optional(),
        }),
        execute: async (params: any) => {
          const repo = params.repo || DEFAULT_REPO;
          const branch = params.branch || DEFAULT_BRANCH;
          const sha = await getFileSha(repo, params.path, branch);
          const r = await gh(`/repos/${repo}/contents/${params.path}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: params.message,
              content: Buffer.from(params.content, 'utf8').toString('base64'),
              branch,
              ...(sha ? { sha } : {}),
            }),
          });
          const d: any = await r.json();
          if (!r.ok) return { error: d.message || `GitHub ${r.status}` };
          return {
            status: sha ? '✅ Updated' : '✅ Created',
            path: params.path,
            commitUrl: d.commit?.html_url,
            note: 'Auto-deploys via Vercel in ~1 min',
          };
        },
      }),

      editFile: tool({
        description: 'Surgical edit: read a file, replace oldText with newText, commit. Use for small changes. oldText must match EXACTLY (whitespace and all).',
        inputSchema: z.object({
          path: z.string(),
          oldText: z.string().describe('Exact text to find (must be unique in file)'),
          newText: z.string().describe('Replacement text'),
          message: z.string().describe('Commit message'),
          repo: z.string().optional(),
          branch: z.string().optional(),
        }),
        execute: async (params: any) => {
          const repo = params.repo || DEFAULT_REPO;
          const branch = params.branch || DEFAULT_BRANCH;
          const r = await gh(`/repos/${repo}/contents/${params.path}?ref=${branch}`);
          if (!r.ok) return { error: `Cannot read ${params.path}: ${r.status}` };
          const d: any = await r.json();
          const content = Buffer.from(d.content, 'base64').toString('utf8');
          const occurrences = content.split(params.oldText).length - 1;
          if (occurrences === 0) return { error: 'oldText not found in file' };
          if (occurrences > 1) return { error: `oldText appears ${occurrences} times — make it more specific` };
          const newContent = content.replace(params.oldText, params.newText);
          const put = await gh(`/repos/${repo}/contents/${params.path}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: params.message,
              content: Buffer.from(newContent, 'utf8').toString('base64'),
              branch,
              sha: d.sha,
            }),
          });
          const pd: any = await put.json();
          if (!put.ok) return { error: pd.message || `Commit failed ${put.status}` };
          return { status: '✅ Edited', path: params.path, commitUrl: pd.commit?.html_url };
        },
      }),

      listFiles: tool({
        description: 'List files in a directory of a GitHub repo. Use "" for root.',
        inputSchema: z.object({
          path: z.string().default('').describe('Directory path; "" for root'),
          repo: z.string().optional(),
          branch: z.string().optional(),
        }),
        execute: async (params: any) => {
          const repo = params.repo || DEFAULT_REPO;
          const branch = params.branch || DEFAULT_BRANCH;
          const r = await gh(`/repos/${repo}/contents/${params.path || ''}?ref=${branch}`);
          if (!r.ok) return { error: `${r.status}: ${(await r.json()).message}` };
          const d: any = await r.json();
          if (!Array.isArray(d)) return { error: `${params.path} is a file — use readFile` };
          return {
            path: params.path || '/',
            entries: d.map((e: any) => ({ name: e.name, type: e.type, size: e.size })),
          };
        },
      }),

      searchCode: tool({
        description: 'Search code across a GitHub repo. Returns matching file paths + snippets.',
        inputSchema: z.object({
          query: z.string().describe('Search query, e.g. "EB-2 NIW" or "function calculateBudget"'),
          repo: z.string().optional(),
        }),
        execute: async (params: any) => {
          const repo = params.repo || DEFAULT_REPO;
          const q = encodeURIComponent(`${params.query} repo:${repo}`);
          const r = await gh(`/search/code?q=${q}&per_page=20`);
          if (!r.ok) return { error: `${r.status}: ${(await r.json()).message}` };
          const d: any = await r.json();
          return {
            totalCount: d.total_count,
            results: (d.items || []).map((it: any) => ({
              path: it.path,
              url: it.html_url,
              repository: it.repository?.full_name,
            })),
          };
        },
      }),

      webFetch: tool({
        description: 'Fetch a live web page and return its text content (HTML stripped). Returns up to 2500 chars by default — call again with offset for more. Many competitor sites block scrapers (Cloudflare 403); if you hit one, move on rather than retrying.',
        inputSchema: z.object({
          url: z.string().describe('Full URL to fetch, e.g. https://talent-visas.com/eb-2-niw'),
          offset: z.number().optional().describe('Char offset for chunked reads'),
          limit: z.number().optional().describe('Max chars (default 2500, hard max 6000)'),
        }),
        execute: async (params: any) => {
          try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 8000);
            const res = await fetch(params.url, {
              headers: { 'User-Agent': 'Mozilla/5.0 TalentVisasAgent/1.0' },
              signal: controller.signal,
            });
            clearTimeout(timeout);
            const html = await res.text();
            const fullText = html
              .replace(/<script[\s\S]*?<\/script>/gi, '')
              .replace(/<style[\s\S]*?<\/style>/gi, '')
              .replace(/<[^>]+>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim();
            const offset = params.offset || 0;
            const limit = Math.min(params.limit || 2500, 6000);
            const text = fullText.slice(offset, offset + limit);
            const truncated = fullText.length > offset + limit;
            return {
              url: params.url,
              status: res.status,
              contentType: res.headers.get('content-type'),
              totalChars: fullText.length,
              offset,
              text,
              truncated,
              ...(truncated ? { hint: `Page continues at offset=${offset + limit}` } : {}),
            };
          } catch (e: any) {
            return { error: e?.name === 'AbortError' ? 'Fetch timed out after 8s' : (e?.message || 'Fetch failed') };
          }
        },
      }),

      // ── Vercel tools ───────────────────────────────────────
      vercelLatestDeploy: tool({
        description: 'Get the latest production deployment for a Vercel project. Use after committing to check if deploy succeeded. Project is the friendly name like "lighthouse-talent-hub".',
        inputSchema: z.object({
          project: z.string().describe('Project name, e.g. "lighthouse-talent-hub"'),
          waitForReady: z.boolean().optional().describe('If true, polls every 8s until READY/ERROR (max 90s). Use after a commit.'),
        }),
        execute: async (params: any) => {
          try {
            const projectId = resolveProject(params.project);
            const fetchOne = async () => {
              const r = await vercel(`/v6/deployments?projectId=${projectId}&limit=1&target=production`);
              if (!r.ok) return { error: `Vercel ${r.status}` };
              const d: any = await r.json();
              const dep = d.deployments?.[0];
              if (!dep) return { error: 'No deployments found' };
              return {
                id: dep.uid,
                state: dep.state,
                url: dep.url ? `https://${dep.url}` : null,
                createdAt: new Date(dep.created).toISOString(),
                commitMessage: (dep.meta?.githubCommitMessage || '').split('\n')[0],
                commitSha: dep.meta?.githubCommitSha?.slice(0, 7),
              };
            };
            if (!params.waitForReady) return await fetchOne();
            // Poll mode
            for (let i = 0; i < 12; i++) {
              const r: any = await fetchOne();
              if (r.error) return r;
              if (r.state === 'READY' || r.state === 'ERROR' || r.state === 'CANCELED') return r;
              await new Promise((res) => setTimeout(res, 8000));
            }
            return { error: 'Timed out after 90s — check vercelLatestDeploy again' };
          } catch (e: any) {
            return { error: e?.message };
          }
        },
      }),

      vercelBuildLogs: tool({
        description: 'Get the build logs for a Vercel deployment. Call this when a deploy state is ERROR to find the actual cause. Returns last 50 log lines.',
        inputSchema: z.object({
          deploymentId: z.string().describe('Deployment ID like "dpl_..."'),
        }),
        execute: async (params: any) => {
          try {
            const r = await vercel(`/v3/deployments/${params.deploymentId}/events`);
            if (!r.ok) return { error: `Vercel ${r.status}` };
            const text = await r.text();
            const lines = text.trim().split('\n').slice(-50);
            const events: any[] = [];
            for (const l of lines) {
              try {
                const e = JSON.parse(l);
                if (e.text && e.text.trim()) events.push({ type: e.type, text: e.text.slice(0, 300) });
              } catch {}
            }
            const errors = events.filter((e) => e.type === 'stderr' || /error/i.test(e.text));
            return { totalEvents: events.length, errors: errors.slice(-15), recent: events.slice(-15) };
          } catch (e: any) {
            return { error: e?.message };
          }
        },
      }),

      vercelRuntimeLogs: tool({
        description: 'Get runtime logs (console.log/errors from serverless functions) for a Vercel project. Useful for debugging "site responds but feature broken" issues.',
        inputSchema: z.object({
          project: z.string(),
          since: z.string().optional().describe('Relative time like "1h" or "30m", default "1h"'),
          query: z.string().optional().describe('Optional substring filter'),
        }),
        execute: async (params: any) => {
          try {
            const projectId = resolveProject(params.project);
            // Vercel runtime log API requires the deployment ID; instead fetch the latest prod and use its ID
            const dr = await vercel(`/v6/deployments?projectId=${projectId}&limit=1&target=production`);
            const dd: any = await dr.json();
            const depId = dd.deployments?.[0]?.uid;
            if (!depId) return { error: 'No deployment to fetch logs from' };
            const since = params.since || '1h';
            const r = await vercel(`/v1/projects/${projectId}/runtime-logs?since=${since}`);
            if (!r.ok) return { error: `Vercel ${r.status}` };
            const text = await r.text();
            const lines = text.trim().split('\n').slice(-50);
            const events: any[] = [];
            for (const l of lines) {
              try {
                const e = JSON.parse(l);
                if (params.query && !JSON.stringify(e).toLowerCase().includes(params.query.toLowerCase())) continue;
                events.push({ time: e.timestampInMs ? new Date(e.timestampInMs).toISOString() : null, level: e.level, message: (e.message || '').slice(0, 300) });
              } catch {}
            }
            return { count: events.length, events: events.slice(-20) };
          } catch (e: any) {
            return { error: e?.message };
          }
        },
      }),

      vercelTriggerDeploy: tool({
        description: 'Manually trigger a production deploy for a Vercel project from main branch. Normally not needed — git pushes auto-deploy. Use only when retrying after a fix without a new commit.',
        inputSchema: z.object({
          project: z.string(),
          repo: z.string().optional().describe('GitHub owner/repo, default americavisas/lighthouse-talent-hub'),
          branch: z.string().optional(),
        }),
        execute: async (params: any) => {
          try {
            const repo = params.repo || DEFAULT_REPO;
            const [org, name] = repo.split('/');
            const branch = params.branch || DEFAULT_BRANCH;
            const r = await vercel(`/v13/deployments`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: params.project,
                project: params.project,
                target: 'production',
                gitSource: { type: 'github', org, repo: name, ref: branch },
              }),
            });
            const d: any = await r.json();
            if (!r.ok) return { error: d.error?.message || `Vercel ${r.status}` };
            return { id: d.id, url: d.url, state: d.readyState };
          } catch (e: any) {
            return { error: e?.message };
          }
        },
      }),

      // ── Google Analytics 4 (real data) ─────────────────────
      ga4Summary: tool({
        description:
          'Get a high-level GA4 summary for talent-visas.com over the last 30 days vs the previous 30 days. Returns sessions, users, conversions, engagement rate, plus % deltas. Use this when the user asks "how is the site doing", "what are the numbers", or for the sidebar overview.',
        inputSchema: z.object({}),
        execute: async () => {
          try {
            return await getGA4Summary();
          } catch (e: any) {
            return { error: e?.message || 'GA4 summary failed' };
          }
        },
      }),

      ga4TopPages: tool({
        description:
          'Top pages of talent-visas.com by sessions over the last 30 days, with conversions per page. Useful for spotting underperforming or top-converting pages.',
        inputSchema: z.object({
          limit: z.number().optional().describe('Max rows to return (default 10).'),
        }),
        execute: async (params: any) => {
          try {
            return await getTopPages(params?.limit || 10);
          } catch (e: any) {
            return { error: e?.message || 'GA4 top pages failed' };
          }
        },
      }),

      ga4TopSources: tool({
        description:
          'Top traffic sources / mediums (e.g. google/organic, direct, t.co/referral) over the last 30 days with sessions + conversions. Useful for understanding where leads come from.',
        inputSchema: z.object({
          limit: z.number().optional().describe('Max rows (default 10).'),
        }),
        execute: async (params: any) => {
          try {
            return await getTopSources(params?.limit || 10);
          } catch (e: any) {
            return { error: e?.message || 'GA4 top sources failed' };
          }
        },
      }),

      ga4ConversionsByEvent: tool({
        description:
          'Event counts grouped by event name (last 30 days). Useful for tracking the new conversion events: quiz_started, generate_lead, consultation_click.',
        inputSchema: z.object({
          limit: z.number().optional(),
        }),
        execute: async (params: any) => {
          try {
            return await getConversionsByEvent(params?.limit || 20);
          } catch (e: any) {
            return { error: e?.message || 'GA4 events failed' };
          }
        },
      }),

      ga4Report: tool({
        description:
          'Run a custom GA4 report. Use when ga4Summary / ga4TopPages / ga4TopSources / ga4ConversionsByEvent do not cover what you need. Common metrics: sessions, totalUsers, conversions, engagementRate, eventCount, screenPageViews, bounceRate. Common dimensions: pagePath, sessionSourceMedium, country, deviceCategory, eventName, date.',
        inputSchema: z.object({
          metrics: z.array(z.string()).describe('GA4 metric names'),
          dimensions: z.array(z.string()).optional().describe('GA4 dimension names'),
          startDate: z.string().optional().describe('YYYY-MM-DD or relative like "30daysAgo"'),
          endDate: z.string().optional().describe('YYYY-MM-DD or relative like "today"'),
          limit: z.number().optional(),
        }),
        execute: async (params: any) => {
          try {
            return await runGA4Report(params);
          } catch (e: any) {
            return { error: e?.message || 'GA4 report failed' };
          }
        },
      }),

      // ── Memory tools ───────────────────────────────────────
      rememberThis: tool({
        description:
          'Append a one-line fact to the persistent project MEMORY.md so future chat sessions remember it. Use for stable, durable facts (a new ID, a new repo, a new convention, a decision the user made). Do NOT use for transient chat content. Categories: business / tech / marketing / pending / convention.',
        inputSchema: z.object({
          note: z.string().describe('The fact to remember, written as a single concise sentence.'),
          category: z
            .enum(['business', 'tech', 'marketing', 'pending', 'convention'])
            .describe('Where in MEMORY.md this fact belongs.'),
        }),
        execute: async (params: any) => {
          try {
            const mem = await loadMemory();
            if (!mem.sha) return { error: 'Could not load current MEMORY.md' };
            const today = new Date().toISOString().slice(0, 10);
            const line = `- _(${today})_ ${params.note}`;
            // Append to the end of the file under a "## Notes appended by the agent" section
            let updated = mem.content;
            const headerLine = '## Notes appended by the agent';
            if (updated.includes(headerLine)) {
              updated = updated.replace(headerLine, `${headerLine}\n${line}`);
            } else {
              updated = updated.replace(/(\n*)$/, `\n\n${headerLine}\n${line}\n`);
            }
            const r = await gh(`/repos/${DASHBOARD_REPO}/contents/${MEMORY_PATH}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                message: `memory: ${params.note.slice(0, 60)}`,
                content: Buffer.from(updated, 'utf8').toString('base64'),
                branch: 'master',
                sha: mem.sha,
              }),
            });
            const d: any = await r.json();
            if (!r.ok) return { error: d.message || `GitHub ${r.status}` };
            invalidateMemoryCache();
            return { status: '✅ Remembered', note: params.note, category: params.category, commitUrl: d.commit?.html_url };
          } catch (e: any) {
            return { error: e?.message };
          }
        },
      }),

      updateMemory: tool({
        description:
          'Replace MEMORY.md entirely with new content. Use when restructuring the memory file (rare). For single-fact additions, prefer rememberThis.',
        inputSchema: z.object({
          content: z.string().describe('Full new contents of MEMORY.md (markdown).'),
          message: z.string().describe('One-line commit message describing the change.'),
        }),
        execute: async (params: any) => {
          try {
            const mem = await loadMemory();
            const r = await gh(`/repos/${DASHBOARD_REPO}/contents/${MEMORY_PATH}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                message: `memory: ${params.message}`,
                content: Buffer.from(params.content, 'utf8').toString('base64'),
                branch: 'master',
                ...(mem.sha ? { sha: mem.sha } : {}),
              }),
            });
            const d: any = await r.json();
            if (!r.ok) return { error: d.message || `GitHub ${r.status}` };
            invalidateMemoryCache();
            return { status: '✅ Memory rewritten', commitUrl: d.commit?.html_url };
          } catch (e: any) {
            return { error: e?.message };
          }
        },
      }),

      // ── Specialized shortcuts (kept) ───────────────────────
      generateKeywords: tool({
        description: 'Generate Google Ads keywords for a specific visa type, organized by match type and ad group',
        inputSchema: z.object({
          visaTypes: z.array(z.string()).describe('Visa types to target e.g. ["EB-2 NIW", "O-1"]'),
          audience: z.string().optional().describe('Target audience description'),
          includeCompetitor: z.boolean().optional().describe('Include competitor/general terms'),
        }),
        execute: async (params: any) => {
          const { visaTypes, includeCompetitor = true } = params;
          const adGroups: Record<string, object> = {};
          for (const visa of visaTypes) {
            adGroups[`${visa} - High Intent`] = {
              exact: [`[${visa} visa attorney]`, `[${visa} immigration lawyer]`, `[${visa} petition]`],
              phrase: [`"${visa} visa"`, `"${visa} attorney"`, `"${visa} requirements"`, `"${visa} eligibility"`],
              broad: [`${visa} immigration attorney help`, `how to get ${visa} approval`, `best lawyer ${visa} petition`],
            };
          }
          if (includeCompetitor) {
            adGroups['General - High Intent'] = {
              exact: ['[talent visa lawyer]', '[immigration attorney near me]', '[extraordinary ability visa]'],
              phrase: ['"immigration lawyer for professionals"', '"work visa attorney"', '"US talent visa"'],
              broad: ['best immigration attorney talent visa', 'immigration lawyer work authorization'],
            };
          }
          return {
            adGroups,
            negativeKeywords: ['-free visa', '-tourist visa', '-student visa', '-DIY visa', '-visa scam'],
            totalKeywords: Object.values(adGroups).reduce((acc, g: any) => acc + Object.values(g).flat().length, 0),
            tip: 'Start with exact match. Add phrase match after 2 weeks of data.',
          };
        },
      }),

      generateAdCopy: tool({
        description: 'Generate Google Responsive Search Ad copy: 15 headlines + 4 descriptions',
        inputSchema: z.object({
          visaType: z.string().describe('Visa type e.g. "O-1B Extraordinary Ability"'),
          sellingPoints: z.array(z.string()).optional().describe('Key differentiators'),
          targetAudience: z.string().optional().describe('Who sees this ad'),
          cta: z.enum(['Free Consultation', 'Free Case Evaluation', 'Get Started Today', 'Apply Now', 'Talk to an Attorney']).optional(),
        }),
        execute: async (params: any) => {
          const { visaType, sellingPoints = ['high approval rate', 'free evaluation'], targetAudience = 'professionals', cta = 'Free Consultation' } = params;
          const headlines = [
            `${visaType} Attorneys`,
            `Expert ${visaType} Lawyers`,
            `${cta} - ${visaType}`,
            `${visaType} Petition Help`,
            'Talent Visas - Free Consult',
            'Immigration Law Specialists',
            'High Approval Rate',
            `${visaType} - Fast Processing`,
            'Experienced Visa Attorneys',
            `${targetAudience} Visa Experts`,
            'Trusted Immigration Help',
            'Nationwide Immigration Law',
            'Free Case Evaluation',
            `${visaType} - Apply Now`,
            'Talk to an Attorney Today',
          ].map((h: string) => h.slice(0, 30));

          const descriptions = [
            `Talent Visas specializes in ${visaType} petitions for ${targetAudience}. ${sellingPoints[0]}. ${cta}.`.slice(0, 90),
            `Struggling with ${visaType} requirements? Our attorneys guide you every step. ${cta} today.`.slice(0, 90),
            `Proven ${visaType} approval record. ${sellingPoints[1] || 'Contact us today'} — no obligation.`.slice(0, 90),
            `Don't navigate ${visaType} alone. We handle your petition start to finish. ${cta} now.`.slice(0, 90),
          ];

          return {
            responsiveSearchAd: { headlines, descriptions, finalUrl: 'https://talent-visas.com', displayPath: [visaType.replace(' ', '-').slice(0, 15), 'attorney'] },
            policyNotes: ['No guaranteed outcomes', 'Landing page must match ad claims'],
          };
        },
      }),

      recommendBudget: tool({
        description: 'Recommend Google Ads budget, bidding strategy and expected performance',
        inputSchema: z.object({
          visaTypes: z.array(z.string()),
          monthlyClientGoal: z.number().describe('New clients per month target'),
          geography: z.string().optional().describe('Target geography e.g. "nationwide US"'),
        }),
        execute: async (params: any) => {
          const { visaTypes, monthlyClientGoal, geography = 'nationwide US' } = params;
          const avgCpc = 12;
          const convRate = 0.015;
          const leadToClient = 0.20;
          const leadsNeeded = monthlyClientGoal / leadToClient;
          const budget = Math.round((leadsNeeded / convRate) * avgCpc);
          return {
            recommended: `$${budget}/month`,
            minimum: `$${Math.round(budget * 0.5)}/month`,
            aggressive: `$${Math.round(budget * 1.8)}/month`,
            biddingTimeline: {
              month1: 'Manual CPC $8–12/click — gather data',
              month3: 'Switch to Maximize Conversions (30+ conversions needed)',
              month4Plus: 'Target CPA once you know your actual cost per lead',
            },
            cpcByVisa: Object.fromEntries(visaTypes.map((v: string) => [v, '$8–$20'])),
            geography,
          };
        },
      }),

      generateLandingPage: tool({
        description: 'Generate a complete Next.js landing page component for a specific visa type, ready to add to the website',
        inputSchema: z.object({
          visaType: z.string().describe('e.g. "O-1B Extraordinary Ability"'),
          targetAudience: z.string().describe('e.g. "artists, entertainers, performers"'),
          slug: z.string().describe('URL slug e.g. "o-1b-visa"'),
        }),
        execute: async (params: any) => {
          const { visaType, targetAudience, slug } = params;
          const component = `// app/${slug}/page.tsx
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '${visaType} Attorney | Talent Visas',
  description: 'Expert ${visaType} immigration attorneys for ${targetAudience}. Free case evaluation. High approval rates.',
}

export default function ${visaType.replace(/[^a-zA-Z]/g, '')}Page() {
  return (
    <main className="min-h-screen">
      {/* Hero */}
      <section className="bg-blue-900 text-white py-20 px-6">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-4xl font-bold mb-4">${visaType} Visa Attorneys</h1>
          <p className="text-xl mb-8">Expert legal help for ${targetAudience}. Free case evaluation.</p>
          <a href="/contact" className="bg-amber-500 text-white px-8 py-4 rounded-lg font-bold text-lg hover:bg-amber-600">
            Get Free Consultation
          </a>
        </div>
      </section>

      {/* What is this visa */}
      <section className="py-16 px-6 max-w-4xl mx-auto">
        <h2 className="text-3xl font-bold mb-6">What is the ${visaType} Visa?</h2>
        <p className="text-gray-600 text-lg">
          The ${visaType} visa is designed for ${targetAudience} who have demonstrated extraordinary achievement
          in their field. Our experienced immigration attorneys help you build the strongest possible petition.
        </p>
      </section>

      {/* Eligibility */}
      <section className="bg-gray-50 py-16 px-6">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold mb-6">Do You Qualify?</h2>
          <ul className="space-y-3 text-lg">
            <li className="flex items-start gap-3">
              <span className="text-green-500 font-bold">✓</span>
              Extraordinary achievement in your field
            </li>
            <li className="flex items-start gap-3">
              <span className="text-green-500 font-bold">✓</span>
              Coming to the US to continue work in your area of extraordinary ability
            </li>
            <li className="flex items-start gap-3">
              <span className="text-green-500 font-bold">✓</span>
              US employer or agent sponsorship
            </li>
          </ul>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-blue-900 text-white py-16 px-6 text-center">
        <h2 className="text-3xl font-bold mb-4">Start Your ${visaType} Petition Today</h2>
        <p className="text-xl mb-8">Free case evaluation — no obligation</p>
        <a href="/contact" className="bg-amber-500 text-white px-8 py-4 rounded-lg font-bold text-lg hover:bg-amber-600">
          Free Consultation
        </a>
      </section>
    </main>
  )
}`;
          // Actually commit it to americavisas/lighthouse-talent-hub via GitHub API
          const filePath = `app/${slug}/page.tsx`;
          const ghToken = process.env.GITHUB_TOKEN;
          const repo = 'americavisas/lighthouse-talent-hub';
          const branch = 'main';

          if (!ghToken) {
            return { component, filePath, error: 'GITHUB_TOKEN not configured', seoMetadata: { title: `${visaType} Attorney | Talent Visas`, slug: `/${slug}` } };
          }

          try {
            // Check if file already exists (need its sha to update)
            const existing = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}?ref=${branch}`, {
              headers: { 'Authorization': `Bearer ${ghToken}`, 'Accept': 'application/vnd.github+json' },
            });
            const existingData: any = existing.status === 200 ? await existing.json() : null;

            const putRes = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}`, {
              method: 'PUT',
              headers: { 'Authorization': `Bearer ${ghToken}`, 'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json' },
              body: JSON.stringify({
                message: `Add ${visaType} landing page (${slug})`,
                content: Buffer.from(component, 'utf8').toString('base64'),
                branch,
                ...(existingData?.sha ? { sha: existingData.sha } : {}),
              }),
            });
            const putData: any = await putRes.json();
            if (!putRes.ok) {
              return { component, filePath, error: putData.message || `GitHub returned ${putRes.status}`, seoMetadata: { title: `${visaType} Attorney | Talent Visas`, slug: `/${slug}` } };
            }
            return {
              status: '✅ Committed and deploying',
              filePath,
              commitUrl: putData.commit?.html_url,
              liveUrlSoon: `https://talent-visas.com/${slug}`,
              note: 'Vercel will auto-deploy the lighthouse-talent-hub project in ~1 minute.',
              seoMetadata: { title: `${visaType} Attorney | Talent Visas`, slug: `/${slug}` },
            };
          } catch (e: any) {
            return { component, filePath, error: e?.message || 'Commit failed', seoMetadata: { title: `${visaType} Attorney | Talent Visas`, slug: `/${slug}` } };
          }
        },
      }),

      searchWeb: tool({
        description: 'Search the web for competitor ads, immigration news, keyword data, or any research',
        inputSchema: z.object({
          query: z.string().describe('Search query'),
        }),
        execute: async (params: any) => {
          const { query } = params;
          return { note: `Web search for: "${query}" — connect a search API (Brave, Google) to activate this tool.`, query };
        },
      }),

      analyzeCompetitor: tool({
        description: 'Analyze a competitor immigration law firm website for their keywords, angles, and ad strategy',
        inputSchema: z.object({
          domain: z.string().describe('Competitor domain e.g. "murthy.com"'),
        }),
        execute: async (params: any) => {
          const { domain } = params;
          return {
            domain,
            note: `To fully analyze ${domain}, connect a web scraping API. For now, manually check: adstransparency.google.com and search "${domain}" there.`,
            manualSteps: [
              `Go to adstransparency.google.com and search ${domain}`,
              'Check their active ads and headlines',
              'Note their key selling points and CTAs',
              'Compare to your talent-visas.com positioning',
            ],
          };
        },
      }),

      generateBlogPost: tool({
        description: 'Generate an SEO-optimized blog post for talent-visas.com on any immigration topic',
        inputSchema: z.object({
          topic: z.string().describe('Blog post topic e.g. "EB-2 NIW for software engineers"'),
          targetKeyword: z.string().describe('Primary SEO keyword'),
          wordCount: z.number().optional().describe('Target word count, default 800'),
        }),
        execute: async (params: any) => {
          const { topic, targetKeyword } = params;
          return {
            title: `${topic} — Complete Guide ${new Date().getFullYear()}`,
            slug: targetKeyword.toLowerCase().replace(/\s+/g, '-'),
            outline: [
              `H1: ${topic}`,
              'H2: What is [visa/topic]?',
              'H2: Who qualifies?',
              'H2: Step-by-step process',
              'H2: Common mistakes to avoid',
              'H2: How Talent Visas can help',
              'CTA: Free consultation',
            ],
            targetKeyword,
            seoTips: [
              `Use "${targetKeyword}" in H1, first paragraph, and 2-3 subheadings`,
              'Add internal links to relevant visa landing pages',
              'Include FAQ section for featured snippet opportunity',
              'Target 800-1200 words for immigration blog posts',
            ],
            note: 'Full content generation active — ask me to write the complete article.',
          };
        },
      }),

      generateSocialPost: tool({
        description: 'Generate LinkedIn or Instagram posts about immigration news, visa tips, or success stories',
        inputSchema: z.object({
          platform: z.enum(['linkedin', 'instagram']),
          topic: z.string().describe('Post topic e.g. "EB-2 NIW approval for PhD researcher"'),
          tone: z.enum(['professional', 'educational', 'celebratory']).optional(),
        }),
        execute: async (params: any) => {
          const { platform, topic } = params;
          const linkedinPost = `🎯 ${topic}

At Talent Visas, we've seen this pattern repeatedly — and here's what makes the difference:

→ Strong evidence package
→ Expert legal strategy
→ Attention to USCIS requirements

Whether you're pursuing an EB-2 NIW, O-1, or EB-1, the right preparation matters.

Thinking about your US immigration options? Let's talk.

📩 talent-visas.com/contact
#ImmigrationLaw #TalentVisa #USVisa #EB2NIW #O1Visa`;

          const instagramPost = `${topic} ✨

The path to your US talent visa starts with the right team by your side.

💼 Expert immigration attorneys
✅ High approval rates
🆓 Free case evaluation

Link in bio → talent-visas.com

#TalentVisa #USImmigration #EB1 #EB2NIW #O1Visa #ImmigrationAttorney #WorkVisa`;

          return {
            post: platform === 'linkedin' ? linkedinPost : instagramPost,
            platform,
            recommendedTime: platform === 'linkedin' ? 'Tuesday–Thursday 8–10am or 5–6pm' : 'Wednesday or Friday 11am or 7pm',
            hashtags: platform === 'instagram' ? '#TalentVisa #USImmigration #EB1 #EB2NIW #O1Visa' : '#ImmigrationLaw #TalentVisa #USVisa',
          };
        },
      }),
    },
  });

  return result.toUIMessageStreamResponse();
}
