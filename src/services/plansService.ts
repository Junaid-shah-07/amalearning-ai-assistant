/**
 * AMALearning Plans Service
 * Single source of truth for individual and school subscription plans.
 * Fetches from the live AMALearning public API with in-memory caching.
 */

export interface ApiFeature {
  _id?: string;
  name: string;
  limit: number;
}

export interface ApiIconDes {
  id: string;
  Text: string;
  trialText?: string;
  limit?: number;
  freeTrialLimit?: number;
}

export interface ApiExamBoard {
  _id?: string;
  name: string;
}

export interface ApiPlan {
  _id: string;
  name: string;
  examBoard?: ApiExamBoard | string;
  classId?: string;
  subjects?: string[];
  monthlyPrice: number;
  yearlyPrice: number;
  features?: ApiFeature[];
  description?: string;
  isActive: boolean;
  category: string; // 'student' | 'school' | etc.
  freeTrialDuration?: number;
  isTestPlan?: boolean;
  iconDes?: ApiIconDes[];
  allowedCouponCode?: boolean;
  discountedPercentage?: number;
  discountedPlan?: any;
}

export interface PlansApiResponse {
  statusCode: number;
  data: {
    plans: ApiPlan[];
  };
  message: string;
  success: boolean;
}

export interface FetchPlansResult {
  success: boolean;
  plans: ApiPlan[];
  error?: string;
  isCached: boolean;
  fetchedAt: number;
}

const INDIVIDUAL_PLANS_URL = 'https://api.amalearning.space/api/v1/plan/get/public/all';
const SCHOOL_PLANS_URL = 'https://api.amalearning.space/api/v1/plan/get/public/all?category=school';

// Configurable cache TTL: defaults to 5 minutes (300,000 ms)
const CACHE_TTL_MS = parseInt(process.env.PLANS_CACHE_TTL_MS || '300000', 10);

interface CacheEntry {
  data: ApiPlan[];
  timestamp: number;
}

const cache: {
  individual?: CacheEntry;
  school?: CacheEntry;
} = {};

// Test override mocks for simulating API failure, empty responses, or price updates
let mockOverride: {
  individual?: { plans: ApiPlan[] | null; error?: string };
  school?: { plans: ApiPlan[] | null; error?: string };
} | null = null;

export function setMockOverride(
  category: 'individual' | 'school',
  plans: ApiPlan[] | null,
  error?: string
) {
  if (!mockOverride) mockOverride = {};
  mockOverride[category] = { plans, error };
}

export function clearMockOverride() {
  mockOverride = null;
}

export function clearPlansCache() {
  delete cache.individual;
  delete cache.school;
}

/**
 * Fetch plans from the live AMALearning API with in-memory caching
 */
export async function fetchPlansFromApi(
  category: 'individual' | 'school',
  options: { forceRefresh?: boolean; timeoutMs?: number } = {}
): Promise<FetchPlansResult> {
  const { forceRefresh = false, timeoutMs = 8000 } = options;
  const now = Date.now();

  // Check if mock override is active (for testing errors, empty states, etc.)
  if (mockOverride && mockOverride[category]) {
    const mock = mockOverride[category]!;
    if (mock.error) {
      return {
        success: false,
        plans: [],
        error: mock.error,
        isCached: false,
        fetchedAt: now,
      };
    }
    return {
      success: true,
      plans: mock.plans || [],
      isCached: false,
      fetchedAt: now,
    };
  }

  // Check cache freshness
  const cached = cache[category];
  if (!forceRefresh && cached && now - cached.timestamp < CACHE_TTL_MS) {
    return {
      success: true,
      plans: cached.data,
      isCached: true,
      fetchedAt: cached.timestamp,
    };
  }

  const endpoint = category === 'school' ? SCHOOL_PLANS_URL : INDIVIDUAL_PLANS_URL;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(endpoint, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    });

    clearTimeout(timer);

    if (!response.ok) {
      throw new Error(`API returned HTTP ${response.status}: ${response.statusText}`);
    }

    const json = (await response.json()) as PlansApiResponse;

    if (!json.success || !json.data || !Array.isArray(json.data.plans)) {
      throw new Error(`Malformed plans response: ${json.message || 'invalid data structure'}`);
    }

    const plans = json.data.plans.filter((p) => p.isActive !== false);

    // Update in-memory cache
    cache[category] = {
      data: plans,
      timestamp: now,
    };

    return {
      success: true,
      plans,
      isCached: false,
      fetchedAt: now,
    };
  } catch (err: any) {
    console.error(`Failed to fetch ${category} plans from ${endpoint}:`, err?.message || err);

    return {
      success: false,
      plans: [],
      error: err?.message || 'Failed to fetch live plans',
      isCached: false,
      fetchedAt: now,
    };
  }
}

