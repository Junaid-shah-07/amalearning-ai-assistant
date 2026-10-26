import crypto from 'crypto';

/**
 * AMALearning Multi-Persona Identity Manager
 *
 * NOTE ON SERVERLESS PERSISTENCE & STORAGE:
 * The AMALearning system operates in a serverless cloud environment (such as Vercel)
 * without an external relational or document database. Because serverless functions
 * spin up and scale down ephemerally across multiple containers and regions,
 * in-memory state (such as Map or global variables) is not preserved across invocations.
 *
 * To guarantee 100% session identity stability without introducing database latency,
 * this system uses DETERMINISTIC HASHING of the conversationId.
 * IMPORTANT: This is deterministic hashing-based assignment, NOT database-backed
 * session storage. Every request sharing the same conversationId deterministically
 * maps to the exact same assigned persona.
 *
 * Server-authoritative control:
 * - Arbitrary unauthenticated clients cannot override the assigned persona mid-conversation.
 * - Explicit persona selection is validated and strictly restricted to trusted, authorized flows
 *   (e.g., n8n webhook with valid API key or authorized administrative requests).
 */

export const ALLOWED_PERSONAS = ['Zeeshan', 'Ashi', 'Dilawar', 'Awais', 'Sohaib'] as const;
export type AllowedPersona = (typeof ALLOWED_PERSONAS)[number];

export const DEFAULT_PERSONA: AllowedPersona = 'Zeeshan';

/**
 * Validates whether a given string is one of the allowed AMALearning assistant personas.
 */
export function isValidPersona(persona: unknown): persona is AllowedPersona {
  if (typeof persona !== 'string') return false;
  const normalized = persona.trim();
  return ALLOWED_PERSONAS.includes(normalized as AllowedPersona);
}

/**
 * 32-bit FNV-1a stable string hashing algorithm.
 * Guarantees cross-platform and cross-runtime consistency.
 */
export function hashConversationId(conversationId: string): number {
  let hash = 2166136261;
  for (let i = 0; i < conversationId.length; i++) {
    hash ^= conversationId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Deterministically assigns one of the 5 allowed personas based on conversationId.
 */
export function assignPersonaDeterministically(conversationId: string): AllowedPersona {
  if (!conversationId || typeof conversationId !== 'string') {
    return DEFAULT_PERSONA;
  }
  const cleanId = conversationId.trim();
  if (!cleanId) {
    return DEFAULT_PERSONA;
  }
  const hash = hashConversationId(cleanId);
  const index = hash % ALLOWED_PERSONAS.length;
  return ALLOWED_PERSONAS[index];
}

export interface PersonaResolutionResult {
  conversationId: string;
  persona: AllowedPersona;
  wasGenerated: boolean;
}

/**
 * Resolves the conversation ID and authoritative persona assignment.
 * - Server is the source of truth.
 * - Generates a new UUID conversationId only when missing or invalid.
 * - Explicit persona requested by client is only accepted if caller is authorized.
 * - Unauthenticated or invalid requests fall back to deterministic hash assignment.
 */
export function resolveConversationPersona(
  conversationId?: unknown,
  requestedPersona?: unknown,
  isAuthorized: boolean = false
): PersonaResolutionResult {
  let resolvedId = '';
  let wasGenerated = false;

  if (typeof conversationId === 'string' && conversationId.trim().length > 0 && conversationId.trim().length <= 128) {
    resolvedId = conversationId.trim();
  } else {
    resolvedId = crypto.randomUUID();
    wasGenerated = true;
  }

  // Determine persona authoritatively
  let resolvedPersona: AllowedPersona;

  if (isAuthorized && isValidPersona(requestedPersona)) {
    // Trusted flow explicitly specifying an approved persona
    resolvedPersona = requestedPersona.trim() as AllowedPersona;
  } else {
    // Authoritative deterministic hash assignment
    resolvedPersona = assignPersonaDeterministically(resolvedId);
  }

  return {
    conversationId: resolvedId,
    persona: resolvedPersona,
    wasGenerated,
  };
}

/**
 * Generates the standardized initial greeting text for a persona.
 */
export function formatPersonaGreeting(persona: AllowedPersona, customerName?: string): string {
  if (customerName && customerName.trim()) {
    return `Hi ${customerName.trim()}! 👋 Welcome to AMAL. How can I help you today?`;
  }
  return `Hi! 👋 I’m ${persona} from AMAL.\n\nThanks for reaching out! 😊 I can help you explore our GCSE, IGCSE and Cambridge O-Level learning plans, weekly live tuition sessions, Topic Tests and Mock Exams.\n\nWhat can I help you with today?`;
}

/**
 * Generates the transparent, honest AI identity confirmation for a persona.
 * Never claims human status or personal teaching background.
 */
export function formatPersonaAiDisclaimer(persona: AllowedPersona): string {
  return `I'm ${persona}, AMAL's virtual AI assistant 🙂 I can help with general questions about our learning resources, lessons and subscriptions. If you'd rather speak to the team directly, that's fine too — you can reach them at support@amalearning.space.`;
}

/**
 * Generates the persona self-introduction response.
 */
export function formatPersonaWhoAreYou(persona: AllowedPersona, customerName?: string): string {
  if (customerName && customerName.trim()) {
    return `Hi ${customerName.trim()}! 👋 I’m ${persona} from AMAL.\n\nThanks for reaching out! 😊 I can help you explore our GCSE, IGCSE and Cambridge O-Level learning plans, weekly live tuition sessions, Topic Tests and Mock Exams.\n\nWhat can I help you with today?`;
  }
  return `Hi! 👋 I’m ${persona} from AMAL.\n\nThanks for reaching out! 😊 I can help you explore our GCSE, IGCSE and Cambridge O-Level learning plans, weekly live tuition sessions, Topic Tests and Mock Exams.\n\nWhat can I help you with today?`;
}
