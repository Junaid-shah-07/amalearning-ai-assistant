import React, { useState, useEffect } from 'react';
import {
  X,
  CreditCard,
  Calendar,
  Sparkles,
  BookOpen,
  Share2,
  Copy,
  Check,
  Search,
  ExternalLink,
  Info,
  Clock,
  Shield,
  Send,
  School,
  UserCheck,
  RefreshCw,
  AlertCircle,
  CheckCircle2
} from 'lucide-react';
import {
  INDIVIDUAL_PLANS,
  SCHOOL_PLANS,
  WEEKLY_TIMETABLE,
  TEST_SCENARIOS,
  MASTER_SYSTEM_PROMPT,
  TestScenario
} from '../data/masterPrompt';

interface KnowledgeBaseDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: 'scenarios' | 'plans' | 'timetable' | 'prompt' | 'whatsapp';
  setActiveTab: (tab: 'scenarios' | 'plans' | 'timetable' | 'prompt' | 'whatsapp') => void;
  onSelectScenario: (scenario: TestScenario) => void;
  persona?: string;
}

export const KnowledgeBaseDrawer: React.FC<KnowledgeBaseDrawerProps> = ({
  isOpen,
  onClose,
  activeTab,
  setActiveTab,
  onSelectScenario,
  persona = 'Zeeshan',
}) => {
  const [promptSearch, setPromptSearch] = useState('');
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [waPhoneNumber, setWaPhoneNumber] = useState('');
  const [waCustomMessage, setWaCustomMessage] = useState(`Hi AMAL, I would like to enquire with ${persona} about GCSE preparation plans.`);

  useEffect(() => {
    setWaCustomMessage(`Hi AMAL, I would like to enquire with ${persona} about GCSE preparation plans.`);
  }, [persona]);
  const [planTypeView, setPlanTypeView] = useState<'individual' | 'school'>('individual');
  const [backendPlans, setBackendPlans] = useState<{
    individual: any[];
    school: any[];
    loading: boolean;
    error?: string;
    isCached?: boolean;
    source: 'live' | 'fallback';
  }>({
    individual: INDIVIDUAL_PLANS,
    school: SCHOOL_PLANS,
    loading: false,
    source: 'fallback',
  });

  const loadPlansFromBackend = async (forceRefresh = false) => {
    setBackendPlans((prev) => ({ ...prev, loading: true, error: undefined }));
    try {
      const res = await fetch(`/api/plans${forceRefresh ? '?refresh=true' : ''}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.success && data.plans) {
        setBackendPlans({
          individual: Array.isArray(data.plans.individual) ? data.plans.individual : [],
          school: Array.isArray(data.plans.school) ? data.plans.school : [],
          loading: false,
          isCached: data.isCached,
          source: 'live',
        });
      } else {
        throw new Error(data.error || 'Failed to retrieve plans');
      }
    } catch (err: any) {
      setBackendPlans((prev) => ({
        ...prev,
        loading: false,
        error: 'Current plan details are temporarily unavailable.',
      }));
    }
  };

  useEffect(() => {
    if (isOpen && activeTab === 'plans') {
      loadPlansFromBackend();
    }
  }, [isOpen, activeTab]);

  if (!isOpen) return null;

  const handleCopyPrompt = () => {
    navigator.clipboard.writeText(MASTER_SYSTEM_PROMPT);
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 2000);
  };

  const generateWhatsAppUrl = () => {
    const cleanNumber = waPhoneNumber.replace(/[^0-9]/g, '');
    const encoded = encodeURIComponent(waCustomMessage);
    if (cleanNumber) {
      return `https://wa.me/${cleanNumber}?text=${encoded}`;
    }
    return `https://api.whatsapp.com/send?text=${encoded}`;
  };

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-2xl bg-slate-900 border-l border-slate-800 shadow-2xl flex flex-col animate-slideLeft">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/80">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-emerald-400" />
            AMAL Knowledge & Test Studio
          </h2>
          <p className="text-xs text-slate-400">
            Verified reference database and test scenario runner
          </p>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
          aria-label="Close drawer"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Tabs navigation */}
      <div className="flex border-b border-slate-800 bg-slate-950/50 px-4 overflow-x-auto gap-1">
        <button
          onClick={() => setActiveTab('scenarios')}
          className={`flex items-center gap-2 px-3.5 py-3 text-xs font-medium border-b-2 transition shrink-0 ${
            activeTab === 'scenarios'
              ? 'border-emerald-400 text-emerald-300 bg-emerald-950/20'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Sparkles className="w-4 h-4" />
          Test Scenarios
        </button>
        <button
          onClick={() => setActiveTab('plans')}
          className={`flex items-center gap-2 px-3.5 py-3 text-xs font-medium border-b-2 transition shrink-0 ${
            activeTab === 'plans'
              ? 'border-emerald-400 text-emerald-300 bg-emerald-950/20'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <CreditCard className="w-4 h-4" />
          Subscriptions & Pricing
        </button>
        <button
          onClick={() => setActiveTab('timetable')}
          className={`flex items-center gap-2 px-3.5 py-3 text-xs font-medium border-b-2 transition shrink-0 ${
            activeTab === 'timetable'
              ? 'border-emerald-400 text-emerald-300 bg-emerald-950/20'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Calendar className="w-4 h-4" />
          GCSE Timetable
        </button>
        <button
          onClick={() => setActiveTab('prompt')}
          className={`flex items-center gap-2 px-3.5 py-3 text-xs font-medium border-b-2 transition shrink-0 ${
            activeTab === 'prompt'
              ? 'border-emerald-400 text-emerald-300 bg-emerald-950/20'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Shield className="w-4 h-4" />
          Master Prompt
        </button>
        <button
          onClick={() => setActiveTab('whatsapp')}
          className={`flex items-center gap-2 px-3.5 py-3 text-xs font-medium border-b-2 transition shrink-0 ${
            activeTab === 'whatsapp'
              ? 'border-emerald-400 text-emerald-300 bg-emerald-950/20'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Share2 className="w-4 h-4" />
          Deploy Link
        </button>
      </div>

      {/* Tab Contents */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* TAB 1: SCENARIOS */}
        {activeTab === 'scenarios' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-white">
                  Compliance Test Scenarios
                </h3>
                <p className="text-xs text-slate-400">
                  Select any persona to test the AI's adherence to the Master System Prompt.
                </p>
              </div>
            </div>

            <div className="grid gap-3">
              {TEST_SCENARIOS.map((sc) => (
                <div
                  key={sc.id}
                  className="bg-slate-950/70 border border-slate-800 hover:border-emerald-500/50 rounded-xl p-4 transition text-left group flex flex-col justify-between"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white group-hover:text-emerald-300 transition">
                        {sc.title}
                      </span>
                      <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                        {sc.category}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      {sc.description}
                    </p>
                    <div className="bg-slate-900/90 rounded-lg p-2.5 text-xs text-emerald-300/90 border border-slate-800 font-mono">
                      "{sc.initialMessage}"
                    </div>
                    <div className="text-[11px] text-slate-400">
                      <span className="text-slate-500 font-semibold">Checks:</span> {sc.expectedRuleTested}
                    </div>
                  </div>

                  <div className="mt-3.5 pt-3 border-t border-slate-800/80 flex justify-end">
                    <button
                      onClick={() => {
                        onSelectScenario(sc);
                        onClose();
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition shadow-sm"
                    >
                      <Send className="w-3.5 h-3.5" />
                      Run in Chat
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 2: PLANS */}
        {activeTab === 'plans' && (
          <div className="space-y-5">
            {/* Live API Header & Controls */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-slate-950/80 rounded-xl border border-slate-800">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-white">
                    Live AMALearning Plans
                  </h3>
                  <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium ${
                    backendPlans.source === 'live'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  }`}>
                    <CheckCircle2 className="w-3 h-3" />
                    {backendPlans.source === 'live' ? 'Live API Source' : 'Cached Baseline'}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Single source of truth fetched via backend Plans API
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => loadPlansFromBackend(true)}
                  disabled={backendPlans.loading}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 rounded-lg transition"
                  title="Force re-fetch from live API"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${backendPlans.loading ? 'animate-spin' : ''}`} />
                  Refresh
                </button>

                <div className="flex bg-slate-900 p-0.5 rounded-lg border border-slate-800 text-xs">
                  <button
                    onClick={() => setPlanTypeView('individual')}
                    className={`px-3 py-1 rounded-md font-medium transition ${
                      planTypeView === 'individual'
                        ? 'bg-emerald-500 text-slate-950 font-bold'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Individual
                  </button>
                  <button
                    onClick={() => setPlanTypeView('school')}
                    className={`px-3 py-1 rounded-md font-medium transition ${
                      planTypeView === 'school'
                        ? 'bg-emerald-500 text-slate-950 font-bold'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    School
                  </button>
                </div>
              </div>
            </div>

            {/* Error banner if live fetch failed */}
            {backendPlans.error && (
              <div className="p-3 bg-rose-950/40 border border-rose-900/60 rounded-xl text-xs text-rose-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{backendPlans.error}</span>
              </div>
            )}

            {/* Individual Plans Grid */}
            {planTypeView === 'individual' && (
              <div className="grid gap-3.5 sm:grid-cols-2">
                {backendPlans.individual.map((plan: any, idx: number) => {
                  const boardName = typeof plan.examBoard === 'object' ? plan.examBoard?.name : plan.examBoard;
                  const price = plan.monthlyPrice !== undefined ? `£${plan.monthlyPrice}` : plan.price || '£0';
                  const yearlyPrice = plan.yearlyPrice !== undefined ? `£${plan.yearlyPrice}/yr` : undefined;
                  const isHighlighted = plan.name?.toLowerCase().includes('standard');

                  // Extract features from live API or fallback object
                  let featureList: string[] = [];
                  if (Array.isArray(plan.features)) {
                    if (typeof plan.features[0] === 'string') {
                      featureList = plan.features;
                    } else {
                      featureList = plan.features.map((f: any) => {
                        const name = f.name?.replace(/_/g, ' ');
                        return f.limit !== undefined && f.limit > 0 ? `${f.limit} ${name}` : name;
                      });
                    }
                  }

                  return (
                    <div
                      key={plan._id || plan.id || idx}
                      className={`rounded-xl border p-4.5 flex flex-col justify-between transition ${
                        isHighlighted
                          ? 'bg-emerald-950/20 border-emerald-500/50 ring-1 ring-emerald-500/30'
                          : 'bg-slate-950/70 border-slate-800'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-bold text-white flex items-center gap-1.5">
                            <UserCheck className="w-4 h-4 text-emerald-400" />
                            {plan.name}
                          </span>
                          {boardName && (
                            <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                              {boardName}
                            </span>
                          )}
                        </div>
                        <div className="text-2xl font-extrabold text-emerald-400 flex items-baseline gap-2">
                          <span>{price}</span>
                          <span className="text-xs text-slate-400 font-normal">
                            /month {yearlyPrice && `(${yearlyPrice})`}
                          </span>
                        </div>
                        {plan.notes && (
                          <p className="text-xs text-slate-400 mt-2 mb-3 leading-relaxed">
                            {plan.notes}
                          </p>
                        )}
                        {featureList.length > 0 && (
                          <ul className="space-y-1.5 text-xs text-slate-300 border-t border-slate-800/80 pt-3 mt-2">
                            {featureList.map((f, fIdx) => (
                              <li key={fIdx} className="flex items-start gap-2">
                                <span className="text-emerald-400 mt-0.5">•</span>
                                <span className="capitalize">{f}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* School Plans Grid */}
            {planTypeView === 'school' && (
              <div className="space-y-3.5">
                <div className="p-3.5 bg-amber-950/30 border border-amber-900/60 rounded-xl text-xs text-amber-200">
                  <p className="font-semibold text-amber-300 mb-1 flex items-center gap-1.5">
                    <Info className="w-4 h-4" />
                    School Pricing Policy:
                  </p>
                  <p className="text-[11px] leading-relaxed text-amber-200/90">
                    School plans are not published as fixed online packages. Bespoke quotations, cohort licensing, and student quotas are confirmed directly by the AMAL team at <strong className="text-amber-100">support@amalearning.space</strong>.
                  </p>
                </div>

                {backendPlans.school.length === 0 ? (
                  <div className="p-6 bg-slate-950/60 border border-slate-800 rounded-xl text-center space-y-2">
                    <School className="w-8 h-8 text-cyan-400 mx-auto opacity-80" />
                    <h4 className="text-sm font-bold text-white">No Public School Plans Listed</h4>
                    <p className="text-xs text-slate-400 max-w-md mx-auto">
                      AMAL provides custom school and institutional quotations based on student numbers and subject requirements. Contact us directly at <span className="text-emerald-400 font-medium">support@amalearning.space</span>.
                    </p>
                  </div>
                ) : (
                  <div className="grid gap-3.5 sm:grid-cols-2">
                    {backendPlans.school.map((plan: any, idx: number) => (
                      <div
                        key={plan._id || plan.id || idx}
                        className="bg-slate-950/70 border border-slate-800 rounded-xl p-4.5 flex flex-col justify-between"
                      >
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-bold text-white flex items-center gap-1.5">
                              <School className="w-4 h-4 text-cyan-400" />
                              {plan.name}
                            </span>
                          </div>
                          <div className="text-2xl font-extrabold text-cyan-400">
                            {plan.monthlyPrice !== undefined ? `£${plan.monthlyPrice}` : plan.price}
                            <span className="text-xs text-slate-400 font-normal ml-1">
                              /month
                            </span>
                          </div>
                          {plan.notes && (
                            <p className="text-xs text-slate-400 mt-2 mb-3 leading-relaxed">
                              {plan.notes}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: TIMETABLE */}
        {activeTab === 'timetable' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-white">
                  Verified GCSE Weekly Timetable
                </h3>
                <p className="text-xs text-slate-400">
                  Published session schedule (Master Prompt Sec 7)
                </p>
              </div>
            </div>

            <div className="p-3.5 bg-amber-950/30 border border-amber-900/60 rounded-xl text-xs text-amber-200">
              <p className="font-semibold text-amber-300 mb-1 flex items-center gap-1.5">
                <Clock className="w-4 h-4" />
                Timezone Policy Rule:
              </p>
              <p className="text-[11px] leading-relaxed text-amber-200/90">
                The supplied timetable does not specify a timezone. Never assume GMT, BST, or UK local time. Always note this when customers enquire, and refer to <strong className="text-amber-100">support@amalearning.space</strong> for attendance & links.
              </p>
            </div>

            <div className="space-y-2">
              {WEEKLY_TIMETABLE.map((item, idx) => (
                <div
                  key={idx}
                  className="bg-slate-950/70 border border-slate-800 rounded-xl p-3.5 flex items-center justify-between text-xs hover:border-slate-700 transition"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-20 font-bold text-emerald-400">
                      {item.day}
                    </div>
                    <div>
                      <div className="font-semibold text-white">
                        {item.title}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {item.level} • {item.type}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="font-mono text-xs px-2.5 py-1 rounded-md bg-slate-800 text-slate-200 border border-slate-700">
                      {item.time}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 4: MASTER PROMPT */}
        {activeTab === 'prompt' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-white">
                  Full Master System Prompt
                </h3>
                <p className="text-xs text-slate-400">
                  25 sections governing AI assistant behaviour
                </p>
              </div>
              <button
                onClick={handleCopyPrompt}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition"
              >
                {copiedPrompt ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    Copy All
                  </>
                )}
              </button>
            </div>

            {/* Search filter */}
            <div className="relative">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search prompt sections (e.g. 'safeguarding', 'Urdu', '£70')..."
                value={promptSearch}
                onChange={(e) => setPromptSearch(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-4 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-4 max-h-[500px] overflow-y-auto font-mono text-[11px] text-slate-300 leading-relaxed whitespace-pre-wrap select-text">
              {promptSearch
                ? MASTER_SYSTEM_PROMPT.split('\n\n')
                    .filter((p) => p.toLowerCase().includes(promptSearch.toLowerCase()))
                    .join('\n\n---\n\n')
                : MASTER_SYSTEM_PROMPT}
            </div>
          </div>
        )}

        {/* TAB 5: WHATSAPP DEPLOY LINK */}
        {activeTab === 'whatsapp' && (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-white">
                Launch in Real WhatsApp App
              </h3>
              <p className="text-xs text-slate-400">
                Generate an instant WhatsApp click-to-chat link with pre-filled enquiry text.
              </p>
            </div>

            <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4.5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Optional Phone Number (with country code):
                </label>
                <input
                  type="text"
                  placeholder="e.g. 447123456789"
                  value={waPhoneNumber}
                  onChange={(e) => setWaPhoneNumber(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
                <p className="text-[10px] text-slate-500 mt-1">
                  Leave blank to open a general WhatsApp share dialog with prefilled text.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Prefilled Message:
                </label>
                <textarea
                  rows={3}
                  value={waCustomMessage}
                  onChange={(e) => setWaCustomMessage(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="pt-2 flex flex-col sm:flex-row gap-2">
                <a
                  href={generateWhatsAppUrl()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition shadow-lg shadow-emerald-950/40"
                >
                  <Share2 className="w-4 h-4" />
                  Open in WhatsApp Web / App
                  <ExternalLink className="w-3.5 h-3.5 opacity-75" />
                </a>

                <button
                  onClick={() => {
                    navigator.clipboard.writeText(generateWhatsAppUrl());
                    setCopiedLink(true);
                    setTimeout(() => setCopiedLink(false), 2000);
                  }}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition inline-flex items-center gap-1.5"
                >
                  {copiedLink ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      Link Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      Copy Link
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Official Contact Directory */}
            <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4.5 space-y-2 text-xs">
              <h4 className="font-semibold text-white">Official AMAL Reference Directory</h4>
              <div className="grid gap-2 text-slate-300">
                <div className="flex justify-between py-1 border-b border-slate-800/80">
                  <span className="text-slate-400">General Support & Timetable:</span>
                  <a href="mailto:support@amalearning.space" className="text-emerald-400 hover:underline">support@amalearning.space</a>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-800/80">
                  <span className="text-slate-400">Privacy & Data Requests:</span>
                  <a href="mailto:privacy@amalearning.space" className="text-emerald-400 hover:underline">privacy@amalearning.space</a>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-slate-400">Official Website:</span>
                  <a href="https://amalearning.space" target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">https://amalearning.space</a>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