/**
 * Standard unavailable message when live API cannot be retrieved
 */
export const PLANS_UNAVAILABLE_MESSAGE =
  'Current plan details and pricing are temporarily unavailable right now. Please check back shortly or contact our team directly at support@amalearning.space for the latest plan information.';

/**
 * Standard message when school plans are empty in the API
 */
export const SCHOOL_PLANS_EMPTY_MESSAGE =
  'Currently, specific school plan packages and prices are not published online. For school licences, custom student quotas, and bespoke quotations, please contact our team directly at support@amalearning.space.\n\nHow many students or year groups are you looking to support?';

/**
 * Safely extracts the exam board name from an ApiPlan object without assuming schema layout.
 */
export function getPlanExamBoardName(plan: ApiPlan): string {
  if (!plan) return '';
  if (typeof plan.examBoard === 'string' && plan.examBoard.trim()) {
    return plan.examBoard.trim();
  }
  if (plan.examBoard && typeof plan.examBoard === 'object' && typeof plan.examBoard.name === 'string') {
    return plan.examBoard.name.trim();
  }
  const name = plan.name || '';
  if (/\bAQA\b/i.test(name)) return 'AQA';
  if (/\bEdexcel\b/i.test(name)) return 'Edexcel';
  if (/\bCambridge\b/i.test(name) || /\bCIE\b/i.test(name)) return 'Cambridge';
  if (/\bOCR\b/i.test(name)) return 'OCR';
  return '';
}

/**
 * Checks if an ApiPlan matches a requested exam board filter.
 */
export function planMatchesBoard(plan: ApiPlan, targetBoard?: string): boolean {
  if (!targetBoard || !targetBoard.trim()) return true;
  const boardNorm = targetBoard.toLowerCase().trim();
  const detectedBoard = getPlanExamBoardName(plan).toLowerCase();
  const name = (plan.name || '').toLowerCase();
  return detectedBoard.includes(boardNorm) || name.includes(boardNorm);
}

/**
 * Helper to extract feature limits
 */
export function getFeatureLimit(plan: ApiPlan, featureName: string): number | null {
  if (!plan.features || !Array.isArray(plan.features)) return null;
  const feat = plan.features.find(
    (f) => f.name.toLowerCase() === featureName.toLowerCase() || f.name.toLowerCase().includes(featureName.toLowerCase())
  );
  return feat ? feat.limit : null;
}

/**
 * Finds all plans matching a specific tier keyword ('basic', 'standard', 'premium', 'app-only'),
 * optionally filtered by exam board ('aqa', 'edexcel', etc.).
 */
export function findPlansByTier(
  plans: ApiPlan[],
  tier: 'basic' | 'standard' | 'premium' | 'app-only',
  boardFilter?: string
): ApiPlan[] {
  if (!plans || !Array.isArray(plans)) return [];

  const tierMatches = plans.filter((p) => {
    const name = (p.name || '').toLowerCase();
    switch (tier) {
      case 'app-only':
        return name.includes('app-only') || name.includes('app only');
      case 'basic':
        return name.includes('basic');
      case 'standard':
        return name.includes('standard');
      case 'premium':
        return name.includes('premium');
      default:
        return false;
    }
  });

  if (!boardFilter) {
    return tierMatches;
  }

  const filtered = tierMatches.filter((p) => planMatchesBoard(p, boardFilter));
  return filtered.length > 0 ? filtered : tierMatches;
}

/**
 * Find plan by matching keyword in name (e.g. 'basic', 'standard', 'premium', 'app-only')
 */
