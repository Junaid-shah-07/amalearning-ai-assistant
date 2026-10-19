import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  Paperclip,
  Smile,
  Mic,
  MoreVertical,
  Volume2,
  VolumeX,
  RotateCcw,
  Download,
  CheckCheck,
  Check,
  ShieldCheck,
  Sparkles,
  Phone,
  Video,
  Search,
  BookOpen,
  Calendar,
  CreditCard,
  Smartphone,
  Monitor,
  Copy,
  Info,
  ExternalLink
} from 'lucide-react';
import { speakBritishEnglish, stopSpeech } from '../utils/textToSpeech';
import { evaluateResponseQuality, ComplianceCheckResult } from '../utils/complianceChecker';
import { QualityInspectorModal } from './QualityInspectorModal';
import { KnowledgeBaseDrawer } from './KnowledgeBaseDrawer';
import { TestScenario } from '../data/masterPrompt';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  compliance?: {
    overallPass: boolean;
    score: number;
    results: ComplianceCheckResult[];
  };
}

const QUICK_CHIPS = [
  { label: 'Recommend for Child', prompt: 'Which plan do you recommend for my child?' },
  { label: 'What is LOTS?', prompt: 'What is LOTS?' },
  { label: 'Basic Plan £70', prompt: 'How much is your Basic plan?' },
  { label: 'App Only £10.99', prompt: 'Do you have a cheaper plan just for the app?' },
  { label: 'Weekly Sessions', prompt: 'What live tuition and revision sessions does AMAL offer each week?' },
  { label: 'School Licences', prompt: 'Do you provide access for schools?' },
  { label: 'Urdu / اردو', prompt: 'Kya aap GCSE biology aur chemistry ki preparation karwatay hain?' },
  { label: 'Affordability', prompt: "I can't afford the monthly fee. Are there discounts?" },
  { label: 'Contact Support', prompt: 'How do I speak to someone from the team?' },
];

