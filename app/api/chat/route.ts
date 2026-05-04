import { anthropic } from '@ai-sdk/anthropic';
import { streamText, tool } from 'ai';
import { z } from 'zod';

const SYSTEM_PROMPT = `You are the digital marketing command center for talent-visas.com — an immigration law firm specializing in US talent visas (EB-1, EB-2 NIW, O-1, H-1B, L-1, EB-5, TN and more).

You manage everything:
- Google Ads: strategy, keywords, ad copy, campaigns, bidding
- Website: content, landing pages, SEO (GitHub repo: americavisas/lighthouse-talent-hub)
- Social media: LinkedIn and Instagram posts
- Analytics: Google Analytics 4 and Search Console data
- Research: competitor analysis, USCIS news, keyword trends

Your personality: direct, strategic, action-oriented. Don't just advise — execute.
When you identify something to fix, fix it. When you suggest a landing page, build it.

Key context:
- Domain: talent-visas.com
- GitHub: github.com/americavisas/lighthouse-talent-hub
- Framework: Next.js
- Deployment: Vercel
- Target audience: high-skilled professionals seeking US talent visas`;

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = streamText({
    model: anthropic('claude-sonnet-4-6'),
    system: SYSTEM_PROMPT,
    messages,
    maxSteps: 10,
    tools: {
      generateKeywords: tool({
        description: 'Generate Google Ads keywords for a specific visa type, organized by match type and ad group',
        parameters: z.object({
          visaTypes: z.array(z.string()).describe('Visa types to target e.g. ["EB-2 NIW", "O-1"]'),
          audience: z.string().optional().describe('Target audience description'),
          includeCompetitor: z.boolean().optional().describe('Include competitor/general terms'),
        }),
        execute: async ({ visaTypes, audience, includeCompetitor = true }) => {
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
        parameters: z.object({
          visaType: z.string().describe('Visa type e.g. "O-1B Extraordinary Ability"'),
          sellingPoints: z.array(z.string()).optional().describe('Key differentiators'),
          targetAudience: z.string().optional().describe('Who sees this ad'),
          cta: z.enum(['Free Consultation', 'Free Case Evaluation', 'Get Started Today', 'Apply Now', 'Talk to an Attorney']).optional(),
        }),
        execute: async ({ visaType, sellingPoints = ['high approval rate', 'free evaluation'], targetAudience = 'professionals', cta = 'Free Consultation' }) => {
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
          ].map(h => h.slice(0, 30));

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
        parameters: z.object({
          visaTypes: z.array(z.string()),
          monthlyClientGoal: z.number().describe('New clients per month target'),
          geography: z.string().optional().describe('Target geography e.g. "nationwide US"'),
        }),
        execute: async ({ visaTypes, monthlyClientGoal, geography = 'nationwide US' }) => {
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
            cpcByVisa: Object.fromEntries(visaTypes.map(v => [v, '$8–$20'])),
            geography,
          };
        },
      }),

      generateLandingPage: tool({
        description: 'Generate a complete Next.js landing page component for a specific visa type, ready to add to the website',
        parameters: z.object({
          visaType: z.string().describe('e.g. "O-1B Extraordinary Ability"'),
          targetAudience: z.string().describe('e.g. "artists, entertainers, performers"'),
          slug: z.string().describe('URL slug e.g. "o-1b-visa"'),
        }),
        execute: async ({ visaType, targetAudience, slug }) => {
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
          return {
            component,
            filePath: `app/${slug}/page.tsx`,
            instructions: `Add this file to your lighthouse-talent-hub repo at app/${slug}/page.tsx — Vercel will auto-deploy.`,
            seoMetadata: { title: `${visaType} Attorney | Talent Visas`, slug: `/${slug}` },
          };
        },
      }),

      searchWeb: tool({
        description: 'Search the web for competitor ads, immigration news, keyword data, or any research',
        parameters: z.object({
          query: z.string().describe('Search query'),
        }),
        execute: async ({ query }) => {
          return { note: `Web search for: "${query}" — connect a search API (Brave, Google) to activate this tool.`, query };
        },
      }),

      analyzeCompetitor: tool({
        description: 'Analyze a competitor immigration law firm website for their keywords, angles, and ad strategy',
        parameters: z.object({
          domain: z.string().describe('Competitor domain e.g. "murthy.com"'),
        }),
        execute: async ({ domain }) => {
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
        parameters: z.object({
          topic: z.string().describe('Blog post topic e.g. "EB-2 NIW for software engineers"'),
          targetKeyword: z.string().describe('Primary SEO keyword'),
          wordCount: z.number().optional().describe('Target word count, default 800'),
        }),
        execute: async ({ topic, targetKeyword, wordCount = 800 }) => {
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
        parameters: z.object({
          platform: z.enum(['linkedin', 'instagram']),
          topic: z.string().describe('Post topic e.g. "EB-2 NIW approval for PhD researcher"'),
          tone: z.enum(['professional', 'educational', 'celebratory']).optional(),
        }),
        execute: async ({ platform, topic, tone = 'professional' }) => {
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

  return result.toDataStreamResponse();
}