export function findPlanByKeyword(plans: ApiPlan[], keyword: string, boardFilter?: string): ApiPlan | undefined {
  const kw = keyword.toLowerCase();
  const candidates = plans.filter((p) => {
    const name = (p.name || '').toLowerCase();
    return name.includes(kw);
  });

  if (candidates.length === 0) return undefined;
  if (!boardFilter) {
    // If multiple candidates exist, prefer one with non-zero LOTS (like AQA basic) over zero LOTS unless specified
    const withLots = candidates.find((p) => {
      const lots = getFeatureLimit(p, 'lots');
      return lots !== null && lots > 0;
    });
    return withLots || candidates[0];
  }

  const matched = candidates.find((p) => planMatchesBoard(p, boardFilter));
  return matched || candidates[0];
}

/**
 * Summarizes the verified feature limits for an individual plan.
 * Never invents limits or assumes boards have equivalent features.
 */
export function formatPlanLimits(plan: ApiPlan): string {
  const lots = getFeatureLimit(plan, 'lots');
  const mocks = getFeatureLimit(plan, 'mock');
  const tests = getFeatureLimit(plan, 'topic');

  const parts: string[] = [];
  if (lots !== null) {
    parts.push(lots > 0 ? `${lots} LOTS live tuition lessons` : `no included live tuition lessons`);
  }
  if (tests !== null && tests > 0) {
    parts.push(`${tests} Topic Tests`);
  }
  if (mocks !== null) {
    parts.push(mocks > 0 ? `${mocks} Mock Exams` : `no included Mock Exams`);
  }

  return parts.length > 0 ? parts.join(', ') : 'full app access with core learning resources';
}

/**
 * Formats individual plans for chatbot responses based strictly on live API data
 */
export function formatIndividualPlansOverview(plans: ApiPlan[], boardFilter?: string): string {
  if (!plans || plans.length === 0) {
    return PLANS_UNAVAILABLE_MESSAGE;
  }

  const effectivePlans = boardFilter
    ? plans.filter((p) => planMatchesBoard(p, boardFilter))
    : plans;

  if (effectivePlans.length === 0) {
    return PLANS_UNAVAILABLE_MESSAGE;
  }

  // Find canonical packages from live data
  const appOnly = findPlanByKeyword(effectivePlans, 'app', boardFilter);
  const basic = findPlanByKeyword(effectivePlans, 'basic', boardFilter);
  const standard = findPlanByKeyword(effectivePlans, 'standard', boardFilter);
  const premium = findPlanByKeyword(effectivePlans, 'premium', boardFilter);

  const lines: string[] = ['We have several individual monthly options from our live plans:'];

  if (appOnly) {
    lines.push(`• ${appOnly.name.trim()} — £${appOnly.monthlyPrice}/mo (£${appOnly.yearlyPrice}/yr): app access only`);
  }
  if (basic) {
    const limits = formatPlanLimits(basic);
    lines.push(`• ${basic.name.trim()} — £${basic.monthlyPrice}/mo (£${basic.yearlyPrice}/yr): ${limits}`);
  }
  if (standard) {
    const limits = formatPlanLimits(standard);
    lines.push(`• ${standard.name.trim()} — £${standard.monthlyPrice}/mo (£${standard.yearlyPrice}/yr): ${limits}`);
  }
  if (premium) {
    const limits = formatPlanLimits(premium);
    lines.push(`• ${premium.name.trim()} — £${premium.monthlyPrice}/mo (£${premium.yearlyPrice}/yr): ${limits}`);
  }

  lines.push('\nAll include full app access, Maths/TSP and Combined & Triple Science. Would you like a recommendation based on what you need?');
  return lines.join('\n');
}

/**
 * Formats parent plan recommendation based on live API data
 */
