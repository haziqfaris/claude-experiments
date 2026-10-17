import React, { useState, useEffect, useRef } from 'react';
import { Send, Terminal as TerminalIcon, X } from 'lucide-react';
import { Message, ProjectSnapshot } from '../types';

interface TerminalProps {
  messages: Message[];
  onSendMessage: (text: string) => void;
  isProcessing: boolean;
  isStreaming: boolean;
  projects: ProjectSnapshot[];
  focusId: string | null;
  onFocus: (id: string | null) => void;
}

const Terminal: React.FC<TerminalProps> = ({ messages, onSendMessage, isProcessing, isStreaming, projects, focusId, onFocus }) => {
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const focus = projects.find(p => p.id === focusId) ?? null;
  const subject = focus ?? projects[0] ?? null;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages]);

  const send = (text: string) => {
    if (!text.trim() || isProcessing) return;
    onSendMessage(text.trim());
    setInput('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    send(input);
  };

  const suggestions = [
    subject ? `What was I doing in ${subject.name}?` : 'What is happening across my projects?',
    'Which project burned the most tokens today?',
    'Is any session close to its context limit?',
    subject ? `What should I do next in ${subject.name}?` : 'Summarize today',
    'Which API keys does each project use, and for which API?',
    '/find noreply',
  ];

  return (
    <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 w-full max-w-2xl px-4 z-50">
      <div className="glass-panel rounded-lg p-4 flex flex-col gap-3 max-h-[42vh]" style={{ background: 'rgba(4, 8, 17, 0.96)' }}>

        {/* Header */}
        <div className="flex flex-wrap items-center gap-2 text-reka-cyan border-b border-reka-cyan/20 pb-2">
          <TerminalIcon size={14} />
          <span className="text-xs font-mono tracking-widest uppercase">Direct Link // Soul Protocol</span>
          <div className="ml-auto flex items-center gap-2">
            {focus && (
              <button
                type="button"
                onClick={() => onFocus(null)}
                className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest text-reka-magenta border border-reka-magenta/40 bg-reka-magenta/10 rounded px-2 py-1 hover:bg-reka-magenta/20"
                aria-label={`Clear focus on ${focus.name}`}
              >
                @{focus.name} <X size={10} />
              </button>
            )}
            <label className="sr-only" htmlFor="soul-focus">Focus project</label>
            <select
              id="soul-focus"
              value={focusId ?? ''}
              onChange={e => onFocus(e.target.value || null)}
              className="bg-reka-dark/70 border border-reka-cyan/30 rounded text-[11px] font-mono text-reka-cyan px-2 py-1 max-w-[160px] focus:outline-none focus:border-reka-cyan"
            >
              <option value="">ALL PROJECTS</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Message history */}
        <div className="flex-1 overflow-y-auto min-h-[90px] scrollbar-hide space-y-3 p-2" aria-live="polite">
          {messages.length === 0 && (
            <div className="flex flex-col items-center gap-3 mt-2">
              <div className="text-center text-gray-400 text-xs italic font-mono">
                Connection established. The Soul Engine is listening, architect. Ask about any project.
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {suggestions.map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    className="text-[11px] font-mono text-reka-cyan/80 border border-dashed border-reka-cyan/30 rounded px-3 py-2 hover:text-white hover:border-reka-cyan transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((msg, i) => {
            const streamingThis = isStreaming && i === messages.length - 1 && msg.role === 'system';
            return (
              <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                <div className={`max-w-[85%] p-2 rounded text-sm font-mono whitespace-pre-wrap break-words ${
                  msg.role === 'user'
                    ? 'bg-reka-cyan/10 text-reka-cyan border border-reka-cyan/30'
                    : 'bg-reka-magenta/10 text-[#ff8cff] border border-reka-magenta/30'
                } ${streamingThis ? 'caret' : ''}`}>
                  {msg.content}
                </div>
                {msg.meta && (
                  <div className="text-[10px] font-mono text-gray-400 mt-1 tracking-wider">{msg.meta}</div>
                )}
              </div>
            );
          })}
          {isProcessing && !isStreaming && (
            <div className="flex justify-start">
              <div className="text-xs text-reka-gold animate-pulse font-mono">
                {'>'} Analyzing Resonance Pattern{focus ? ` in ${focus.name}` : ''}...
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <form onSubmit={handleSubmit} className="relative flex items-center gap-2">
          <label className="sr-only" htmlFor="soul-input">Ask the Soul Engine</label>
          <input
            id="soul-input"
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={focus ? `Ask about ${focus.name}…` : 'Ask about any project…'}
            autoComplete="off"
            className="w-full bg-reka-dark/50 border border-reka-cyan/30 rounded px-4 py-3 pr-12 text-white font-mono focus:outline-none focus:border-reka-cyan focus:shadow-[0_0_10px_rgba(0,242,255,0.3)] transition-all placeholder-gray-500"
            disabled={isProcessing}
          />
          <button
            type="submit"
            disabled={isProcessing}
            aria-label="Transmit"
            className="absolute right-1 p-3 text-reka-cyan hover:text-white transition-colors disabled:opacity-50"
          >
            <Send size={18} />
          </button>
        </form>
      </div>
    </div>
  );
};

export default Terminal;
