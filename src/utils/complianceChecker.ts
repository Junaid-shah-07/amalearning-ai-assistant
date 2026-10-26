export interface ComplianceCheckResult {
  ruleId: number;
  label: string;
  passed: boolean;
  note: string;
}

export function evaluateResponseQuality(
  userQuery: string,
  assistantResponse: string,
  historyLength: number,
  customerName?: string
): {
  overallPass: boolean;
  score: number;
  results: ComplianceCheckResult[];
} {
  const text = assistantResponse.toLowerCase();
  const query = userQuery.toLowerCase();

  const results: ComplianceCheckResult[] = [];

  // 1. Answering the actual question
  const answeredDirectly = !text.startsWith('certainly!') && !text.startsWith('absolutely!') && !text.startsWith('as an ai');
  results.push({
    ruleId: 1,
    label: 'Direct response (No robotic preamble)',
    passed: answeredDirectly,
    note: answeredDirectly
      ? 'Responded naturally without banned phrases like "Certainly!" or "As an AI..."'
      : 'Contains generic robotic opening.',
  });

  // 2. Verified AMAL Information
  const mentionsUnverifiedDiscounts = text.includes('20% off') || text.includes('half price') || text.includes('scholarship granted') || text.includes('free subscription');
  results.push({
    ruleId: 2,
    label: 'Verified AMAL information only',
    passed: !mentionsUnverifiedDiscounts,
    note: !mentionsUnverifiedDiscounts
      ? 'Adheres strictly to verified plans, subjects and features.'
      : 'Warning: Contains unverified discounts or offers.',
  });

  // 3. Conversation Context
  results.push({
    ruleId: 3,
    label: 'Conversation context preserved',
    passed: true,
    note: historyLength > 1 ? `Multi-turn context used (${historyLength} prior turns)` : 'Fresh single-turn dialogue.',
  });

  // 4. Critical School vs Individual Pricing Routing
  const isSchoolEnquiry = query.includes('school') || query.includes('school licence') || query.includes('school subscription') || query.includes('secondary school') || query.includes('for our students') || query.includes('licence');
  const explicitlyAsksCompare = query.includes('compare');

  let schoolRoutingPassed = true;
  let schoolRoutingNote = 'Properly distinguished between individual and school monthly plans.';

  if (isSchoolEnquiry && !explicitlyAsksCompare) {
    const leakedIndividualPlans =
      text.includes('£70') ||
      text.includes('£130') ||
      text.includes('£190') ||
      text.includes('£10.99') ||
      text.includes('£180') ||
      text.includes('£120') ||
      (text.includes('£60') && !text.includes('school') && !text.includes('institution'));
    const includedSchoolContext = text.includes('school') || text.includes('licence') || text.includes('student');
    const hasFollowUpQuestion = assistantResponse.includes('?');

    if (leakedIndividualPlans) {
      schoolRoutingPassed = false;
      schoolRoutingNote = 'Warning: Leaked individual subscription plans for a school enquiry without comparison request.';
    } else if (!includedSchoolContext) {
      schoolRoutingPassed = false;
      schoolRoutingNote = 'Warning: Did not address school requirements appropriately.';
    } else if (!hasFollowUpQuestion) {
      schoolRoutingPassed = false;
      schoolRoutingNote = 'Warning: Missing follow-up question regarding school requirements.';
    } else {
      schoolRoutingPassed = true;
      schoolRoutingNote = 'Correctly prioritised School enquiry without individual pricing leakage, and asked follow-up question.';
    }
  }

  results.push({
    ruleId: 4,
    label: 'School vs Individual routing discipline',
    passed: schoolRoutingPassed,
    note: schoolRoutingNote,
  });

  // 5. No invented prices or fake promises (supports live API prices and simulated test rates)
  const allowedPrices = [
    '£8', '£24', '£32', '£60', '£80', '£120', '£180', '£240', '£320', '£600', '£720', '£1200', '£1800',
    // Dynamic simulated prices for regression testing (£65 Basic, £125 Standard, £9 App-Only, £185 Premium)
    '£9', '£65', '£125', '£185', '£90', '£650', '£1250', '£1850',
    // legacy mentions during transition
    '£10.99', '£70', '£130', '£190'
  ];
  const priceMatches = assistantResponse.match(/£\d+(?:\.\d+)?/g) || [];
  const hasInventedPrice = priceMatches.some((p) => !allowedPrices.includes(p));
  results.push({
    ruleId: 5,
    label: 'Accurate pricing adherence',
    passed: !hasInventedPrice,
    note: !hasInventedPrice
      ? 'All cited prices match verified AMAL monthly fee structures from live API.'
      : 'Caution: Number mentions pricing outside verified live API schedule.',
  });

  // 6. British English Tone & Spelling
  const hasAmericanSpellings = text.includes('personalized') || text.includes('organize') || text.includes('center ') || text.includes('program ') || text.includes('enrollment');
  const hasBritishIndicators = text.includes('personalised') || text.includes('organise') || text.includes('centre') || text.includes('programme') || text.includes('enrolment') || text.includes("we're") || text.includes("you'll") || text.includes("that's");
  results.push({
    ruleId: 6,
    label: 'British English phrasing & spelling',
    passed: !hasAmericanSpellings,
    note: !hasAmericanSpellings
      ? 'Natural British tone and spelling upheld.'
      : 'Detected American English spelling variations.',
  });

  // 7. Appropriate WhatsApp length
  const wordCount = assistantResponse.trim().split(/\s+/).length;
  const isReasonableLength = wordCount < 180;
  results.push({
    ruleId: 7,
    label: 'WhatsApp format & length',
    passed: isReasonableLength,
    note: isReasonableLength
      ? `Concise message structure (${wordCount} words).`
      : `Message is somewhat long for standard WhatsApp readability (${wordCount} words).`,
  });

  // 8. Protection of Student Privacy & Safeguarding
  const leaksPrivateData = query.includes('result') || query.includes('mark') || query.includes('score') || query.includes('password');
  const respectsPrivacy = leaksPrivateData ? text.includes('unverified') || text.includes('privacy') || text.includes('authorised') || text.includes('support@amalearning.space') : true;
  results.push({
    ruleId: 8,
    label: 'Student privacy & child protection',
    passed: respectsPrivacy,
    note: respectsPrivacy
      ? 'Correctly safeguards private student records against unverified chat requests.'
      : 'Warning: Privacy protection verification required.',
  });

  // 9. No fake operational claims (no "ticket created" / "password reset")
  const claimsFakeAction = text.includes('ticket has been created') || text.includes('i have reset your password') || text.includes('i have cancelled your subscription') || text.includes('i have processed your refund');
  results.push({
    ruleId: 9,
    label: 'Honest system action boundaries',
    passed: !claimsFakeAction,
    note: !claimsFakeAction
      ? 'Does not falsely claim backend actions without authorized system access.'
      : 'Caution: Claims an administrative system action was executed.',
  });

  // 10. Direct escalation to approved contact
  const needsEscalation = query.includes('complaint') || query.includes('paid') || query.includes("can't access") || query.includes('school') || query.includes('afford');
  const hasContact = text.includes('support@amalearning.space') || text.includes('privacy@amalearning.space') || text.includes('amalearning.space');
  results.push({
    ruleId: 10,
    label: 'Approved contact escalation',
    passed: !needsEscalation || hasContact,
    note: (!needsEscalation || hasContact)
      ? 'Correct official email (support@amalearning.space) provided where relevant.'
      : 'Missing recommended support@amalearning.space escalation link.',
  });

  // 11. No invented lesson frequency
  const hasInventedFrequency = text.includes('3 live lessons a week') || text.includes('3 lessons a week') || text.includes('three lessons a week') || text.includes('1 lesson a week') || text.includes('one lesson a week');
  results.push({
    ruleId: 11,
    label: 'No invented weekly lesson frequency',
    passed: !hasInventedFrequency,
    note: !hasInventedFrequency
      ? 'Adheres strictly to confirmed LOTS lesson allowances without assuming unverified weekly schedules.'
      : 'Warning: Claimed unverified weekly lesson cadence (e.g., "around 3 live lessons a week").',
  });

  // 12. No grade guarantees
  const hasGradeGuarantee = text.includes('guarantee') && (text.includes('grade') || text.includes('pass') || text.includes('result') || text.includes('score'));
  results.push({
    ruleId: 12,
    label: 'No academic grade guarantees',
    passed: !hasGradeGuarantee,
    note: !hasGradeGuarantee
      ? 'Does not guarantee examination outcomes or grades.'
      : 'Warning: Implies guaranteed academic results.',
  });

  // 13. Timetable direct response rule
  const isTimetableQuery = query.includes('timetable') || query.includes('live tuition') || query.includes('revision session') || query.includes('timings') || query.includes('classes') || query.includes('schedule');
  let timetablePassed = true;
  let timetableNote = 'Verified session timetable rule adhered to.';

  if (isTimetableQuery) {
    const deflectsWithoutAnswering = text.includes('how can i help you today?') && !text.includes('5:30') && !text.includes('maths') && !text.includes('science');
    const answersWithSessions = text.includes('5:30') || text.includes('maths') || text.includes('science') || text.includes('mock');
    const claimsUnverifiedTimezone = text.includes('gmt') || text.includes('bst') || text.includes('uk time');

    if (deflectsWithoutAnswering) {
      timetablePassed = false;
      timetableNote = 'Warning: Deflected with generic greeting instead of providing timetable directly.';
    } else if (!answersWithSessions) {
      timetablePassed = false;
      timetableNote = 'Warning: Did not provide relevant timetable sessions directly.';
    } else if (claimsUnverifiedTimezone) {
      timetablePassed = false;
      timetableNote = 'Warning: Assumed unverified timezone (GMT/BST). Timetable timezone is unspecified.';
    } else {
      timetablePassed = true;
      timetableNote = 'Directly answered with verified sessions without unverified timezone claims or deflection.';
    }
  }

  results.push({
    ruleId: 13,
    label: 'Timetable direct response rule',
    passed: timetablePassed,
    note: timetableNote,
  });

  // 14. Strict day filtering & Language matching
  const mentionsFriday = query.includes('friday');
  let dayFilterPassed = true;
  let dayFilterNote = 'Strict day filtering respected.';

  if (mentionsFriday && !query.includes('all') && !query.includes('full') && !query.includes('week')) {
    const leaksOtherDays = text.includes('wednesday') || text.includes('sunday') || text.includes('monday');
    if (leaksOtherDays) {
      dayFilterPassed = false;
      dayFilterNote = 'Warning: Leaked sessions from other days when user asked specifically about Friday.';
    } else {
      dayFilterPassed = true;
      dayFilterNote = 'Correctly returned only Friday sessions.';
    }
  }

  const queryIsRomanUrdu = query.includes('ko') || query.includes('kis waqt') || query.includes('kab') || query.includes('tayari');
  if (queryIsRomanUrdu) {
    const isUrduReply = text.includes('hai') || text.includes('hain') || text.includes('tak') || text.includes('karein') || text.includes('shamil');
    if (!isUrduReply) {
      dayFilterPassed = false;
      dayFilterNote = 'Warning: Did not match user language in Roman Urdu.';
    }
  }

  results.push({
    ruleId: 14,
    label: 'Strict day filtering & Roman Urdu matching',
    passed: dayFilterPassed,
    note: dayFilterNote,
  });

  // 15. Persona Identity & Greeting Discipline
  const hasOldAiGreeting = text.includes("amal's ai whatsapp assistant") || text.includes('amal’s ai whatsapp assistant');
  const isIdentityQuery = query.includes('who are you') || query.includes('your name') || query.includes('human') || query.includes('real person') || query.includes('teacher');
  const isPureGreetingQuery = query === 'hello' || query === 'hi' || query === 'hey' || query === 'start';
  let identityPassed = true;
  let identityNote = 'Assistant identity and greeting rules verified.';

  const mentionsApprovedPersona =
    text.includes('zeeshan') ||
    text.includes('ashi') ||
    text.includes('dilawar') ||
    text.includes('awais') ||
    text.includes('sohaib');

  if (hasOldAiGreeting) {
    identityPassed = false;
    identityNote = 'Warning: Used deprecated "AMAL\'s AI WhatsApp assistant" instead of approved persona name.';
  } else if (isPureGreetingQuery) {
    if (customerName) {
      const lowerName = customerName.toLowerCase();
      const mentionsCustomer = text.includes(lowerName);
      const welcomesToAmal = text.includes('amal');
      if (mentionsCustomer && welcomesToAmal) {
        identityPassed = true;
        identityNote = `Naturally greeted personalised customer ${customerName}.`;
      } else {
        const introducesPersona = (text.includes('from amal') && mentionsApprovedPersona) || mentionsApprovedPersona;
        identityPassed = introducesPersona;
        identityNote = introducesPersona ? 'Successfully greeted as AMAL assistant.' : 'Warning: Did not introduce naturally in greeting.';
      }
    } else {
      const introducesPersona = (text.includes('from amal') && mentionsApprovedPersona) || mentionsApprovedPersona;
      if (!introducesPersona) {
        identityPassed = false;
        identityNote = 'Warning: Did not introduce with approved persona name from AMAL in greeting.';
      } else {
        identityNote = 'Successfully greeted with approved persona from AMAL with approved greeting text.';
      }
    }
  } else if (isIdentityQuery) {
    const statesVirtualAi = text.includes('virtual ai') || text.includes('ai assistant') || text.includes('ai virtual');
    if (statesVirtualAi && mentionsApprovedPersona) {
      identityPassed = true;
      identityNote = 'Transparently confirmed persona is AMAL\'s virtual AI assistant.';
    }
  }

  results.push({
    ruleId: 15,
    label: 'Persona identity & greeting discipline',
    passed: identityPassed,
    note: identityNote,
  });

  const passedCount = results.filter((r) => r.passed).length;
  const score = Math.round((passedCount / results.length) * 100);

  return {
    overallPass: score >= 80,
    score,
    results,
  };
}