export function formatParentRecommendation(plans: ApiPlan[], boardFilter?: string): string {
  if (!plans || plans.length === 0) {
    return PLANS_UNAVAILABLE_MESSAGE;
  }

  const appOnly = findPlanByKeyword(plans, 'app', boardFilter);
  const basic = findPlanByKeyword(plans, 'basic', boardFilter);
  const standard = findPlanByKeyword(plans, 'standard', boardFilter);
  const premium = findPlanByKeyword(plans, 'premium', boardFilter);

  if (!basic || !standard || !premium || !appOnly) {
    return PLANS_UNAVAILABLE_MESSAGE;
  }

  const basicPrice = `£${basic.monthlyPrice} per month`;
  const basicLimits = formatPlanLimits(basic);
  const basicDetails = basicLimits === 'full app access with core learning resources'
    ? 'includes full AMAL app access, Maths/TSP, Combined and Triple Science.'
    : `includes full AMAL app access, Maths/TSP, Combined and Triple Science, with ${basicLimits}.`;

  const standardPrice = `£${standard.monthlyPrice} per month`;
  const standardLimits = formatPlanLimits(standard);
  const standardDetails = standardLimits === 'full app access with core learning resources'
    ? 'includes the same core subjects.'
    : `includes the same core subjects, with ${standardLimits}.`;

  const premiumPrice = `£${premium.monthlyPrice} per month`;
  const premiumLimits = formatPlanLimits(premium);
  const premiumDetails = premiumLimits === 'full app access with core learning resources'
    ? 'includes full AMAL app access, Maths/TSP, Combined and Triple Science.'
    : `includes ${premiumLimits}.`;

  const appOnlyPrice = `£${appOnly.monthlyPrice} per month`;

  return `It depends on whether your child needs live teaching or independent revision.

Our individual monthly plans with live tuition are:
• Basic (${basicPrice}): ${basicDetails}
• Standard (${standardPrice}): ${standardDetails}
• Premium (${premiumPrice}): ${premiumDetails}

If they only need independent revision and practice, App-Only is ${appOnlyPrice}.

Is your child mainly looking for live tuition, or would independent revision be more suitable?`;
}

/**
 * Formats single plan enquiry (Basic, Standard, Premium, App-only) strictly from live data.
 * If user does not specify a board and multiple board packages exist (e.g. AQA and Edexcel),
 * it disambiguates honestly without confusing features or inventing data.
 */
export function formatSinglePlanResponse(
  keyword: 'basic' | 'standard' | 'premium' | 'app-only',
  plans: ApiPlan[],
  boardFilter?: string
): string {
  if (!plans || plans.length === 0) {
    return PLANS_UNAVAILABLE_MESSAGE;
  }

  const matches = findPlansByTier(plans, keyword, boardFilter);
  if (matches.length === 0) {
    return PLANS_UNAVAILABLE_MESSAGE;
  }

  // If a specific board was requested or only one plan matched
  if (boardFilter || matches.length === 1) {
    const plan = matches[0];
    const limits = formatPlanLimits(plan);
    const boardName = getPlanExamBoardName(plan);
    const boardPrefix = boardName ? ` (${boardName})` : '';

    if (keyword === 'app-only') {
      return `Yes, our ${plan.name.trim()}${boardPrefix} is £${plan.monthlyPrice} per month (or £${plan.yearlyPrice}/year). It includes AMAL app access for GCSE preparation, Maths/TSP and Combined and Triple Science, but does not include live tuition lessons (LOTS) or Mock Exams.`;
    }

    return `${plan.name.trim()}${boardPrefix} is £${plan.monthlyPrice} per month (or £${plan.yearlyPrice}/year). It includes full AMAL app access, Maths/TSP, Combined and Triple Science, with ${limits}.`;
  }

  // If multiple plans match across different exam boards (e.g. AQA and Edexcel in live API)
  const lines: string[] = [`Our live ${keyword.charAt(0).toUpperCase() + keyword.slice(1)} plan options are:`];
  for (const plan of matches) {
    const boardName = getPlanExamBoardName(plan) || 'General';
    const limits = formatPlanLimits(plan);
    lines.push(`• ${plan.name.trim()} (${boardName}): £${plan.monthlyPrice} per month (or £${plan.yearlyPrice}/year) — includes ${limits}.`);
  }
  lines.push('\nWhich exam board (e.g. AQA or Edexcel) is your child preparing for?');
  return lines.join('\n');
}

/**
 * Formats multiple requested plan tiers (e.g. Basic and Standard) in a single response,
 * ensuring both plans are clearly presented with monthly and yearly prices without truncation.
 */
