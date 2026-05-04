'use client';

import { useChat } from '@ai-sdk/react';
import { useEffect, useRef, useState } from 'react';
import { Send, Globe, Target, BarChart3, Search, Zap, ChevronRight, Bot, User, Square, AlertCircle, Plus } from 'lucide-react';

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
  icon: Icon,
  color,
  bg,
}: {
  label: string;
  value: string;
  delta?: number;
  loading?: boolean;
  icon: any;
  color: string;
  bg: string;
}) {
  const deltaColor = delta === undefined ? '' : delta > 0 ? 'text-green-600' : delta < 0 ? 'text-red-500' : 'text-gray-400';
  const deltaPrefix = delta === undefined ? '' : delta > 0 ? '+' : '';
  return (
    <div className={`flex items-center gap-3 p-2 rounded-lg ${bg}`}>
      <Icon size={16} className={color} />
      <div className="flex-1 min-w-0">
        <div className="text-xs text-gray-500 truncate">{label}</div>
        <div className="flex items-baseline gap-1.5">
          <div className={`text-sm font-bold ${color}`}>{loading ? '…' : value}</div>
          {!loading && delta !== undefined && (
            <div className={`text-[10px] font-medium ${deltaColor}`}>
              {deltaPrefix}
              {delta}%
            </div>
          )}
        </div>
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
    <div className="my-1 border border-blue-100 rounded-lg overflow-hidden text-sm">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-1.5 bg-blue-50 text-blue-700 font-medium hover:bg-blue-100 transition-colors text-xs"
      >
        <span className="flex items-center gap-2"><Zap size={12} /> {toolName}</span>
        <ChevronRight size={12} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <pre className="p-3 bg-gray-50 text-xs overflow-x-auto text-gray-700 max-h-64">
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
    <div className="space-y-2">
      {parts.map((part, i) => {
        if (part.type === 'text') {
          if (!part.text) return null;
          return (
            <div
              key={i}
              className="bg-white border border-gray-200 px-4 py-3 rounded-2xl rounded-tl-sm text-sm text-gray-800 leading-relaxed whitespace-pre-wrap"
            >
              {part.text}
            </div>
          );
        }
        // Tool parts are NOT rendered inline — collapsed into the footer below
        return null;
      })}

      {toolParts.length > 0 && (
        <div>
          <button
            onClick={() => setShowTools((v) => !v)}
            className="text-xs text-gray-400 hover:text-blue-600 flex items-center gap-1.5 transition-colors"
          >
            <Zap size={11} />
            <span>
              used {toolParts.length} tool{toolParts.length === 1 ? '' : 's'}
              {toolNames.length > 0 && (
                <span className="text-gray-300"> · {toolNames.slice(0, 4).join(', ')}{toolNames.length > 4 ? '…' : ''}</span>
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
                    className="flex items-center gap-2 text-xs text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg"
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
    <div className="flex h-screen bg-gray-50 font-sans">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col shrink-0">
        {/* Logo */}
        <div className="p-5 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <Globe size={18} className="text-white" />
            </div>
            <div>
              <div className="font-bold text-gray-900 text-sm">Talent Visas</div>
              <div className="text-xs text-gray-500">Marketing Command</div>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="p-4 border-b border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Last 30 days</div>
            {!statsLoading && stats?.ok && (
              <div className="w-1.5 h-1.5 bg-green-500 rounded-full" title="Live GA4 data" />
            )}
          </div>
          <div className="space-y-2">
            <StatCard
              label="Visitors"
              value={stats?.ga4 ? formatNumber(stats.ga4.current.users) : '—'}
              delta={stats?.ga4?.delta.users}
              loading={statsLoading}
              icon={Globe}
              color="text-purple-600"
              bg="bg-purple-50"
            />
            <StatCard
              label="Sessions"
              value={stats?.ga4 ? formatNumber(stats.ga4.current.sessions) : '—'}
              delta={stats?.ga4?.delta.sessions}
              loading={statsLoading}
              icon={BarChart3}
              color="text-green-600"
              bg="bg-green-50"
            />
            <StatCard
              label="Conversions"
              value={stats?.ga4 ? formatNumber(stats.ga4.current.conversions) : '—'}
              delta={stats?.ga4?.delta.conversions}
              loading={statsLoading}
              icon={Target}
              color="text-blue-600"
              bg="bg-blue-50"
            />
            <StatCard
              label="Engagement"
              value={stats?.ga4 ? `${stats.ga4.current.engagementRate}%` : '—'}
              loading={statsLoading}
              icon={Search}
              color="text-orange-600"
              bg="bg-orange-50"
            />
          </div>
          {!statsLoading && stats && !stats.ok && (
            <div className="mt-2 p-2 bg-red-50 border border-red-100 rounded text-[10px] text-red-700">
              <div className="font-semibold mb-0.5">GA4 not connected</div>
              <div className="break-words mb-1">{stats.error?.slice(0, 120)}</div>
              {stats.hint && <div className="text-red-600/80">{stats.hint}</div>}
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="p-4 flex-1 overflow-y-auto">
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Quick Actions</div>
          <div className="space-y-1">
            {QUICK_ACTIONS.map((action) => (
              <button
                key={action.label}
                onClick={() => sendQuickAction(action.prompt)}
                disabled={isLoading}
                className="w-full text-left px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                <span>{action.icon}</span>
                <span>{action.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Integrations */}
        <div className="p-4 border-t border-gray-100">
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Integrations</div>
          <div className="space-y-1.5">
            {INTEGRATIONS.map((it) => (
              <div key={it.name} className="flex items-center justify-between text-xs">
                <span className="text-gray-600">{it.name}</span>
                {it.status === 'live' ? (
                  <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full font-medium bg-green-50 text-green-600">
                    <span className="w-1 h-1 bg-green-500 rounded-full" /> Live
                  </span>
                ) : (
                  <span className="px-1.5 py-0.5 rounded-full font-medium bg-gray-100 text-gray-400">Setup</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </aside>

      {/* Main Chat */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between shrink-0">
          <div>
            <h1 className="font-bold text-gray-900">Marketing Agent</h1>
            <p className="text-sm text-gray-500">Managing talent-visas.com — ads, website, social &amp; analytics</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={newChat}
              disabled={isLoading || messages.length === 0}
              className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-blue-700 hover:bg-blue-50 px-3 py-1.5 rounded-full border border-gray-200 hover:border-blue-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title="Start a new chat (clears the current conversation; persistent project memory is kept)"
            >
              <Plus size={14} /> New chat
            </button>
            <div className="flex items-center gap-2 text-sm text-green-600 bg-green-50 px-3 py-1.5 rounded-full">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              Agent Ready
            </div>
          </div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
          {messages.length === 0 && (
            <div className="text-center py-16">
              <div className="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Bot size={32} className="text-blue-600" />
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">What do you need today?</h2>
              <p className="text-gray-500 mb-8 max-w-md mx-auto">
                I manage your Google Ads, create landing pages, write social posts, analyze competitors and more.
              </p>
              <div className="grid grid-cols-2 gap-3 max-w-lg mx-auto">
                {QUICK_ACTIONS.slice(0, 4).map((action) => (
                  <button
                    key={action.label}
                    onClick={() => sendQuickAction(action.prompt)}
                    className="p-4 bg-white rounded-xl border border-gray-200 text-left hover:border-blue-300 hover:shadow-sm transition-all group"
                  >
                    <div className="text-2xl mb-2">{action.icon}</div>
                    <div className="text-sm font-medium text-gray-800 group-hover:text-blue-700">{action.label}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message) => (
            <div key={message.id} className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {message.role === 'assistant' && (
                <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shrink-0 mt-1">
                  <Bot size={16} className="text-white" />
                </div>
              )}
              <div className="max-w-2xl min-w-0">
                {message.role === 'user' ? (
                  <div className="bg-blue-600 text-white px-4 py-3 rounded-2xl rounded-tr-sm text-sm">
                    {message.parts
                      .filter((p) => p.type === 'text')
                      .map((p, i) => <span key={i}>{(p as { type: 'text'; text: string }).text}</span>)}
                  </div>
                ) : (
                  <AssistantMessage parts={message.parts ?? []} />
                )}
              </div>
              {message.role === 'user' && (
                <div className="w-8 h-8 bg-gray-200 rounded-lg flex items-center justify-center shrink-0 mt-1">
                  <User size={16} className="text-gray-600" />
                </div>
              )}
            </div>
          ))}

          {isLoading && (
            <div className="flex gap-3">
              <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shrink-0 mt-1 animate-pulse">
                <Bot size={16} className="text-white" />
              </div>
              <div className="flex-1 max-w-2xl">
                <div className="bg-blue-50 border border-blue-200 px-4 py-3 rounded-2xl rounded-tl-sm">
                  <div className="flex items-center gap-2 text-sm text-blue-800 font-medium">
                    <div className="flex gap-1">
                      {[0, 150, 300].map((delay) => (
                        <div key={delay} className="w-1.5 h-1.5 bg-blue-600 rounded-full animate-bounce" style={{ animationDelay: `${delay}ms` }} />
                      ))}
                    </div>
                    <span>
                      {status === 'submitted' && 'Thinking…'}
                      {status === 'streaming' && currentTool && currentToolState !== 'output-available' && (
                        <>Running <span className="font-mono text-blue-700">{currentTool}</span>…</>
                      )}
                      {status === 'streaming' && (!currentTool || currentToolState === 'output-available') && 'Working…'}
                    </span>
                    <span className="ml-auto flex items-center gap-3 text-xs text-blue-600/70 font-normal">
                      {stepCount > 0 && <span>step {stepCount}/12</span>}
                      <span>{elapsedSec}s</span>
                      <button
                        onClick={() => stop?.()}
                        className="flex items-center gap-1 px-2 py-0.5 rounded bg-white border border-blue-200 hover:bg-blue-100 text-blue-700"
                        title="Stop the agent"
                      >
                        <Square size={10} fill="currentColor" /> Stop
                      </button>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {error && !isLoading && (() => {
            const msg = (error.message || 'Unknown error').toLowerCase();
            const isNetwork = msg.includes('network') || msg.includes('fetch') || msg.includes('failed to fetch');
            return (
              <div className="flex gap-3">
                <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center shrink-0 mt-1">
                  <AlertCircle size={16} className="text-white" />
                </div>
                <div className="flex-1 max-w-2xl bg-red-50 border border-red-200 px-4 py-3 rounded-2xl rounded-tl-sm text-sm text-red-800">
                  <div className="font-medium mb-1">
                    {isNetwork ? 'The connection dropped before the agent finished' : 'The agent ran into a problem'}
                  </div>
                  <div className="text-xs text-red-700/80 break-words">{error.message || 'Unknown error'}</div>
                  <div className="text-xs text-red-600/60 mt-2">
                    {isNetwork
                      ? 'The agent was likely still working when the 5-min function timeout hit. Try the same prompt again — the GitHub commits it already made are saved. Or break the request into smaller pieces.'
                      : 'Tip: ask in smaller chunks (one task at a time) — context can blow up when chaining many large tool results.'}
                  </div>
                </div>
              </div>
            );
          })()}

          <div ref={scrollRef} />
        </div>

        {/* Input */}
        <div className="bg-white border-t border-gray-200 px-6 py-4 shrink-0">
          <form onSubmit={handleSubmit} className="flex gap-3">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="e.g. Create an O-1B landing page, write an EB-2 NIW post, analyze competitor keywords..."
              className="flex-1 px-4 py-3 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-gray-50"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="px-5 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            >
              <Send size={16} />
            </button>
          </form>
          <p className="text-xs text-gray-400 mt-2 text-center">
            Powered by Claude · talent-visas.com
          </p>
        </div>
      </main>
    </div>
  );
}
