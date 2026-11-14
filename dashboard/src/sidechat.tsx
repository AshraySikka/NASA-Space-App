import React, { useState, useRef, useEffect } from 'react';
// need to do npm install lucide-react 
import { ArrowUp, Bot, Sparkles, RotateCcw } from 'lucide-react';

/**
 * Interface representing a single chat message in the simulation assistant feed.
 */
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

/**
 * Available quick-preset environment configurations.
 */
const ENVIRONMENT_PRESETS = ['moon', 'freefall'] as const;

export default function App() {
  // State for chat message history
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // State for the current text input value
  const [inputValue, setInputValue] = useState<string>('');
  // State to track active simulation environment parameter
  const [activeEnvironment, setActiveEnvironment] = useState<string | null>(null);
  // State to simulate assistant typing latency
  const [isTyping, setIsTyping] = useState<boolean>(false);

  // Refs for focusing input on preset click and auto-scrolling chat history
  const inputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  /**
   * Smoothly scroll the message feed to the bottom whenever new messages arrive.
   */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  /**
   * Generates a context-aware simulated LLM response based on the user's environment prompt.
   */
  const generateSimulatedResponse = (prompt: string): string => {
    const normalized = prompt.trim().toLowerCase();

    if (normalized === 'moon' || normalized.includes('lunar')) {
      return 'Environment updated to Lunar Surface (g = 1.62 m/s², vacuum atmosphere, minimal convective draft). Ready for flame visualization.';
    }
    if (normalized === 'freefall' || normalized.includes('microgravity') || normalized.includes('zero-g')) {
      return 'Environment updated to Freefall / Microgravity (g ≈ 0.00 m/s², spherical diffusion-dominated combustion regime).';
    }

    return `Simulation parameters calibrated for "${prompt.trim()}". Gravitational and atmospheric boundary conditions updated.`;
  };

  /**
   * Handles submitting a prompt to the chat feed and triggering a simulated assistant reply.
   */
  const handleSendMessage = (e?: React.FormEvent) => {
    if (e) {
      e.preventDefault();
    }

    const trimmed = inputValue.trim();
    if (!trimmed || isTyping) return;

    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed,
      timestamp: now,
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputValue('');
    setActiveEnvironment(trimmed);
    setIsTyping(true);

    // Simulate brief LLM processing delay before appending assistant confirmation
    setTimeout(() => {
      const assistantMsg: ChatMessage = {
        id: `assistant-${Date.now() + 1}`,
        role: 'assistant',
        content: generateSimulatedResponse(trimmed),
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages((prev) => [...prev, assistantMsg]);
      setIsTyping(false);
    }, 450);
  };

  /**
   * Prefills the text field with the selected preset label and focuses the input
   * so the user can either edit or press Enter immediately.
   */
  const handlePresetClick = (preset: string) => {
    setInputValue(preset);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  };

  /**
   * Clears the conversation back to the initial empty prompt state.
   */
  const handleResetChat = () => {
    setMessages([]);
    setInputValue('');
    setActiveEnvironment(null);
    setIsTyping(false);
    inputRef.current?.focus();
  };

  return (
    <div className="flex flex-col md:flex-row h-screen w-screen overflow-hidden bg-[#000000] text-[#ececec] font-sans antialiased selection:bg-[#3f3f46] selection:text-white">
      {/* =====================================================================
          LEFT SIDEBAR: Classic ChatGPT-Styled LLM Environment Controller
          ===================================================================== */}
      <aside
        aria-label="Simulation Assistant Sidebar"
        className="flex flex-col w-full md:w-[400px] lg:w-[410px] md:min-w-[380px] md:max-w-[420px] h-[55vh] md:h-full bg-[#212121] border-b md:border-b-0 md:border-r border-[#2f2f2f] shrink-0 z-10"
      >
        {/* Subtle Minimal Top Header */}
        <header className="flex items-center justify-between px-4 py-3 border-b border-[#2a2a2a]/80 bg-[#171717]/60">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium tracking-tight text-[#ececec]">
              SimGPT
            </span>
            <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-[#2f2f2f] text-[#9b9b9b]">
              v1.0
            </span>
          </div>

          {messages.length > 0 && (
            <button
              type="button"
              onClick={handleResetChat}
              title="Reset conversation"
              className="flex items-center gap-1.5 text-xs text-[#9b9b9b] hover:text-[#ececec] px-2 py-1 rounded-md hover:bg-[#2f2f2f] transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Clear</span>
            </button>
          )}
        </header>

        {/* Main Chat Message Area */}
        <div className="flex-1 overflow-y-auto px-4 py-5 flex flex-col">
          {messages.length === 0 ? (
            /* Empty State Prompt matching classic ChatGPT centered grey prompt */
            <div className="flex-1 flex items-center justify-center text-center px-6">
              <p className="text-[#8e8ea0] text-lg md:text-[19px] font-normal tracking-tight leading-snug select-none">
                What environment do you want to simulate for
              </p>
            </div>
          ) : (
            /* Active Message Feed */
            <div className="space-y-5 my-auto">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex flex-col ${
                    msg.role === 'user' ? 'items-end' : 'items-start'
                  }`}
                >
                  {msg.role === 'user' ? (
                    <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-[#2f2f2f] px-4 py-2.5 text-sm text-[#ececec] leading-relaxed shadow-sm">
                      {msg.content}
                    </div>
                  ) : (
                    <div className="flex items-start gap-3 max-w-[92%]">
                      <div className="w-7 h-7 rounded-full bg-[#171717] border border-[#343434] flex items-center justify-center shrink-0 mt-0.5">
                        <Bot className="w-4 h-4 text-[#b4b4b4]" />
                      </div>
                      <div className="flex-1 text-sm text-[#d1d5db] leading-relaxed pt-0.5">
                        {msg.content}
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {/* Typing Indicator */}
              {isTyping && (
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-full bg-[#171717] border border-[#343434] flex items-center justify-center shrink-0">
                    <Sparkles className="w-3.5 h-3.5 text-[#8e8ea0] animate-pulse" />
                  </div>
                  <div className="flex items-center gap-1 px-2 py-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#8e8ea0] animate-bounce [animation-delay:-0.3s]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-[#8e8ea0] animate-bounce [animation-delay:-0.15s]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-[#8e8ea0] animate-bounce" />
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Bottom Input Dock & Preset Chips */}
        <div className="p-4 pt-2 bg-[#212121]">
          <form
            onSubmit={handleSendMessage}
            className="relative flex items-center w-full rounded-3xl bg-[#2f2f2f] border border-[#3e3e3e] focus-within:border-[#565656] transition-colors shadow-sm px-3.5 py-2"
          >
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Message simulation assistant..."
              aria-label="Simulation environment prompt"
              className="w-full bg-transparent text-sm text-[#ececec] placeholder-[#8e8ea0] focus:outline-none pr-9"
            />
            <button
              type="submit"
              disabled={!inputValue.trim() || isTyping}
              aria-label="Send prompt"
              className={`absolute right-2 flex items-center justify-center w-8 h-8 rounded-full transition-all ${
                inputValue.trim() && !isTyping
                  ? 'bg-[#ececec] text-[#171717] hover:bg-white cursor-pointer'
                  : 'bg-[#424242] text-[#6e6e6e] cursor-not-allowed'
              }`}
            >
              <ArrowUp className="w-4 h-4 stroke-[2.5]" />
            </button>
          </form>

          {/* Preset Environment Chips directly below the text field */}
          <div className="flex items-center gap-2 mt-2.5 px-1">
            {ENVIRONMENT_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => handlePresetClick(preset)}
                className="px-3.5 py-1.5 rounded-full text-xs font-medium bg-[#171717] hover:bg-[#2f2f2f] text-[#b4b4b4] hover:text-[#ececec] border border-[#333333] hover:border-[#4a4a4a] transition-all cursor-pointer active:scale-95"
              >
                {preset}
              </button>
            ))}
          </div>
        </div>
      </aside>

      {/* =====================================================================
          RIGHT VIEWPORT: Pure Black Placeholder Container (#000000)
          ===================================================================== */}
      <main
        aria-label="Flame Simulation Viewport Placeholder"
        data-environment={activeEnvironment ?? 'default'}
        className="flex-1 h-[45vh] md:h-full w-full bg-[#000000]"
      >
        {/* [FLAME VISUAL MOUNT SLOT]: Mount your separate flame visualization canvas/component here */}
      </main>
    </div>
  );
}