export function formatMultiPlanResponse(
  tiers: ('basic' | 'standard' | 'premium' | 'app-only')[],
  plans: ApiPlan[],
  boardFilter?: string
): string {
  if (!plans || plans.length === 0) {
    return PLANS_UNAVAILABLE_MESSAGE;
  }

  const lines: string[] = ['Here are the current plan details from our live system:'];
  let foundAny = false;

  for (const tier of tiers) {
    const matched = findPlanByKeyword(plans, tier, boardFilter);
    if (matched) {
      foundAny = true;
      const limits = formatPlanLimits(matched);
      const boardName = getPlanExamBoardName(matched);
      const boardTag = boardName ? ` [${boardName}]` : '';
      lines.push(
        `• ${matched.name.trim()}${boardTag}: £${matched.monthlyPrice} per month (or £${matched.yearlyPrice}/year) — ${limits}`
      );
    }
  }

  if (!foundAny) {
    return PLANS_UNAVAILABLE_MESSAGE;
  }

  lines.push('\nAll plans include full app access for GCSE, IGCSE and Cambridge O-Level. Would you like to know more about either option?');
  return lines.join('\n');
}

/**
 * Formats school plans response based on live school API endpoint
 */
export function formatSchoolPlansResponse(schoolPlans: ApiPlan[]): string {
  if (!schoolPlans || schoolPlans.length === 0) {
    return SCHOOL_PLANS_EMPTY_MESSAGE;
  }

  const lines: string[] = ['For schools, we offer the following published plans from our live system:'];
  for (const plan of schoolPlans) {
    lines.push(`• ${plan.name}: £${plan.monthlyPrice} per month${plan.description ? ` — ${plan.description.replace(/<[^>]+>/g, ' ').trim()}` : ''}`);
  }
  lines.push('\nPlease note that quotations for schools are confirmed directly by the AMAL team at support@amalearning.space.\n\nHow many students or year groups are you looking to support?');
  return lines.join('\n');
}

/**
 * Formats comparison between individual and school plans derived dynamically from live API data
 */
export function formatComparePlansResponse(individualPlans: ApiPlan[], schoolPlans: ApiPlan[]): string {
  if ((!individualPlans || individualPlans.length === 0) && (!schoolPlans || schoolPlans.length === 0)) {
    return PLANS_UNAVAILABLE_MESSAGE;
  }

  let individualSection = 'Individual plans: temporarily unavailable right now.';
  if (individualPlans && individualPlans.length > 0) {
    const lines: string[] = ['Individual Monthly Plans (from live API):'];
    const appOnly = findPlanByKeyword(individualPlans, 'app');
    const basic = findPlanByKeyword(individualPlans, 'basic');
    const standard = findPlanByKeyword(individualPlans, 'standard');
    const premium = findPlanByKeyword(individualPlans, 'premium');

    if (appOnly) {
      lines.push(`• ${appOnly.name.trim()}: £${appOnly.monthlyPrice}/mo (£${appOnly.yearlyPrice}/yr)`);
    }
    if (basic) {
      const limits = formatPlanLimits(basic);
      lines.push(`• ${basic.name.trim()}: £${basic.monthlyPrice}/mo (£${basic.yearlyPrice}/yr) (${limits})`);
    }
    if (standard) {
      const limits = formatPlanLimits(standard);
      lines.push(`• ${standard.name.trim()}: £${standard.monthlyPrice}/mo (£${standard.yearlyPrice}/yr) (${limits})`);
    }
    if (premium) {
      const limits = formatPlanLimits(premium);
      lines.push(`• ${premium.name.trim()}: £${premium.monthlyPrice}/mo (£${premium.yearlyPrice}/yr) (${limits})`);
    }
    individualSection = lines.join('\n');
  }

  const schoolSection = schoolPlans && schoolPlans.length > 0
    ? `School Plans (from live API):\n${schoolPlans.map((p) => `• ${p.name}: £${p.monthlyPrice}/mo`).join('\n')}`
    : 'School Plans:\nSpecific packages are not published online; bespoke quotations are confirmed by our team at support@amalearning.space.';

  return `We have distinct options for individuals and schools:

${individualSection}

${schoolSection}

Are you enquiring on behalf of a school or for an individual student?`;
}
