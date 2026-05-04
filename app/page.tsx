'use client';

import { useChat } from '@ai-sdk/react';
import { useEffect, useRef, useState } from 'react';
import { Send, Zap, ChevronRight, Square, AlertCircle, Plus } from 'lucide-react';

const QUICK_ACTIONS = [
  { label: 'O-1B Landing Page', prompt: 'Create a complete O-1B extraordinary ability landing page for performing artists and entertainers for talent-visas.com', icon: '🌐' },
  { label: 'EB-2 NIW Keywords', prompt: 'Generate a full Google Ads keyword list for EB-2 NIW targeting researchers, PhDs and STEM professionals', icon: '🎯' },
  { label: 'Competitor Research', prompt: 'Give me a step-by-step plan to analyze competitors like Murthy Law and Fragomen on Google Ads Transparency Center and find keyword gaps I can exploit', icon: '🔍' },
  { label: 'LinkedIn Post', prompt: 'Write a LinkedIn post about the EB-2 NIW visa for STEM researchers — professional tone, include hashtags', icon: '💼' },
  { label: 'Budget Plan', prompt: 'I want 10 new clients per month from Google Ads targeting EB-2 NIW, O-1 and EB-1 visas in California and New York. What budget do I need and what strategy should I follow?', icon: '💰' },
  { label: 'Instagram Post', prompt: 'Write an Instagram post about talent visas for artists and performers — engaging tone with emojis and hashtags', icon: '📸' },
];

interface StatsResponse {
  ok: boolean;
  ga4?: {
    current: { sessions: number; users: number; conversions: number; engagementRate: number };
    delta: { sessions: number; users: number; conversions: number };
  };
  error?: string;
  hint?: string;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return n.toString();
}

function StatCard({
  label,
  value,
  delta,
  loading,
}: {
  label: string;
  value: string;
  delta?: number;
  loading?: boolean;
}) {
  const deltaSign = delta === undefined ? '' : delta > 0 ? '+' : '';
  const deltaClass = delta === undefined
    ? ''
    : delta > 0
      ? 'text-emerald-600'
      : delta < 0
        ? 'text-red-500'
        : 'text-black/40';
  return (
    <div className="flex items-baseline justify-between py-2.5 border-b border-black/5 last:border-0">
      <div className="text-[11px] tracking-wider uppercase text-black/40">{label}</div>
      <div className="flex items-baseline gap-1.5">
        <div className="text-sm font-medium text-black">{loading ? '…' : value}</div>
        {!loading && delta !== undefined && (
          <div className={`text-[10px] ${deltaClass}`}>{deltaSign}{delta}%</div>
        )}
      </div>
    </div>
  );
}

const INTEGRATIONS: { name: string; status: 'live' | 'setup' }[] = [
  { name: 'GitHub', status: 'live' },
  { name: 'Vercel', status: 'live' },
  { name: 'Analytics (GA4)', status: 'live' },
  { name: 'Google Ads', status: 'setup' },
  { name: 'Search Console', status: 'setup' },
  { name: 'LinkedIn', status: 'setup' },
  { name: 'Instagram', status: 'setup' },
];

function ToolResult({ toolName, result }: { toolName: string; result: unknown }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-1 border border-black/10 overflow-hidden text-sm">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-1.5 bg-[#f5f5f3] text-black/70 hover:bg-black/5 transition-colors text-[11px] tracking-wider uppercase"
      >
        <span className="flex items-center gap-2 font-mono normal-case tracking-normal text-xs">
          <Zap size={11} /> {toolName}
        </span>
        <ChevronRight size={11} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <pre className="p-3 bg-white text-[11px] overflow-x-auto text-black/70 max-h-64 font-mono">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}

interface UIPart {
  type: string;
  text?: string;
  toolName?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
}