export const WhatsAppChat: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome-1',
      role: 'assistant',
      content:
        "Hi! 👋 I’m Zeeshan from AMAL.\n\nThanks for reaching out! 😊 I can help you explore our GCSE, IGCSE and Cambridge O-Level learning plans, weekly live tuition sessions, Topic Tests and Mock Exams.\n\nWhat can I help you with today?",
      timestamp: '10:00',
      compliance: {
        overallPass: true,
        score: 100,
        results: [],
      },
    },
  ]);

  const [inputText, setInputText] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [viewMode, setViewMode] = useState<'desktop' | 'mobile'>('desktop');
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [activeSpeechId, setActiveSpeechId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Inspector modal state
  const [inspectModalOpen, setInspectModalOpen] = useState(false);
  const [inspectedMessage, setInspectedMessage] = useState<ChatMessage | null>(null);

  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<'scenarios' | 'plans' | 'timetable' | 'prompt' | 'whatsapp'>('scenarios');

  // Phone Call Modal state
  const [callModalOpen, setCallModalOpen] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

  const getCurrentTimeString = () => {
    const now = new Date();
    return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  };

  const handleSendMessage = async (textToSend?: string, nameOverride?: string) => {
    const content = (textToSend || inputText).trim();
    if (!content || isTyping) return;

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content,
      timestamp: getCurrentTimeString(),
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInputText('');
    setIsTyping(true);

    const activeCustomerName = (nameOverride !== undefined ? nameOverride : customerName).trim() || undefined;

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          customerName: activeCustomerName,
          messages: newMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });

      const data = await response.json();
      const replyText = data.reply || "I'm sorry, I couldn't process that right now. Please reach our team at support@amalearning.space.";

      const audit = evaluateResponseQuality(content, replyText, newMessages.length, activeCustomerName);

      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: replyText,
        timestamp: getCurrentTimeString(),
        compliance: audit,
      };

      setMessages((prev) => [...prev, assistantMessage]);

      if (ttsEnabled) {
        speakBritishEnglish(replyText);
      }
    } catch (err) {
      console.error('Failed to send message:', err);
      const fallbackReply = "Our team can confirm that for you at support@amalearning.space.";
      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: fallbackReply,
        timestamp: getCurrentTimeString(),
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleScenarioSelect = (scenario: TestScenario) => {
    handleSendMessage(scenario.initialMessage);
  };

  const handleSpeak = (msg: ChatMessage) => {
    if (activeSpeechId === msg.id) {
      stopSpeech();
      setActiveSpeechId(null);
    } else {
      setActiveSpeechId(msg.id);
      speakBritishEnglish(msg.content, () => {
        setActiveSpeechId(null);
      });
    }
  };

  const handleCopyMessage = (msg: ChatMessage) => {
    navigator.clipboard.writeText(msg.content);
    setCopiedId(msg.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleExportChat = () => {
    const text = messages
      .map(
        (m) =>
          `[${m.timestamp}] ${m.role === 'user' ? 'You' : 'Zeeshan from AMAL'}: ${m.content}`
      )
      .join('\n\n');

    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `AMAL-Zeeshan-WhatsApp-Chat-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleClearChat = (nameToUse?: string) => {
    stopSpeech();
    const effectiveName = (nameToUse !== undefined ? nameToUse : customerName).trim();
    const welcomeContent = effectiveName
      ? `Hi ${effectiveName}! 👋 Welcome to AMAL. How can I help you today?`
      : "Hi! 👋 I’m Zeeshan from AMAL.\n\nThanks for reaching out! 😊 I can help you explore our GCSE, IGCSE and Cambridge O-Level learning plans, weekly live tuition sessions, Topic Tests and Mock Exams.\n\nWhat can I help you with today?";

    setMessages([
      {
        id: 'welcome-reset',
        role: 'assistant',
        content: welcomeContent,
        timestamp: getCurrentTimeString(),
        compliance: {
          overallPass: true,
          score: 100,
          results: [],
        },
      },
    ]);
  };

  const formatMessageText = (raw: string) => {
    // Process markdown-like bold *bold* or **bold**
    const parts = raw.split('\n');
    return parts.map((paragraph, pIdx) => {
      // Replace bold markers
      const formatted = paragraph.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\*(.*?)\*/g, '<strong>$1</strong>');
      return (
        <span key={pIdx} className="block min-h-[1.25em]">
          <span dangerouslySetInnerHTML={{ __html: formatted }} />
        </span>
      );
    });
  };

  return (
    <div className="flex h-screen w-full bg-slate-950 text-slate-100 overflow-hidden">
      {/* Main Container */}
      <div className="flex-1 flex flex-col h-full relative">
        {/* Top Control Bar */}
        <header className="h-14 border-b border-slate-800 bg-slate-900/90 px-4 flex items-center justify-between shrink-0 z-20 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <h1 className="text-sm font-bold tracking-tight text-white flex items-center gap-1.5">
                AMALearning
                <span className="text-[11px] font-normal text-emerald-400 bg-emerald-950/60 border border-emerald-800/80 px-2 py-0.5 rounded-full">
                  Zeeshan • AMAL Assistant
                </span>
              </h1>
            </div>
          </div>

          {/* Quick Studio Navigation Buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setDrawerTab('scenarios');
                setDrawerOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-600/90 hover:bg-emerald-500 text-white rounded-lg transition shadow-sm"
              title="Test Scenarios"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Test Scenarios</span>
            </button>

            <button
              onClick={() => {
                setDrawerTab('plans');
                setDrawerOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition"
              title="Pricing & Plans"
            >
              <CreditCard className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Subscriptions</span>
            </button>

            <button
              onClick={() => {
                setDrawerTab('timetable');
                setDrawerOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition"
              title="GCSE Weekly Timetable"
            >
              <Calendar className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Timetable</span>
            </button>

            <button
              onClick={() => {
                setDrawerTab('prompt');
                setDrawerOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition"
              title="Master System Prompt"
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span className="hidden lg:inline">Master Prompt</span>
            </button>

            <div className="h-4 w-px bg-slate-800 mx-1" />

            {/* View Mode Switcher */}
            <div className="flex bg-slate-950 p-0.5 rounded-lg border border-slate-800">
              <button
                onClick={() => setViewMode('desktop')}
                className={`p-1.5 rounded-md transition ${
                  viewMode === 'desktop'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
                title="Desktop WhatsApp Web view"
              >
                <Monitor className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setViewMode('mobile')}
                className={`p-1.5 rounded-md transition ${
                  viewMode === 'mobile'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
                title="Mobile Phone mockup view"
              >
                <Smartphone className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Voice Read Aloud Toggle */}
            <button
              onClick={() => setTtsEnabled(!ttsEnabled)}
              className={`p-2 rounded-lg transition ${
                ttsEnabled
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                  : 'bg-slate-800 text-slate-400 hover:text-white'
              }`}
              title={ttsEnabled ? 'Voice Auto-read Enabled (British)' : 'Enable Voice Auto-read'}
            >
              {ttsEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>

            {/* Export */}
            <button
              onClick={handleExportChat}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition"
              title="Export WhatsApp Chat (.txt)"
            >
              <Download className="w-4 h-4" />
            </button>

            {/* Reset */}
            <button
              onClick={() => handleClearChat()}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition"
              title="Reset Conversation"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Chat Canvas Area */}
        <div className="flex-1 flex items-center justify-center p-0 sm:p-4 bg-slate-950 overflow-hidden">
          <div
            className={`flex flex-col bg-[#0b141a] shadow-2xl transition-all duration-300 overflow-hidden relative ${
              viewMode === 'mobile'
                ? 'w-full sm:max-w-md h-full sm:h-[88vh] sm:rounded-[2.5rem] border-0 sm:border-[8px] sm:border-slate-800 ring-1 ring-slate-700/50'
                : 'w-full h-full sm:rounded-2xl border border-slate-800'
            }`}
          >
            {/* Authentic WhatsApp Chat Header */}
            <div className="h-16 bg-[#202c33] px-4 flex items-center justify-between border-b border-[#2a3942] z-10 shrink-0">
              <div className="flex items-center gap-3">
                {/* Avatar with Verified Badge */}
                <div className="relative">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center font-bold text-white shadow-md text-sm tracking-wider">
                    AMAL
                  </div>
                  <div className="absolute -bottom-0.5 -right-0.5 bg-[#202c33] rounded-full p-0.5">
                    <div className="w-3.5 h-3.5 rounded-full bg-emerald-500 flex items-center justify-center text-[9px] text-white">
                      ✓
                    </div>
                  </div>
                </div>

                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-sm text-slate-100">
                      AMALearning Official
                    </span>
                    <span className="inline-flex items-center text-[10px] font-bold px-1.5 py-0.2 bg-emerald-500/20 text-emerald-300 rounded border border-emerald-500/30">
                      Verified
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
                    {isTyping ? (
                      <span className="text-emerald-400 font-medium animate-pulse">
                        typing...
                      </span>
                    ) : (
                      <span>
                        Zeeshan from AMAL • online
                        {customerName.trim() && (
                          <span className="text-emerald-300/90 font-medium ml-1">
                            (for {customerName.trim()})
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Header Right Actions */}
              <div className="flex items-center gap-2 text-slate-400">
                {/* Customer Name Setting Tag / Input */}
                <div className="hidden sm:flex items-center bg-[#111b21] border border-[#2a3942] rounded-lg px-2 py-1 text-xs">
                  <span className="text-slate-400 mr-1.5 text-[11px]">Customer:</span>
                  <input
                    type="text"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="e.g. Dilawar"
                    className="bg-transparent text-emerald-300 placeholder:text-slate-500 text-xs focus:outline-none w-20"
                    title="Customer name passed to assistant"
                  />
                  {customerName && (
                    <button
                      onClick={() => setCustomerName('')}
                      className="text-slate-500 hover:text-slate-300 ml-1 text-xs"
                      title="Clear customer name"
                    >
                      ×
                    </button>
                  )}
                </div>

                <button
                  onClick={() => setCallModalOpen(true)}
                  className="p-2 hover:text-slate-100 hover:bg-slate-700/40 rounded-full transition"
                  title="Voice Call Info"
                >
                  <Phone className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setCallModalOpen(true)}
                  className="p-2 hover:text-slate-100 hover:bg-slate-700/40 rounded-full transition"
                  title="Video Call Info"
                >
                  <Video className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    setDrawerTab('whatsapp');
                    setDrawerOpen(true);
                  }}
                  className="p-2 hover:text-slate-100 hover:bg-slate-700/40 rounded-full transition"
                  title="WhatsApp Integration Link"
                >
                  <ExternalLink className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Messages Body */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3.5 whatsapp-bg-pattern">
              {/* Security Advisory Pill */}
              <div className="flex justify-center my-1">
                <div className="max-w-md bg-[#182229]/90 border border-[#222e35] rounded-lg px-3 py-1.5 text-center shadow-sm">
                  <p className="text-[11px] text-amber-200/90 leading-tight flex items-center justify-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span>
                      Official AMAL AI WhatsApp Support. Privacy Policy updated 23 Sep 2025.
                    </span>
                  </p>
                </div>
              </div>

              {/* Date Pill */}
              <div className="flex justify-center my-2">
                <span className="bg-[#182229] text-[#8696a0] text-[10px] uppercase font-bold tracking-wider px-3 py-1 rounded-md shadow-sm border border-[#222e35]">
                  Today
                </span>
              </div>

              {/* Message bubbles */}
              {messages.map((msg) => {
                const isAssistant = msg.role === 'assistant';
                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${isAssistant ? 'items-start' : 'items-end'} group`}
                  >
                    <div
                      className={`relative max-w-[85%] sm:max-w-[75%] rounded-2xl px-3.5 py-2.5 shadow-md text-xs leading-relaxed transition-all ${
                        isAssistant
                          ? 'bg-[#202c33] text-slate-100 rounded-tl-sm border border-[#2a3942]'
                          : 'bg-[#005c4b] text-white rounded-tr-sm border border-[#02735e]'
                      }`}
                    >
                      {/* Message Content */}
                      <div className="space-y-1 break-words">
                        {formatMessageText(msg.content)}
                      </div>

                      {/* Footer: timestamp, audit pill, and tools */}
                      <div className="mt-1.5 pt-1 border-t border-slate-700/30 flex items-center justify-between gap-3 text-[10px] text-slate-400 select-none">
                        <div className="flex items-center gap-2">
                          {/* Compliance pill for assistant */}
                          {isAssistant && msg.compliance && (
                            <button
                              onClick={() => {
                                setInspectedMessage(msg);
                                setInspectModalOpen(true);
                              }}
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-950/60 hover:bg-emerald-900/60 text-emerald-400 border border-emerald-800/40 text-[9px] font-medium transition cursor-pointer"
                              title="Inspect Section 22 Compliance Audit"
                            >
                              <ShieldCheck className="w-2.5 h-2.5" />
                              {msg.compliance.score}% Audit
                            </button>
                          )}

                          {isAssistant && (
                            <button
                              onClick={() => handleSpeak(msg)}
                              className={`p-1 rounded hover:bg-slate-700/50 transition ${
                                activeSpeechId === msg.id ? 'text-emerald-400 font-bold' : 'text-slate-400'
                              }`}
                              title="Listen with British pronunciation"
                            >
                              <Volume2 className="w-3 h-3" />
                            </button>
                          )}

                          <button
                            onClick={() => handleCopyMessage(msg)}
                            className="p-1 rounded hover:bg-slate-700/50 text-slate-400 hover:text-slate-200 transition"
                            title="Copy text"
                          >
                            {copiedId === msg.id ? (
                              <Check className="w-3 h-3 text-emerald-400" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        </div>

                        <div className="flex items-center gap-1 ml-auto">
                          <span>{msg.timestamp}</span>
                          {!isAssistant && (
                            <CheckCheck className="w-3.5 h-3.5 text-[#53bdeb]" />
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Typing indicator */}
              {isTyping && (
                <div className="flex items-start">
                  <div className="bg-[#202c33] text-slate-300 rounded-2xl rounded-tl-sm px-4 py-3 shadow border border-[#2a3942] flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-bounce" />
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-bounce [animation-delay:0.2s]" />
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-bounce [animation-delay:0.4s]" />
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Quick Action Suggestion Chips (Context-Aware: Never show unrelated pricing after timetable query) */}
            <div className="bg-[#111b21] px-3 py-2 border-t border-[#202c33] overflow-x-auto flex gap-1.5 shrink-0 no-scrollbar">
              {(() => {
                const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');
                const lastAssistantMessage = [...messages].reverse().find((m) => m.role === 'assistant');
                const contextText = ((lastUserMessage?.content || '') + ' ' + (lastAssistantMessage?.content || '')).toLowerCase();

                // 1. If timetable / session query or response
                const isTimetableContext =
                  contextText.includes('timetable') ||
                  contextText.includes('schedule') ||
                  contextText.includes('session') ||
                  contextText.includes('friday') ||
                  contextText.includes('thursday') ||
                  contextText.includes('monday') ||
                  contextText.includes('wednesday') ||
                  contextText.includes('sunday') ||
                  contextText.includes('saturday') ||
                  contextText.includes('maths —') ||
                  contextText.includes('5:30');

                if (isTimetableContext) {
                  return [
                    { label: 'Weekly Sessions', prompt: 'What live tuition and revision sessions does AMAL offer each week?' },
                    { label: 'Friday Science', prompt: 'What Science sessions are available on Friday?' },
                    { label: 'What is LOTS?', prompt: 'What is LOTS?' },
                    { label: 'Booking Info', prompt: 'Can I book a session?' },
                    { label: 'Contact Support', prompt: 'How do I speak to someone from the team?' },
                  ].map((chip, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleSendMessage(chip.prompt)}
                      disabled={isTyping}
                      className="px-2.5 py-1 text-[11px] font-medium rounded-full bg-[#202c33] hover:bg-[#2a3942] text-slate-300 hover:text-white border border-[#2f3b43] transition shrink-0 whitespace-nowrap active:scale-95 disabled:opacity-50"
                    >
                      {chip.label}
                    </button>
                  ));
                }

                // 2. If school context
                const isSchoolContext = contextText.includes('school') || contextText.includes('licence') || contextText.includes('institution');
                if (isSchoolContext) {
                  return [
                    { label: 'School Monthly Plans', prompt: 'Do you provide access for schools?' },
                    { label: 'LOTS Add-on', prompt: 'What does the LOTS Add-on include for schools?' },
                    { label: 'Quotation Request', prompt: 'How can our school get a confirmed quotation?' },
                    { label: 'Contact Support', prompt: 'How do I speak to someone from the team?' },
                  ].map((chip, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleSendMessage(chip.prompt)}
                      disabled={isTyping}
                      className="px-2.5 py-1 text-[11px] font-medium rounded-full bg-[#202c33] hover:bg-[#2a3942] text-slate-300 hover:text-white border border-[#2f3b43] transition shrink-0 whitespace-nowrap active:scale-95 disabled:opacity-50"
                    >
                      {chip.label}
                    </button>
                  ));
                }

                // 3. If plan / pricing context
                const isPlanContext = contextText.includes('plan') || contextText.includes('price') || contextText.includes('cost') || contextText.includes('£');
                if (isPlanContext) {
                  return [
                    { label: 'Recommend for Child', prompt: 'Which plan do you recommend for my child?' },
                    { label: 'Basic Plan £70', prompt: 'How much is your Basic plan?' },
                    { label: 'App Only £10.99', prompt: 'Do you have a cheaper plan just for the app?' },
                    { label: 'What is LOTS?', prompt: 'What is LOTS?' },
                    { label: 'Contact Support', prompt: 'How do I speak to someone from the team?' },
                  ].map((chip, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleSendMessage(chip.prompt)}
                      disabled={isTyping}
                      className="px-2.5 py-1 text-[11px] font-medium rounded-full bg-[#202c33] hover:bg-[#2a3942] text-slate-300 hover:text-white border border-[#2f3b43] transition shrink-0 whitespace-nowrap active:scale-95 disabled:opacity-50"
                    >
                      {chip.label}
                    </button>
                  ));
                }

                // Default initial relevant chips
                return [
                  { label: 'Weekly Sessions', prompt: 'What live tuition and revision sessions does AMAL offer each week?' },
                  { label: 'What is LOTS?', prompt: 'What is LOTS?' },
                  { label: 'Recommend a Plan', prompt: 'Which plan do you recommend for my child?' },
                  { label: 'School Licences', prompt: 'Do you provide access for schools?' },
                  { label: 'Urdu / اردو', prompt: 'Kya aap weekly timetable bata saktay hain?' },
                  { label: 'Contact Support', prompt: 'How do I speak to someone from the team?' },
                ].map((chip, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSendMessage(chip.prompt)}
                    disabled={isTyping}
                    className="px-2.5 py-1 text-[11px] font-medium rounded-full bg-[#202c33] hover:bg-[#2a3942] text-slate-300 hover:text-white border border-[#2f3b43] transition shrink-0 whitespace-nowrap active:scale-95 disabled:opacity-50"
                  >
                    {chip.label}
                  </button>
                ));
              })()}
            </div>

            {/* Bottom Input Bar */}
            <div className="h-16 bg-[#202c33] px-3 py-2 flex items-center gap-2 border-t border-[#2a3942] shrink-0">
              <button
                type="button"
                onClick={() => setInputText((prev) => prev + ' 🙂 ')}
                className="p-2 text-slate-400 hover:text-slate-200 transition rounded-full hover:bg-slate-700/30"
                title="Add emoji"
              >
                <Smile className="w-5 h-5" />
              </button>

              <button
                type="button"
                onClick={() => {
                  setDrawerTab('scenarios');
                  setDrawerOpen(true);
                }}
                className="p-2 text-slate-400 hover:text-slate-200 transition rounded-full hover:bg-slate-700/30"
                title="Load test scenario"
              >
                <Paperclip className="w-5 h-5" />
              </button>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendMessage();
                }}
                className="flex-1 flex items-center gap-2"
              >
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder="Type a message (e.g. 'How much is Standard?')..."
                  className="w-full bg-[#2a3942] text-white text-xs placeholder-[#8696a0] rounded-xl px-4 py-2.5 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />

                {inputText.trim() ? (
                  <button
                    type="submit"
                    disabled={isTyping}
                    className="p-2.5 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white transition shrink-0 shadow disabled:opacity-50 active:scale-95"
                    title="Send message"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleSendMessage("Can you give me a summary of AMAL's learning features?")}
                    className="p-2.5 text-slate-400 hover:text-slate-200 transition rounded-full hover:bg-slate-700/30"
                    title="Voice note simulation"
                  >
                    <Mic className="w-4 h-4" />
                  </button>
                )}
              </form>
            </div>
          </div>
        </div>
      </div>

      {/* Compliance Quality Inspector Modal */}
      {inspectedMessage && inspectedMessage.compliance && (
        <QualityInspectorModal
          isOpen={inspectModalOpen}
          onClose={() => setInspectModalOpen(false)}
          results={inspectedMessage.compliance.results}
          score={inspectedMessage.compliance.score}
          messageText={inspectedMessage.content}
        />
      )}

      {/* Knowledge Base & Scenario Drawer */}
      <KnowledgeBaseDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        activeTab={drawerTab}
        setActiveTab={setDrawerTab}
        onSelectScenario={handleScenarioSelect}
      />

      {/* Phone Call Information Modal */}
      {callModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-400">
                <Phone className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-white text-sm">
                  Telephone & Voice Enquiries (Sec 13)
                </h3>
                <p className="text-xs text-slate-400">AMAL Team Escalation Protocol</p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed mb-4">
              According to AMAL's policy, arranging a phone call or speaking directly with a team member is recommended for:
            </p>

            <ul className="text-xs text-slate-300 space-y-2 mb-5 list-disc pl-4">
              <li>Significant school enquiries requiring custom contracts.</li>
              <li>Complex subscription, billing or payment dispute matters.</li>
              <li>Direct customer request for human assistance.</li>
            </ul>

            <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-300 space-y-1 mb-5">
              <div className="font-medium text-slate-400">Direct Human Support Contact:</div>
              <div className="font-mono text-emerald-400">support@amalearning.space</div>
              <div className="font-medium text-slate-400 mt-2">Official Website:</div>
              <a href="https://amalearning.space" target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">
                https://amalearning.space
              </a>
            </div>

            <button
              onClick={() => setCallModalOpen(false)}
              className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold transition"
            >
              Understood
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
