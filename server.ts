import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import { MASTER_SYSTEM_PROMPT } from './src/data/masterPrompt.js';
import { isRequestAuthorized } from './src/utils/auth.js';
import { createRateLimitMiddleware } from './src/utils/rateLimiter.js';
import {
  fetchPlansFromApi,
  formatIndividualPlansOverview,
  formatParentRecommendation,
  formatSinglePlanResponse,
  formatMultiPlanResponse,
  formatSchoolPlansResponse,
  formatComparePlansResponse,
  formatPlanLimits,
  getPlanExamBoardName,
  PLANS_UNAVAILABLE_MESSAGE,
  SCHOOL_PLANS_EMPTY_MESSAGE,
  getFeatureLimit,
  ApiPlan,
  findPlanByKeyword,
} from './src/services/plansService.js';
import { executeGeminiWithRetry, sanitizeErrorMessage } from './src/utils/geminiRetry.js';
import { GEMINI_MODEL, GEMINI_TEMPERATURE } from './src/config/geminiConfig.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  const isProd = process.env.NODE_ENV === 'production';
  const n8nApiKey = process.env.N8N_API_KEY || '';

  app.use(express.json());

  // Capture malformed JSON payloads and return a structured HTTP 400 Bad Request
  app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err instanceof SyntaxError && (err as any).status === 400 && 'body' in err) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid JSON payload format.',
      });
    }
    next(err);
  });

  // Rate limiter for chat endpoint: 60 requests per minute per IP / API key
  const chatRateLimiter = createRateLimitMiddleware({
    windowMs: 60000,
    max: 60,
  });

  // Rate limiter for public info endpoint: 120 requests per minute per IP / API key
  const infoRateLimiter = createRateLimitMiddleware({
    windowMs: 60000,
    max: 120,
  });

  // Rate limiter for plans endpoint: 60 requests per minute per IP / API key
  const plansRateLimiter = createRateLimitMiddleware({
    windowMs: 60000,
    max: 60,
  });

  // Initialize Gemini Client
  const apiKey = process.env.GEMINI_API_KEY || '';
  const ai = apiKey
    ? new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      })
    : null;

  // Rule-based fallback response engine strictly following live Plans API and Master System Prompt
  function generateFallbackResponse(
    userPrompt: string,
    history: Array<{ role: string; content: string }>,
    customerName?: string,
    livePlansData?: {
      individual: ApiPlan[];
      school: ApiPlan[];
      individualError?: string;
      schoolError?: string;
    }
  ): string {
    const text = userPrompt.toLowerCase().trim();

    // Extract name if passed or introduced in conversation (e.g. "Hi, I am Dilawar", "My name is Dilawar")
    let detectedName = customerName?.trim() || '';
    if (!detectedName) {
      const nameMatch = userPrompt.match(/(?:i am|i'm|my name is|this is)\s+([A-Z][a-zA-Z]{1,20})\b/i);
      if (nameMatch && !['a', 'an', 'the', 'interested', 'looking', 'asking', 'student', 'parent', 'teacher'].includes(nameMatch[1].toLowerCase())) {
        detectedName = nameMatch[1];
      }
    }

    // 1. Urdu / Roman Urdu detection
    if (
      (text.includes('kya') || text.includes('kia') || text.includes('urdu') || text.includes('bata')) &&
      (text.includes('timetable') || text.includes('classes') || text.includes('schedule') || text.includes('timing') || text.includes('waqt'))
    ) {
      return "AMAL ka verified weekly timetable yeh hai:\n\n• Monday, 5:30–6:30 PM: Maths — Grades 4–6\n• Wednesday, 5:30–6:30 PM: Science Support Drop-in / Revision Classes\n• Thursday, 5:30–6:30 PM: Maths — Grades 7–9\n• Friday, 5:30–6:30 PM: AQA Science Paper 1\n• Friday, 6:30–7:30 PM: AQA Science Paper 2\n• Saturday: Mock Exams — din mein kisi bhi waqt available hain\n• Sunday, 10:30–11:30 AM: Edexcel Science Paper 1\n• Sunday, 11:30 AM–12:30 PM: Edexcel Science Paper 2\n\nTimetable mein timezone confirmed nahi hai, mazeed maloomat ke liye hamari team support@amalearning.space par rabta kar sakti hai. Aapka bacha kis subject ya exam board ki tayari kar raha hai?";
    }

    if (text.includes('kya') || text.includes('kia') || text.includes('tayari') || text.includes('karwatay') || text.includes('fees') || text.includes('kitni') || text.includes('urdu')) {
      if (livePlansData?.individualError || !livePlansData?.individual || livePlansData.individual.length === 0) {
        return PLANS_UNAVAILABLE_MESSAGE;
      }
      const basicPlan = findPlanByKeyword(livePlansData.individual, 'basic');
      if (!basicPlan) {
        return PLANS_UNAVAILABLE_MESSAGE;
      }
      const lots = getFeatureLimit(basicPlan, 'lots') ?? 4;
      const mocks = getFeatureLimit(basicPlan, 'mock') ?? 2;
      return `Jee bilkul, AMAL GCSE, IGCSE aur Cambridge O-Level ke liye Combined aur Triple Science (Biology, Chemistry, Physics) aur Maths/TSP ki tayari karwata hai. Hamara ${basicPlan.name} £${basicPlan.monthlyPrice} per month hai, jisme full app access, ${lots} LOTS live tuition sessions aur ${mocks} Mock Exams shamil hain. Agar mazeed maloomat darkaar hon tou batayiye ga!`;
    }

    // 2. Jailbreak / Discount attempts
    if (text.includes('override') || text.includes('system prompt') || text.includes('ignore previous') || text.includes('coupon') || text.includes('discount code') || text.includes('free lifetime')) {
      if (livePlansData?.individualError || !livePlansData?.individual || livePlansData.individual.length === 0) {
        return "I can't provide custom discounts, promotional codes or modify AMAL's approved plans. Current plan details and pricing are temporarily unavailable right now. If you have specific pricing queries, the AMAL team can assist you at support@amalearning.space.";
      }
      const appOnly = findPlanByKeyword(livePlansData.individual, 'app-only') || findPlanByKeyword(livePlansData.individual, 'app only');
      const basic = findPlanByKeyword(livePlansData.individual, 'basic');
      const standard = findPlanByKeyword(livePlansData.individual, 'standard');
      const premium = findPlanByKeyword(livePlansData.individual, 'premium');

      const priceList: string[] = [];
      if (appOnly) priceList.push(`${appOnly.name} (£${appOnly.monthlyPrice}/mo)`);
      if (basic) priceList.push(`${basic.name} (£${basic.monthlyPrice}/mo)`);
      if (standard) priceList.push(`${standard.name} (£${standard.monthlyPrice}/mo)`);
      if (premium) priceList.push(`${premium.name} (£${premium.monthlyPrice}/mo)`);

      const priceStr = priceList.length > 0 ? ` Our official published prices are: ${priceList.join(', ')}.` : '';
      return `I can't provide custom discounts, promotional codes or modify AMAL's approved plans.${priceStr} If you have specific pricing queries, the AMAL team can assist you at support@amalearning.space.`;
    }

    // 3. LOTS feature
    if (text.includes('what is lots') || text.includes('lots stands for') || text.includes('meaning of lots')) {
      return "LOTS stands for Live Online Tuition Session. It's AMAL's live tuition option, where students attend teaching sessions online.";
    }

    // 3b. 7-Day Free Trial Offer
    if (
      text.includes('free trial') ||
      text.includes('free-trial') ||
      (text.includes('trial') && (text.includes('free') || text.includes('offer') || text.includes('include') || text.includes('what is') || text.includes('how long') || text.includes('7 day') || text.includes('7-day') || text.includes('details')))
    ) {
      return "AMAL offers a 7-day free trial so you can explore the platform before subscribing. During the trial, you'll have access to limited features of the AMAL app, including one Topic Test and access to LOTS (Live Online Tuition Sessions). Please note that not all app features are unlocked during the trial, and full benefits (such as full Mock Exams and regular tuition sessions) are part of our paid subscription plans. If you'd like to check exact session limits or get started, our team at support@amalearning.space can help!";
    }

    // 4. General AMAL offering
    if (text.includes('what does amal actually offer') || text.includes('what do you offer') || text.includes('what is amal') || text.includes('tell me about amal')) {
      return "AMAL brings together learning and exam practice for GCSE, IGCSE and Cambridge O-Level students.\n\nThere are Topic Tests, Homework, Mock Exams, MCQs, ILM videos and live tuition sessions (LOTS), along with other learning resources.\n\nAre you mainly looking for independent revision or live tuition?";
    }

    // 4b. Parent plan recommendation enquiry
    if (
      text.includes('recommend') ||
      text.includes('which plan') ||
      text.includes('best plan') ||
      text.includes('for my child') ||
      text.includes('for my son') ||
      text.includes('for my daughter') ||
      text.includes('parent') && (text.includes('plan') || text.includes('option'))
    ) {
      if (livePlansData?.individualError) {
        return PLANS_UNAVAILABLE_MESSAGE;
      }
      return formatParentRecommendation(livePlansData?.individual || []);
    }

    // AI Identity check (e.g. "Are you a real human teacher right now?")
    const isAiQuery =
      /\b(ai|bot|robot)\b/i.test(text) ||
      text.includes('artificial intelligence') ||
      text.includes('real person') ||
      text.includes('human') ||
      text.includes('virtual assistant') ||
      text.includes('real teacher') ||
      text.includes('human teacher');

    if (isAiQuery) {
      return "I'm Zeeshan, AMAL's virtual AI assistant 🙂 I can help with general questions about our learning resources, lessons and subscriptions. If you'd rather speak to the team directly, that's fine too — you can reach them at support@amalearning.space.";
    }

    // 5. School vs Individual routing
    // Distinguish genuine school/institution enquiries from parents/students mentioning their child's school
    const isParentOrStudentIndividualContext =
      text.includes('my son') ||
      text.includes('my daughter') ||
      text.includes('my child') ||
      text.includes('my kid') ||
      text.includes('for my son') ||
      text.includes('for my daughter') ||
      text.includes('for my child') ||
      text.includes('at school') ||
      text.includes('in school') ||
      text.includes('goes to school') ||
      text.includes('child at school') ||
      text.includes('after school');

    const hasIndividualTierMention =
      text.includes('basic') ||
      text.includes('standard') ||
      text.includes('premium') ||
      text.includes('app-only') ||
      text.includes('app only');

    const isInstitutionalSchoolEnquiry =
      text.includes('secondary school') ||
      text.includes('licence') ||
      text.includes('license') ||
      text.includes('institution') ||
      text.includes('for our students') ||
      text.includes('head of department') ||
      text.includes('cohort') ||
      text.includes('school pricing') ||
      text.includes('school package') ||
      text.includes('school plan') ||
      text.includes('school subscription') ||
      text.includes('we are a school') ||
      text.includes('for our school') ||
      text.includes('on behalf of a school') ||
      text.includes('buying for a school') ||
      (text.includes('teacher') && (text.includes('school') || text.includes('licence') || text.includes('pricing') || text.includes('students') || text.includes('cohort'))) ||
      ((text.includes('school') || text.includes('schools')) && !isParentOrStudentIndividualContext && !hasIndividualTierMention);

    const isSchoolQuery = isInstitutionalSchoolEnquiry;

    const isExplicitCompare = text.includes('compare') && (text.includes('individual') || text.includes('parent') || text.includes('personal'));

    if (isSchoolQuery && !isExplicitCompare) {
      if (livePlansData?.schoolError) {
        return PLANS_UNAVAILABLE_MESSAGE;
      }
      return formatSchoolPlansResponse(livePlansData?.school || []);
    }

    if (isSchoolQuery && isExplicitCompare) {
      if (livePlansData?.individualError && livePlansData?.schoolError) {
        return PLANS_UNAVAILABLE_MESSAGE;
      }
      return formatComparePlansResponse(livePlansData?.individual || [], livePlansData?.school || []);
    }

    // Detect exam board if mentioned in user query
    const detectedBoard = text.includes('aqa') ? 'aqa' : text.includes('edexcel') ? 'edexcel' : undefined;

    // Multi-plan enquiry detection (e.g. asking about both Basic and Standard)
    const mentionsBasic = text.includes('basic');
    const mentionsStandard = text.includes('standard');
    const mentionsPremium = text.includes('premium');
    const mentionsAppOnly = text.includes('app-only') || text.includes('app only') || text.includes('app');
    const mentionedTiersCount = (mentionsBasic ? 1 : 0) + (mentionsStandard ? 1 : 0) + (mentionsPremium ? 1 : 0) + (mentionsAppOnly ? 1 : 0);

    if (mentionedTiersCount >= 2) {
      if (livePlansData?.individualError) {
        return PLANS_UNAVAILABLE_MESSAGE;
      }
      const requestedTiers: ('basic' | 'standard' | 'premium' | 'app-only')[] = [];
      if (mentionsAppOnly) requestedTiers.push('app-only');
      if (mentionsBasic) requestedTiers.push('basic');
      if (mentionsStandard) requestedTiers.push('standard');
      if (mentionsPremium) requestedTiers.push('premium');
      return formatMultiPlanResponse(requestedTiers, livePlansData?.individual || [], detectedBoard);
    }

    // 6. App only plan (Individual)
    if (text.includes('cheaper plan') || text.includes('app only') || text.includes('just for the app') || text.includes('only the app') || text.includes('10.99') || text.includes('app-only')) {
      if (livePlansData?.individualError) {
        return PLANS_UNAVAILABLE_MESSAGE;
      }
      return formatSinglePlanResponse('app-only', livePlansData?.individual || [], detectedBoard);
    }

    // 7. Basic plan (Individual)
    if (text.includes('basic plan') || text.includes('how much is basic') || text.includes('basic cost') || text.includes('price of basic') || (text.includes('basic') && (text.includes('how much') || text.includes('cost') || text.includes('price')))) {
      if (livePlansData?.individualError) {
        return PLANS_UNAVAILABLE_MESSAGE;
      }
      return formatSinglePlanResponse('basic', livePlansData?.individual || [], detectedBoard);
    }

    // 8. Standard plan (Individual)
    if (text.includes('standard plan') || text.includes('how much is standard') || text.includes('standard cost') || (text.includes('standard') && (text.includes('how much') || text.includes('cost') || text.includes('price')))) {
      if (livePlansData?.individualError) {
        return PLANS_UNAVAILABLE_MESSAGE;
      }
      return formatSinglePlanResponse('standard', livePlansData?.individual || [], detectedBoard);
    }

    // 9. Premium plan (Individual)
    if (text.includes('premium') || text.includes('what about premium')) {
      if (livePlansData?.individualError) {
        return PLANS_UNAVAILABLE_MESSAGE;
      }
      return formatSinglePlanResponse('premium', livePlansData?.individual || [], detectedBoard);
    }

    // 10. All individual pricing comparison
    if (!isSchoolQuery && (text.includes('pricing') || text.includes('prices') || text.includes('cost') || text.includes('how much') || text.includes('plans'))) {
      if (livePlansData?.individualError) {
        return PLANS_UNAVAILABLE_MESSAGE;
      }
      return formatIndividualPlansOverview(livePlansData?.individual || [], detectedBoard);
    }

    // 11. Timetable booking clarification
    if ((text.includes('book') || text.includes('booking') || text.includes('reserve') || text.includes('attend')) && (text.includes('session') || text.includes('lesson') || text.includes('timetable') || text.includes('class'))) {
      return "The published timetable outlines our weekly session schedule, but the timetable alone does not confirm booking or live availability. To confirm session attendance and receive access links, please contact our team at support@amalearning.space. Which session are you hoping to join?";
    }

    // 12. Weekly Timetable & Live Tuition Sessions (CRITICAL: Strict Day-First Filtering & Match User Language)
    const isTimetableQuery =
      text.includes('timetable') ||
      text.includes('schedule') ||
      text.includes('live tuition') ||
      text.includes('revision session') ||
      text.includes('revision sessions') ||
      text.includes('session timings') ||
      text.includes('available classes') ||
      text.includes('classes each week') ||
      text.includes('sessions offer') ||
      text.includes('when are the classes') ||
      text.includes('when are classes') ||
      text.includes('class timings');

    const isRomanUrdu = text.includes('ko') || text.includes('kis waqt') || text.includes('kab') || text.includes('kya') || text.includes('konsi') || text.includes('hain') || text.includes('hai');

    // 12a. Roman Urdu Day / Subject queries
    if (isRomanUrdu && (text.includes('thursday') || text.includes('jumeraat') || text.includes('jumerat'))) {
      return "Thursday ko Grade 7–9 Maths session 5:30 se 6:30 PM tak hai. Published timetable mein timezone specify nahi hai. Timezone confirm karne ke liye support@amalearning.space par contact karein.";
    }

    if (isRomanUrdu && (text.includes('friday') || text.includes('jumma'))) {
      return "Friday ko hamare yeh Science sessions hotay hain:\n\n• Friday, 5:30–6:30 PM: AQA Science Paper 1\n• Friday, 6:30–7:30 PM: AQA Science Paper 2\n\nPublished timetable mein timezone specify nahi hai. Timezone confirm karne ke liye support@amalearning.space par contact karein.";
    }

    if (isRomanUrdu && (text.includes('monday') || text.includes('peer') || text.includes('somwar'))) {
      return "Monday ko Grade 4–6 Maths session 5:30 se 6:30 PM tak hai. Published timetable mein timezone specify nahi hai. Timezone confirm karne ke liye support@amalearning.space par contact karein.";
    }

    if (isRomanUrdu && (text.includes('wednesday') || text.includes('budh'))) {
      return "Wednesday ko Science Support Drop-in / Revision Classes session 5:30 se 6:30 PM tak hai. Published timetable mein timezone specify nahi hai. Timezone confirm karne ke liye support@amalearning.space par contact karein.";
    }

    if (isRomanUrdu && (text.includes('sunday') || text.includes('itwar'))) {
      return "Sunday ko hamare yeh Science sessions hotay hain:\n\n• Sunday, 10:30–11:30 AM: Edexcel Science Paper 1\n• Sunday, 11:30 AM–12:30 PM: Edexcel Science Paper 2\n\nPublished timetable mein timezone specify nahi hai. Timezone confirm karne ke liye support@amalearning.space par contact karein.";
    }

    // 12b. Strict Day-First Filtering (returns ONLY that day's sessions, no other days included!)
    if (text.includes('friday')) {
      return "On Friday, our published Science sessions are:\n\n• Friday, 5:30–6:30 PM: AQA Science Paper 1\n• Friday, 6:30–7:30 PM: AQA Science Paper 2\n\nPlease note the published timetable does not specify a timezone; our team at support@amalearning.space can confirm details. Is your child preparing for Paper 1 or Paper 2?";
    }

    if (text.includes('wednesday')) {
      return "On Wednesday, we have:\n\n• Wednesday, 5:30–6:30 PM: Science Support Drop-in / Revision Classes\n\nThe published timetable does not specify a timezone. Is your child looking for support with a specific science topic?";
    }

    if (text.includes('thursday')) {
      return "On Thursday, we have:\n\n• Thursday, 5:30–6:30 PM: Maths — Grades 7–9\n\nThe published timetable does not specify a timezone; our team can confirm details at support@amalearning.space. Is your child taking the higher tier GCSE paper?";
    }

    if (text.includes('monday')) {
      return "On Monday, we have:\n\n• Monday, 5:30–6:30 PM: Maths — Grades 4–6\n\nThe published timetable does not specify a timezone. Would you like details on how to access this session?";
    }

    if (text.includes('sunday')) {
      return "On Sunday, our published Science sessions are:\n\n• Sunday, 10:30–11:30 AM: Edexcel Science Paper 1\n• Sunday, 11:30 AM–12:30 PM: Edexcel Science Paper 2\n\nThe published timetable does not specify a timezone. Is your child preparing for Edexcel Combined or Triple Science?";
    }

    if (text.includes('saturday')) {
      return "On Saturday, Mock Exams are available any time of day for independent exam practice across all boards. Would you like to know how mock exams are arranged?";
    }

    // 12c. Specific grade/tier queries (when day is not specified)
    if (text.includes('grade 7') || text.includes('grade 7–9') || text.includes('grade 7-9')) {
      return "The published Grade 7–9 Maths session is on Thursday, 5:30–6:30 PM. Please note the timetable does not specify a timezone; our team can confirm details at support@amalearning.space. Is your child preparing for the higher tier GCSE Maths paper?";
    }

    if (text.includes('grade 4') || text.includes('grade 4–6') || text.includes('grade 4-6')) {
      return "The published Grade 4–6 Maths session is on Monday, 5:30–6:30 PM. The published timetable does not specify a timezone; our team can confirm details at support@amalearning.space. Is your child preparing for foundation or intermediate GCSE Maths?";
    }

    // 12d. Subject-specific queries across the week (only when no single day is queried)
    if (text.includes('math') || text.includes('maths')) {
      return "Our published GCSE Maths sessions are:\n• Monday, 5:30–6:30 PM: Maths — Grades 4–6\n• Thursday, 5:30–6:30 PM: Maths — Grades 7–9\n\nPlease note the published timetable does not specify a timezone; our team can confirm details at support@amalearning.space. Is your child preparing for Foundation (Grades 4–6) or Higher Tier (Grades 7–9)?";
    }

    if (text.includes('science support') || text.includes('drop-in') || text.includes('drop in')) {
      return "The Science Support Drop-in / Revision Classes session is on Wednesday, 5:30–6:30 PM. The published timetable does not specify a timezone. Is your child looking for help with a specific science topic?";
    }

    if (text.includes('aqa science') || text.includes('aqa')) {
      return "Our published AQA Science sessions are on Friday:\n• Friday, 5:30–6:30 PM: AQA Science Paper 1\n• Friday, 6:30–7:30 PM: AQA Science Paper 2\n\nThe published timetable does not specify a timezone. Is your child taking AQA Combined or Triple Science?";
    }

    if (text.includes('edexcel science') || text.includes('edexcel')) {
      return "Our published Edexcel Science sessions are on Sunday:\n• Sunday, 10:30–11:30 AM: Edexcel Science Paper 1\n• Sunday, 11:30 AM–12:30 PM: Edexcel Science Paper 2\n\nThe published timetable does not specify a timezone. Is your child taking Edexcel Combined or Triple Science?";
    }

    if (text.includes('science') && (text.includes('session') || text.includes('class') || text.includes('when') || text.includes('timing') || text.includes('lesson'))) {
      return "Our published Science sessions throughout the week are:\n• Wednesday, 5:30–6:30 PM: Science Support Drop-in / Revision Classes\n• Friday, 5:30–6:30 PM: AQA Science Paper 1\n• Friday, 6:30–7:30 PM: AQA Science Paper 2\n• Sunday, 10:30–11:30 AM: Edexcel Science Paper 1\n• Sunday, 11:30 AM–12:30 PM: Edexcel Science Paper 2\n\nThe timetable does not specify a timezone. Is your child taking AQA, Edexcel, or looking for general Science drop-in support?";
    }

    // General Timetable query
    if (isTimetableQuery) {
      return "AMAL offers Maths, Science revision, AQA Science Paper sessions and Edexcel Science Paper sessions throughout the week. Saturday is reserved for Mock Exams, which are available any time of day.\n\n• Monday, 5:30–6:30 PM: Maths — Grades 4–6\n• Wednesday, 5:30–6:30 PM: Science Support Drop-in / Revision Classes\n• Thursday, 5:30–6:30 PM: Maths — Grades 7–9\n• Friday, 5:30–6:30 PM: AQA Science Paper 1\n• Friday, 6:30–7:30 PM: AQA Science Paper 2\n• Saturday: Mock Exams — available any time of day\n• Sunday, 10:30–11:30 AM: Edexcel Science Paper 1\n• Sunday, 11:30 AM–12:30 PM: Edexcel Science Paper 2\n\nPlease note the published timetable does not specify a timezone; our team at support@amalearning.space can confirm details. Which subject or exam board is your child preparing for?";
    }

    // 13. Complaint / payment issue
    if (text.includes('paid') || text.includes("can't access") || text.includes('login issue') || text.includes('refund') || text.includes('problem')) {
      return "I'm sorry you're having trouble accessing your lessons, especially after paying. Our team will need to check what's happened with your account. You can reach them at support@amalearning.space.";
    }

    // 14. Privacy / child marks
    if (text.includes('son') || text.includes('daughter') || text.includes('results') || text.includes('marks') || text.includes('score') || text.includes('grade')) {
      return "Parents and guardians can access their child's performance information through the appropriate authorised process. I can't share private results through an unverified WhatsApp chat, but the AMAL team can help you with the correct access process at support@amalearning.space.";
    }

    // 15. AI check
    if (
      /\b(ai|bot|robot)\b/i.test(text) ||
      text.includes('artificial intelligence') ||
      text.includes('real person') ||
      text.includes('human') ||
      text.includes('virtual assistant') ||
      text.includes('real teacher') ||
      text.includes('human teacher')
    ) {
      return "I'm Zeeshan, AMAL's virtual AI assistant 🙂 I can help with general questions about our learning resources, lessons and subscriptions. If you'd rather speak to the team directly, that's fine too — you can reach them at support@amalearning.space.";
    }

    // 16. Identity / Name check
    if (text.includes('who are you') || text.includes('what is your name') || text.includes("what's your name") || text.includes('who is this')) {
      if (detectedName) {
        return `Hi ${detectedName}! 👋 I’m Zeeshan from AMAL.\n\nThanks for reaching out! 😊 I can help you explore our GCSE, IGCSE and Cambridge O-Level learning plans, weekly live tuition sessions, Topic Tests and Mock Exams.\n\nWhat can I help you with today?`;
      }
      return "Hi! 👋 I’m Zeeshan from AMAL.\n\nThanks for reaching out! 😊 I can help you explore our GCSE, IGCSE and Cambridge O-Level learning plans, weekly live tuition sessions, Topic Tests and Mock Exams.\n\nWhat can I help you with today?";
    }

    // Pure greeting detection
    const isPureGreeting =
      text === 'hello' ||
      text === 'hi' ||
      text === 'hey' ||
      text === 'hi zeeshan' ||
      text === 'hello zeeshan' ||
      text === 'hey zeeshan' ||
      text === 'good morning' ||
      text === 'good afternoon' ||
      text === 'good evening' ||
      text === 'salam' ||
      text === 'assalam o alaikum' ||
      text === 'assalam-o-alaikum' ||
      text === 'start' ||
      text === 'help' ||
      text === '' ||
      text === 'hiya' ||
      Boolean(detectedName && (text.startsWith('hi') || text.startsWith('hello') || text.startsWith('hey') || text.includes('my name is') || text.includes('i am')));

    // 17. Default or Personalised greeting when a new conversation starts or customer introduces their name
    if (isPureGreeting || history.length === 0) {
      if (detectedName) {
        return `Hi ${detectedName}! 👋 Welcome to AMAL. How can I help you today?`;
      }
      return "Hi! 👋 I’m Zeeshan from AMAL.\n\nThanks for reaching out! 😊 I can help you explore our GCSE, IGCSE and Cambridge O-Level learning plans, weekly live tuition sessions, Topic Tests and Mock Exams.\n\nWhat can I help you with today?";
    }

    if (text.includes('thank') || text.includes('thanks') || text.includes('cheers') || text.includes('shukriya')) {
      return "You're very welcome! If you have any further questions about our plans, live sessions or learning resources, please feel free to ask.";
    }

    // Default polite British education support response (without repeating full greeting)
    if (detectedName) {
      return `Hi ${detectedName}, I'm here to help with your GCSE, IGCSE and Cambridge O-Level queries. Would you like more details on our subjects, live lessons or revision resources?`;
    }
    return "I'm here to help with your GCSE, IGCSE and Cambridge O-Level queries. Would you like more details on our subjects, live lessons or revision resources?";
  }

  // Health and info endpoint (rate-limited)
  app.get('/api/info', infoRateLimiter, (_req, res) => {
    res.json({
      status: 'online',
      name: 'AMALearning WhatsApp Assistant (Zeeshan)',
      assistantName: 'Zeeshan',
      brand: 'AMAL / A.M.A.Learning',
      hasApiKey: Boolean(apiKey),
      hasN8nAuth: Boolean(n8nApiKey),
      model: GEMINI_MODEL,
      version: '1.0.0',
    });
  });

  // Live Plans endpoint (Backend single source of truth for frontend & API clients, rate-limited)
  app.get('/api/plans', plansRateLimiter, async (req, res) => {
    try {
      const category = req.query.category as string;
      const wantsRefresh = req.query.refresh === 'true';

      // Protect ?refresh=true so unauthenticated external callers cannot bypass cache and flood upstream
      if (wantsRefresh && !isRequestAuthorized(req, n8nApiKey, isProd)) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Valid API key or same-origin authorization required to force refresh plans cache.',
        });
      }
      const forceRefresh = wantsRefresh;

      if (category === 'school') {
        const result = await fetchPlansFromApi('school', { forceRefresh });
        return res.json({
          success: result.success,
          category: 'school',
          plans: result.plans,
          isCached: result.isCached,
          error: result.error,
          message: result.plans.length === 0 ? 'No school plans are currently published online.' : undefined,
        });
      }

      if (category === 'individual') {
        const result = await fetchPlansFromApi('individual', { forceRefresh });
        return res.json({
          success: result.success,
          category: 'individual',
          plans: result.plans,
          isCached: result.isCached,
          error: result.error,
        });
      }

      // Default: fetch both
      const [indResult, schResult] = await Promise.all([
        fetchPlansFromApi('individual', { forceRefresh }),
        fetchPlansFromApi('school', { forceRefresh }),
      ]);

      return res.json({
        success: indResult.success && schResult.success,
        plans: {
          individual: indResult.plans,
          school: schResult.plans,
        },
        isCached: indResult.isCached && schResult.isCached,
        errors: {
          individual: indResult.error,
          school: schResult.error,
        },
      });
    } catch (err: any) {
      console.error('Error in /api/plans:', err);
      return res.status(500).json({ success: false, error: err?.message || 'Failed to fetch plans' });
    }
  });

  // Chat endpoint
  app.post('/api/chat', chatRateLimiter, async (req, res) => {
    // Server-to-server authentication check (strictly enforced in production)
    if (!isRequestAuthorized(req, n8nApiKey, isProd)) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Valid API key required in the x-api-key header for external access.',
      });
    }

    try {
      if (!req.body || typeof req.body !== 'object') {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Request body must be a valid JSON object.',
        });
      }

      const { messages, stream = false, customerName } = req.body;

      if (!Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Messages array must be a non-empty array.',
        });
      }

      // Validate each message item
      for (let i = 0; i < messages.length; i++) {
        const m = messages[i];
        if (!m || typeof m !== 'object') {
          return res.status(400).json({
            error: 'Bad Request',
            message: `Message at index ${i} must be an object.`,
          });
        }
        if (typeof m.role !== 'string' || !['user', 'assistant', 'system', 'model'].includes(m.role)) {
          return res.status(400).json({
            error: 'Bad Request',
            message: `Message at index ${i} has invalid role. Expected 'user', 'assistant', or 'system'.`,
          });
        }
        if (typeof m.content !== 'string' || m.content.trim().length === 0) {
          return res.status(400).json({
            error: 'Bad Request',
            message: `Message at index ${i} must contain non-empty content string.`,
          });
        }
        if (m.content.length > 4000) {
          return res.status(400).json({
            error: 'Bad Request',
            message: `Message at index ${i} exceeds maximum allowed length of 4000 characters.`,
          });
        }
      }

      if (customerName !== undefined && (typeof customerName !== 'string' || customerName.length > 100)) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Customer name must be a string up to 100 characters.',
        });
      }

      const lastUserMessage = messages[messages.length - 1];
      const conversationHistory = messages.slice(0, messages.length - 1);

      // Clean customer name if supplied
      const safeCustomerName = typeof customerName === 'string' && customerName.trim() ? customerName.trim() : undefined;

      // Concurrently fetch live individual and school plans from backend service
      const [indResult, schResult] = await Promise.all([
        fetchPlansFromApi('individual'),
        fetchPlansFromApi('school'),
      ]);

      const livePlansData = {
        individual: indResult.plans,
        school: schResult.plans,
        individualError: indResult.error,
        schoolError: schResult.error,
      };

      // Construct live dynamic plan instructions for Gemini
      let livePlansInstruction = '\n\n### LIVE AMALEARNING PLANS API (SINGLE SOURCE OF TRUTH)\n';
      if (indResult.success && indResult.plans.length > 0) {
        livePlansInstruction += 'The following individual plans are LIVE and verified from https://api.amalearning.space/api/v1/plan/get/public/all:\n';
        for (const p of indResult.plans) {
          const boardName = getPlanExamBoardName(p);
          const boardTag = boardName ? ` (${boardName})` : '';
          const limits = formatPlanLimits(p);
          livePlansInstruction += `• ${p.name.trim()}${boardTag}: £${p.monthlyPrice}/mo (£${p.yearlyPrice}/yr). Limits: ${limits}\n`;
        }
        const planPriceSummaries = indResult.plans
          .map((p) => {
            const boardName = getPlanExamBoardName(p);
            return `${p.name.trim()}${boardName ? ` [${boardName}]` : ''} at £${p.monthlyPrice}/mo (£${p.yearlyPrice}/yr)`;
          })
          .join(', ');
        livePlansInstruction += `CRITICAL RULE: Always use the exact live plan prices and feature limits from the API data above (current live rates: ${planPriceSummaries}). NEVER quote outdated or invented prices. Do NOT assume AQA and Edexcel features are equivalent unless confirmed in the data above. All plan names, monthly and yearly prices, and feature limits must strictly reflect the live API response above.\n`;
      } else {
        livePlansInstruction += 'Individual plans API could not be retrieved. You MUST tell the customer that current plan details and pricing are temporarily unavailable right now, and refer them to support@amalearning.space. Do NOT quote outdated prices as current.\n';
      }

      if (schResult.success) {
        if (schResult.plans.length === 0) {
          livePlansInstruction += 'School plans API (https://api.amalearning.space/api/v1/plan/get/public/all?category=school) returned an empty plans list. No school plans are currently published online. You MUST NOT invent any prices, student quotas, or package limits. Direct school enquiries to support@amalearning.space for bespoke school quotations.\n';
        } else {
          livePlansInstruction += 'The following school plans are LIVE from the API:\n';
          for (const p of schResult.plans) {
            livePlansInstruction += `• ${p.name}: £${p.monthlyPrice}/mo. ${p.description || ''}\n`;
          }
        }
      } else {
        livePlansInstruction += 'School plans API is temporarily unavailable. Direct school enquiries to support@amalearning.space.\n';
      }

      // Construct system instruction with customer context and live plans
      let systemInstruction = MASTER_SYSTEM_PROMPT + livePlansInstruction;
      if (safeCustomerName) {
        systemInstruction += `\n\n### Current Customer Context\n- Verified Customer Name: "${safeCustomerName}".\n- IMPORTANT INSTRUCTION: When greeting this customer (especially on initial greeting messages or introductions), address them naturally by name (e.g. "Hi ${safeCustomerName}! 👋 Welcome to AMAL. How can I help you today?"). If the customer asks a direct question, answer it directly.`;
      }

      // If Gemini API is available, call it
      if (ai) {
        const contents = messages.map((m: { role: string; content: string }) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        }));

        if (stream) {
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');

          try {
            const { result: responseStream } = await executeGeminiWithRetry(
              () =>
                ai.models.generateContentStream({
                  model: GEMINI_MODEL,
                  contents,
                  config: {
                    systemInstruction,
                    temperature: GEMINI_TEMPERATURE,
                  },
                })
            );

            for await (const chunk of responseStream) {
              const text = chunk.text;
              if (text) {
                res.write(`data: ${JSON.stringify({ text })}\n\n`);
              }
            }

            res.write(`data: [DONE]\n\n`);
            return res.end();
          } catch (streamErr: any) {
            console.error('Gemini stream error:', sanitizeErrorMessage(streamErr));
            const fallbackText = generateFallbackResponse(lastUserMessage.content, conversationHistory, safeCustomerName, livePlansData);
            res.write(`data: ${JSON.stringify({ text: fallbackText })}\n\n`);
            res.write(`data: [DONE]\n\n`);
            return res.end();
          }
        } else {
          try {
            const { result } = await executeGeminiWithRetry(
              () =>
                ai.models.generateContent({
                  model: GEMINI_MODEL,
                  contents,
                  config: {
                    systemInstruction,
                    temperature: GEMINI_TEMPERATURE,
                  },
                })
            );

            const reply = result.text || generateFallbackResponse(lastUserMessage.content, conversationHistory, safeCustomerName, livePlansData);
            return res.json({ reply });
          } catch (genErr: any) {
            console.error('Gemini API call failed, using verified fallback:', sanitizeErrorMessage(genErr));
            const fallbackReply = generateFallbackResponse(lastUserMessage.content, conversationHistory, safeCustomerName, livePlansData);
            return res.json({ reply: fallbackReply, note: 'Generated using verified AMAL knowledge base.' });
          }
        }
      } else {
        // No API key configured: provide verified rule-based response
        const fallbackReply = generateFallbackResponse(lastUserMessage.content, conversationHistory, safeCustomerName, livePlansData);
        if (stream) {
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');
          res.write(`data: ${JSON.stringify({ text: fallbackReply })}\n\n`);
          res.write(`data: [DONE]\n\n`);
          return res.end();
        } else {
          return res.json({
            reply: fallbackReply,
            note: 'Generated using verified AMAL response engine.',
          });
        }
      }
    } catch (err: any) {
      console.error('Server error in /api/chat:', sanitizeErrorMessage(err));
      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'An unexpected error occurred while processing your request. Please try again later.',
      });
    }
  });

  // Setup Vite middlewares in development or serve static assets in production
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AMALearning WhatsApp Assistant server running on port ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