function AssistantMessage({ parts }: { parts: UIPart[] }) {
  const [showTools, setShowTools] = useState(false);

  const toolParts = parts.filter(
    (p) => p.type === 'dynamic-tool' || (typeof p.type === 'string' && p.type.startsWith('tool-'))
  );

  // Build a unique list of tool names actually used (deduped)
  const toolNames = Array.from(
    new Set(
      toolParts.map((p) => p.toolName ?? p.type.replace('tool-', ''))
    )
  );

  return (
    <div className="space-y-3">
      {parts.map((part, i) => {
        if (part.type === 'text') {
          if (!part.text) return null;
          return (
            <div
              key={i}
              className="bg-white border border-black/10 px-4 py-3 text-sm text-black/80 leading-relaxed whitespace-pre-wrap"
            >
              {part.text}
            </div>
          );
        }
        return null;
      })}

      {toolParts.length > 0 && (
        <div>
          <button
            onClick={() => setShowTools((v) => !v)}
            className="text-[11px] tracking-wider uppercase text-black/30 hover:text-black flex items-center gap-1.5 transition-colors"
          >
            <Zap size={10} />
            <span>
              {toolParts.length} tool{toolParts.length === 1 ? '' : 's'}
              {toolNames.length > 0 && (
                <span className="text-black/20 normal-case tracking-normal font-mono ml-1">
                  · {toolNames.slice(0, 4).join(', ')}{toolNames.length > 4 ? '…' : ''}
                </span>
              )}
            </span>
            <ChevronRight size={10} className={`transition-transform ${showTools ? 'rotate-90' : ''}`} />
          </button>
          {showTools && (
            <div className="mt-2 space-y-1">
              {toolParts.map((part, i) => {
                const name = part.toolName ?? part.type.replace('tool-', '');
                if (part.state === 'output-available') {
                  return <ToolResult key={i} toolName={name} result={part.output} />;
                }
                return (
                  <div
                    key={i}
                    className="flex items-center gap-2 text-xs text-black/50 bg-[#f5f5f3] px-3 py-1.5 font-mono"
                  >
                    <Zap size={11} className="animate-pulse" />
                    {name} ({part.state})
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const STORAGE_KEY = 'talent-visas-chat-v1';

export default function Dashboard() {
  // Hydrate the initial messages from localStorage so refresh doesn't lose state
  const [hydratedMessages, setHydratedMessages] = useState<unknown[] | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setHydratedMessages(JSON.parse(raw));
      else setHydratedMessages([]);
    } catch {
      setHydratedMessages([]);
    }
  }, []);

  const { messages, sendMessage, status, stop, error, setMessages } = useChat({
    messages: (hydratedMessages ?? []) as never,
  });
  const [input, setInput] = useState('');

  // Persist messages on every change
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (hydratedMessages === null) return; // not yet hydrated
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {}
  }, [messages, hydratedMessages]);

  const newChat = () => {
    if (typeof window !== 'undefined') localStorage.removeItem(STORAGE_KEY);
    setMessages([]);
  };

  // Fetch live sidebar stats from /api/stats (GA4)
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch('/api/stats');
        const d = await r.json();
        if (alive) setStats(d);
      } catch (e) {
        if (alive) setStats({ ok: false, error: (e as Error)?.message || 'Stats fetch failed' });
      } finally {
        if (alive) setStatsLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const isLoading = status === 'submitted' || status === 'streaming';

  // Track elapsed time and current activity for visible "thinking" state
  const [elapsedSec, setElapsedSec] = useState(0);
  const startedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (isLoading && startedAtRef.current === null) {
      startedAtRef.current = Date.now();
    }
    if (!isLoading) {
      startedAtRef.current = null;
      setElapsedSec(0);
      return;
    }
    const interval = setInterval(() => {
      if (startedAtRef.current) setElapsedSec(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 500);
    return () => clearInterval(interval);
  }, [isLoading]);

  // Derive what the agent is currently doing from the last assistant message
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  const stepCount = lastAssistant?.parts?.filter((p: { type: string }) => p.type !== 'text' && (p.type === 'dynamic-tool' || (typeof p.type === 'string' && p.type.startsWith('tool-')))).length ?? 0;
  const lastTool = lastAssistant?.parts?.slice().reverse().find((p: { type: string }) => p.type === 'dynamic-tool' || (typeof p.type === 'string' && p.type.startsWith('tool-'))) as { type: string; toolName?: string; state: string } | undefined;
  const currentTool = lastTool?.toolName ?? lastTool?.type?.replace('tool-', '');
  const currentToolState = lastTool?.state;

  // Auto-scroll to bottom only when message count changes or loading state flips
  // (NOT on elapsedSec tick — would scroll every 500ms and feel like a crash)
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, isLoading]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    const text = input;
    setInput('');
    await sendMessage({ text });
  };

  const sendQuickAction = async (prompt: string) => {
    if (isLoading) return;
    await sendMessage({ text: prompt });
  };

  return (
    <div className="flex h-screen bg-white text-black font-sans">
      {/* Sidebar */}
      <aside className="w-72 bg-[#f5f5f3] border-r border-black/10 flex flex-col shrink-0">
        {/* Logo */}
        <div className="px-6 py-6 border-b border-black/10">
          <div className="flex items-baseline gap-2">
            <div className="text-base font-medium text-black tracking-tight">Talent Visas</div>
            <div className="text-[10px] tracking-widest uppercase text-black/30">OS</div>
          </div>
          <div className="text-xs text-black/40 mt-1">Marketing Command</div>
        </div>

        {/* Stats */}
        <div className="px-6 py-5 border-b border-black/10">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] tracking-widest uppercase text-black/40">Last 30 days</div>
            {!statsLoading && stats?.ok && (
              <span className="flex items-center gap-1 text-[10px] tracking-wider uppercase text-emerald-600">
                <span className="w-1 h-1 bg-emerald-500 rounded-full" /> Live
              </span>
            )}
          </div>
          <div className="-my-1">
            <StatCard
              label="Visitors"
              value={stats?.ga4 ? formatNumber(stats.ga4.current.users) : '—'}
              delta={stats?.ga4?.delta.users}
              loading={statsLoading}
            />
            <StatCard
              label="Sessions"
              value={stats?.ga4 ? formatNumber(stats.ga4.current.sessions) : '—'}
              delta={stats?.ga4?.delta.sessions}
              loading={statsLoading}
            />
            <StatCard
              label="Conversions"
              value={stats?.ga4 ? formatNumber(stats.ga4.current.conversions) : '—'}
              delta={stats?.ga4?.delta.conversions}
              loading={statsLoading}
            />
            <StatCard
              label="Engagement"
              value={stats?.ga4 ? `${stats.ga4.current.engagementRate}%` : '—'}
              loading={statsLoading}
            />
          </div>
          {!statsLoading && stats && !stats.ok && (
            <div className="mt-3 p-2 border border-red-200 bg-red-50/50 text-[10px] text-red-700">
              <div className="font-medium mb-0.5">GA4 not connected</div>
              <div className="break-words mb-1 text-red-700/80">{stats.error?.slice(0, 120)}</div>
              {stats.hint && <div className="text-red-700/60">{stats.hint}</div>}
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="px-6 py-5 flex-1 overflow-y-auto">
          <div className="text-[10px] tracking-widest uppercase text-black/40 mb-3">Quick actions</div>
          <div className="space-y-0.5 -mx-2">
            {QUICK_ACTIONS.map((action) => (
              <button
                key={action.label}
                onClick={() => sendQuickAction(action.prompt)}
                disabled={isLoading}
                className="w-full text-left px-2 py-2 text-sm text-black/70 hover:text-black hover:bg-black/5 transition-colors flex items-center gap-3 disabled:opacity-40"
              >
                <span className="text-base leading-none">{action.icon}</span>
                <span className="truncate">{action.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Integrations */}
        <div className="px-6 py-5 border-t border-black/10">
          <div className="text-[10px] tracking-widest uppercase text-black/40 mb-3">Integrations</div>
          <div className="space-y-1.5">
            {INTEGRATIONS.map((it) => (
              <div key={it.name} className="flex items-center justify-between text-xs">
                <span className="text-black/60">{it.name}</span>
                {it.status === 'live' ? (
                  <span className="flex items-center gap-1 text-[10px] tracking-wider uppercase text-emerald-600">
                    <span className="w-1 h-1 bg-emerald-500 rounded-full" /> Live
                  </span>
                ) : (
                  <span className="text-[10px] tracking-wider uppercase text-black/30">Setup</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </aside>

      {/* Main Chat */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="bg-white border-b border-black/10 px-8 py-5 flex items-center justify-between shrink-0">
          <div>
            <h1 className="text-base font-medium text-black tracking-tight">
              <span className="text-black/30">Agent.</span> Marketing
            </h1>
            <p className="text-xs text-black/40 mt-0.5">Managing talent-visas.com — ads, website, social &amp; analytics</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={newChat}
              disabled={isLoading || messages.length === 0}
              className="inline-flex items-center gap-1.5 text-[11px] tracking-widest uppercase text-black/60 hover:text-black hover:bg-black/5 px-3 py-1.5 border border-black/15 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Start a new chat (clears the current conversation; persistent project memory is kept)"
            >
              <Plus size={12} /> New chat
            </button>
            <div className="flex items-center gap-1.5 text-[10px] tracking-widest uppercase text-emerald-600">
              <span className="w-1 h-1 bg-emerald-500 rounded-full animate-pulse" />
              Agent ready
            </div>
          </div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-8 py-8 space-y-6">
          {messages.length === 0 && (
            <div className="max-w-2xl mx-auto py-16">
              <h2 className="text-3xl md:text-5xl font-normal text-black mb-3 tracking-tight">
                <span className="text-black/30">Hello.</span> What do you need today?
              </h2>
              <p className="text-sm text-black/50 mb-12 max-w-md">
                I manage your Google Ads, edit landing pages, write social posts, analyze competitors and read GA4 data.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-black/10 border border-black/10">
                {QUICK_ACTIONS.map((action) => (
                  <button
                    key={action.label}
                    onClick={() => sendQuickAction(action.prompt)}
                    disabled={isLoading}
                    className="bg-white p-5 text-left hover:bg-[#f5f5f3] transition-colors group disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <div className="text-xl mb-3">{action.icon}</div>
                    <div className="text-sm font-medium text-black mb-1">{action.label}</div>
                    <div className="text-[11px] text-black/40 line-clamp-2 leading-relaxed">{action.prompt.slice(0, 80)}…</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="max-w-3xl mx-auto space-y-6">
            {messages.map((message) => (
              <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className="max-w-[80%] min-w-0">
                  {message.role === 'user' ? (
                    <div className="bg-black text-white px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap">
                      {message.parts
                        .filter((p) => p.type === 'text')
                        .map((p, i) => <span key={i}>{(p as { type: 'text'; text: string }).text}</span>)}
                    </div>
                  ) : (
                    <AssistantMessage parts={message.parts ?? []} />
                  )}
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="border border-black/10 bg-[#f5f5f3] px-4 py-3">
                <div className="flex items-center gap-3 text-sm text-black/70">
                  <div className="flex gap-1">
                    {[0, 150, 300].map((delay) => (
                      <div key={delay} className="w-1 h-1 bg-yellow-400 rounded-full animate-bounce" style={{ animationDelay: `${delay}ms` }} />
                    ))}
                  </div>
                  <span className="font-medium">
                    {status === 'submitted' && 'Thinking…'}
                    {status === 'streaming' && currentTool && currentToolState !== 'output-available' && (
                      <>Running <span className="font-mono text-black">{currentTool}</span>…</>
                    )}
                    {status === 'streaming' && (!currentTool || currentToolState === 'output-available') && 'Working…'}
                  </span>
                  <span className="ml-auto flex items-center gap-3 text-[10px] tracking-widest uppercase text-black/40">
                    {stepCount > 0 && <span>step {stepCount}/12</span>}
                    <span>{elapsedSec}s</span>
                    <button
                      onClick={() => stop?.()}
                      className="flex items-center gap-1 px-2 py-0.5 bg-white border border-black/15 hover:bg-black hover:text-white text-black/70 transition-colors"
                      title="Stop the agent"
                    >
                      <Square size={9} fill="currentColor" /> Stop
                    </button>
                  </span>
                </div>
              </div>
            )}

            {error && !isLoading && (() => {
              const msg = (error.message || 'Unknown error').toLowerCase();
              const isNetwork = msg.includes('network') || msg.includes('fetch') || msg.includes('failed to fetch');
              return (
                <div className="border-l-2 border-red-500 bg-red-50/40 px-4 py-3 text-sm">
                  <div className="flex items-start gap-2 mb-1">
                    <AlertCircle size={14} className="text-red-600 mt-0.5 shrink-0" />
                    <div className="font-medium text-red-800">
                      {isNetwork ? 'The connection dropped before the agent finished' : 'The agent ran into a problem'}
                    </div>
                  </div>
                  <div className="text-xs text-red-700/80 break-words ml-6">{error.message || 'Unknown error'}</div>
                  <div className="text-xs text-red-600/60 mt-2 ml-6">
                    {isNetwork
                      ? 'Likely the 5-min function timeout. Any GitHub commits the agent already made are saved. Try again or break into smaller pieces.'
                      : 'Tip: ask in smaller chunks (one task at a time).'}
                  </div>
                </div>
              );
            })()}

            <div ref={scrollRef} />
          </div>
        </div>

        {/* Input */}
        <div className="bg-white border-t border-black/10 px-8 py-5 shrink-0">
          <form onSubmit={handleSubmit} className="max-w-3xl mx-auto">
            <div className="flex gap-2 border border-black/15 focus-within:border-black transition-colors bg-white">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask the agent — edit a page, pull GA4 data, draft an ad…"
                className="flex-1 px-4 py-3 text-sm focus:outline-none bg-transparent placeholder:text-black/30"
                disabled={isLoading}
              />
              <button
                type="submit"
                disabled={isLoading || !input.trim()}
                className="px-5 bg-yellow-400 text-black hover:bg-yellow-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5 text-[11px] tracking-widest uppercase"
              >
                <Send size={12} /> Send
              </button>
            </div>
          </form>
          <p className="text-[10px] tracking-widest uppercase text-black/30 mt-3 text-center">
            Powered by Claude · talent-visas.com
          </p>
        </div>
      </main>
    </div>
  );
}
