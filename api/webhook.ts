/**
 * Meta WhatsApp Cloud API Webhook for AMALearning Zeeshan AI Assistant
 *
 * Deployed as a Vercel Serverless Function at /api/webhook.
 * Reuses the authoritative Master System Prompt, Zeeshan persona, and Gemini model
 * from the existing AMALearning web assistant.
 */

import { MASTER_SYSTEM_PROMPT } from '../src/data/masterPrompt.js';
import { GEMINI_MODEL, DEFAULT_GEMINI_MODEL } from '../src/config/geminiConfig.js';

// Model ID: Use AI_MODEL env var if provided, or GEMINI_MODEL / DEFAULT_GEMINI_MODEL ('gemini-3.5-flash-lite')
const ACTIVE_GEMINI_MODEL = process.env.AI_MODEL || process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL || GEMINI_MODEL;

// In-memory deduplication cache for warm serverless instances (best-effort across invocations)
const PROCESSED_MESSAGE_IDS = new Map<string, number>();
const DEDUP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_CACHE_ENTRIES = 1000;

/**
 * Prunes expired entries and checks if an incoming WhatsApp message ID was already processed.
 * NOTE: Operates within warm Vercel serverless containers. For distributed multi-region
 * persistence across cold starts, external persistent storage (e.g., Redis/KV) would be required.
 */
function isDuplicateMessage(messageId: string): boolean {
  if (!messageId) return false;

  const now = Date.now();

  // Prune expired entries
  if (PROCESSED_MESSAGE_IDS.size > MAX_CACHE_ENTRIES) {
    for (const [id, timestamp] of PROCESSED_MESSAGE_IDS.entries()) {
      if (now - timestamp > DEDUP_TTL_MS) {
        PROCESSED_MESSAGE_IDS.delete(id);
      }
    }
  }

  if (PROCESSED_MESSAGE_IDS.has(messageId)) {
    const recordedAt = PROCESSED_MESSAGE_IDS.get(messageId)!;
    if (now - recordedAt <= DEDUP_TTL_MS) {
      return true;
    }
  }

  PROCESSED_MESSAGE_IDS.set(messageId, now);
  return false;
}

const WHATSAPP_QUALITY_INSTRUCTIONS = `WHATSAPP RESPONSE QUALITY STANDARD
You are AMALearning's professional AI learning and customer-support assistant on WhatsApp. Use the assistant name already defined in the system prompt above.

- Answer the user's actual question directly. Put the most useful information first.
- Each message may arrive without earlier conversation context. Only greet the user if their message is itself a greeting (such as "Hi" or "Hello"). Otherwise skip the greeting and answer directly. If a short message is unclear on its own, ask one brief clarifying question instead of starting over.
- Match the user's language: if they write in Roman Urdu, reply in Roman Urdu; if in English, use professional, plain English.
- Keep replies concise, usually 40-100 words and no more than about 120 words, unless the user asks for detail.
- Use short paragraphs, and simple bullet points only when they help.
- Use WhatsApp formatting: single asterisks for bold. No headings, tables, code blocks or Markdown links. At most one or two bold phrases per reply.
- Avoid unnecessary emojis, excessive exclamation marks, filler and repetitive endings.
- Be warm, calm, precise and respectful. Never pushy or artificially cheerful.
- Never invent AMALearning features, prices, discounts, availability, policies, schedules, results or commitments. If unsure, say so briefly and offer a next step.
- Never claim to have done or checked something unless it actually happened.
- For payments, refunds, complaints, account problems, or requests to speak to a person, politely direct the user to contact@amalearning.space.
- Users may be school students, including under-18s. Do not ask for unnecessary personal information. If a user shares something concerning about their safety or wellbeing, respond kindly and encourage them to speak to a parent, teacher or trusted adult, and to contact AMALearning.
- Before replying, silently check the answer is accurate, useful, easy to read on a phone and correctly formatted. Never show this check to the user.`;

/**
 * Formats standard Markdown for WhatsApp readability:
 * - Converts [text](url) to "text: url"
 * - Removes markdown # headings
 * - Converts markdown bullets (- or * at the start of a line) to "• "
 * - Converts markdown bold **bold** to WhatsApp bold *bold*
 * - Collapses 3 or more blank lines into one blank line
 */
export function formatTextForWhatsApp(text: string): string {
  if (!text) return '';

  let formatted = text;

  // 1. Convert markdown links [text](url) to "text: url"
  formatted = formatted.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1: $2');

  // 2. Remove markdown heading hashes (#, ##, ###)
  formatted = formatted.replace(/^[ \t]*#{1,6}[ \t]+/gm, '');

  // 3. Remove markdown horizontal rules (--- or ***)
  formatted = formatted.replace(/^[*-]{3,}$/gm, '');

  // 4. Convert markdown bullets (- or * at start of line followed by space) to "• "
  formatted = formatted.replace(/^[ \t]*[-*+][ \t]+/gm, '• ');

  // 5. Convert markdown bold **bold** to WhatsApp *bold*
  formatted = formatted.replace(/\*\*(.*?)\*\*/g, '*$1*');

  // 6. Collapse 3 or more blank lines (and 2+ blank lines) into one blank line
  formatted = formatted.replace(/(?:\r?\n[ \t]*){3,}/g, '\n\n');

  return formatted.trim();
}

/**
 * Splits text into sequential chunks not exceeding maxLen (default: 4,000 characters).
 * Prefers splitting at paragraph boundaries (\n\n) or sentence boundaries (. / ! / ?)
 * to ensure no content is dropped or awkwardly truncated.
 */
export function splitWhatsAppMessage(text: string, maxLen: number = 4000): string[] {
  if (!text || text.length <= maxLen) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining.trim());
      break;
    }

    // Determine safe split point
    let splitIndex = -1;

    // Look for paragraph boundary within maxLen
    const paragraphBreak = remaining.lastIndexOf('\n\n', maxLen);
    if (paragraphBreak > maxLen * 0.4) {
      splitIndex = paragraphBreak;
    } else {
      // Look for single newline boundary
      const lineBreak = remaining.lastIndexOf('\n', maxLen);
      if (lineBreak > maxLen * 0.4) {
        splitIndex = lineBreak;
      } else {
        // Look for sentence boundary
        const sentenceMatch = remaining.substring(0, maxLen).match(/.*[.!?]\s+/);
        if (sentenceMatch && sentenceMatch[0].length > maxLen * 0.3) {
          splitIndex = sentenceMatch[0].length;
        } else {
          // Look for word boundary (space)
          const spaceBreak = remaining.lastIndexOf(' ', maxLen);
          if (spaceBreak > maxLen * 0.3) {
            splitIndex = spaceBreak;
          } else {
            // Hard cut if no natural boundary exists
            splitIndex = maxLen;
          }
        }
      }
    }

    const chunk = remaining.substring(0, splitIndex).trim();
    if (chunk) {
      chunks.push(chunk);
    }
    remaining = remaining.substring(splitIndex).trim();
  }

  return chunks;
}

/**
 * Sends a read receipt (blue ticks) and typing indicator for an incoming WhatsApp message.
 * Failures are logged safely and never interrupt message processing.
 */
export async function sendWhatsAppReadAndTyping(
  phoneNumberId: string,
  whatsappToken: string,
  messageId: string
): Promise<void> {
  if (!messageId) return;

  const url = `https://graph.facebook.com/v26.0/${phoneNumberId}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: messageId,
    typing_indicator: {
      type: 'text',
    },
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${whatsappToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.error(`[WhatsApp Read/Typing Error] HTTP ${res.status}: ${errBody.substring(0, 300)}`);
    }
  } catch (err: any) {
    console.error('[WhatsApp Read/Typing Network Error]', err?.message || 'Network request failed');
  }
}

/**
 * Sends a single text message through Meta WhatsApp Cloud API.
 */
export async function sendWhatsAppTextMessage(
  phoneNumberId: string,
  whatsappToken: string,
  to: string,
  bodyText: string
): Promise<{ success: boolean; status?: number; error?: string }> {
  const url = `https://graph.facebook.com/v26.0/${phoneNumberId}/messages`;

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: {
      preview_url: false,
      body: bodyText,
    },
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${whatsappToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      // Log failure safely without exposing the authorization token
      console.error(`[WhatsApp API Error] HTTP ${res.status}: ${errBody.substring(0, 300)}`);
      return { success: false, status: res.status, error: `WhatsApp API HTTP ${res.status}` };
    }

    return { success: true, status: res.status };
  } catch (err: any) {
    console.error('[WhatsApp API Network Error]', err?.message || 'Network request failed');
    return { success: false, error: err?.message || 'Network error' };
  }
}

/**
 * Calls Google Gemini REST API using the discovered model and system instruction.
 */
export async function callGeminiRestApi(
  apiKey: string,
  model: string,
  userMessage: string,
  systemInstruction: string
): Promise<{ success: boolean; text?: string; error?: string }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const requestBody = {
    contents: [
      {
        role: 'user',
        parts: [{ text: userMessage }],
      },
    ],
    systemInstruction: {
      parts: [{ text: systemInstruction }],
    },
    generationConfig: {
      temperature: 0.4,
    },
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(`[Gemini API Error] HTTP ${res.status}: ${errText.substring(0, 300)}`);
      return { success: false, error: `Gemini API returned HTTP ${res.status}` };
    }

    const data: any = await res.json();
    const candidateText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!candidateText || typeof candidateText !== 'string') {
      console.error('[Gemini API Error] Missing text in candidate response');
      return { success: false, error: 'Empty candidate text in Gemini response' };
    }

    return { success: true, text: candidateText };
  } catch (err: any) {
    console.error('[Gemini API Network Error]', err?.message || 'Network request failed');
    return { success: false, error: err?.message || 'Network error' };
  }
}

/**
 * Main Vercel Serverless Function Handler
 */
export default async function handler(req: any, res: any) {
  // 1. Method Routing
  if (req.method === 'GET') {
    // ---------------------------------------------------------
    // Meta Webhook Verification
    // ---------------------------------------------------------
    const mode = req.query?.['hub.mode'] || req.query?.hub_mode;
    const token = req.query?.['hub.verify_token'] || req.query?.hub_verify_token;
    const challenge = req.query?.['hub.challenge'] || req.query?.hub_challenge;

    const verifyToken = process.env.VERIFY_TOKEN;

    if (!verifyToken) {
      console.error('[Webhook Configuration] VERIFY_TOKEN environment variable is not configured.');
      return res.status(403).send('Forbidden: Webhook verification token not configured on server.');
    }

    if (mode === 'subscribe' && token === verifyToken) {
      // Plain text HTTP 200 with challenge
      res.setHeader('Content-Type', 'text/plain');
      return res.status(200).send(challenge);
    }

    console.error('[Webhook Verification Failed] Invalid verify token or mode.');
    return res.status(403).send('Forbidden');
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).send('Method Not Allowed');
  }

  // ---------------------------------------------------------
  // Handle Incoming WhatsApp POST Webhook Event
  // ---------------------------------------------------------
  try {
    const body = req.body;

    // Safely traverse Meta WhatsApp Cloud API payload structure
    const entry = body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    // 1. Check for status updates or empty messages and ignore them
    const messages = value?.messages;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      // Could be message status update (sent, delivered, read) or ephemeral ping
      return res.status(200).json({ status: 'ignored_status_update_or_empty' });
    }

    const incomingMsg = messages[0];
    const messageId = incomingMsg?.id;
    const sender = incomingMsg?.from;
    const messageType = incomingMsg?.type;

    if (!sender) {
      console.error('[Webhook Notice] Incoming message missing sender phone number.');
      return res.status(200).json({ status: 'ignored_missing_sender' });
    }

    // 2. Prevent Duplicate Replies using message ID
    if (messageId && isDuplicateMessage(messageId)) {
      return res.status(200).json({ status: 'duplicate_message_ignored' });
    }

    // 3. Validate Meta & Gemini Environment Variables
    const whatsappToken = process.env.WHATSAPP_TOKEN;
    const phoneNumberId = process.env.PHONE_NUMBER_ID;
    const geminiApiKey = process.env.GEMINI_API_KEY;

    if (!whatsappToken || !phoneNumberId || !geminiApiKey) {
      console.error(
        `[Webhook Configuration Error] Missing required environment variables:` +
          ` WHATSAPP_TOKEN=${Boolean(whatsappToken)},` +
          ` PHONE_NUMBER_ID=${Boolean(phoneNumberId)},` +
          ` GEMINI_API_KEY=${Boolean(geminiApiKey)}`
      );
      // Return 200 to prevent Meta from retrying broken delivery loop
      return res.status(200).json({ status: 'error_missing_server_configuration' });
    }

    // 4. Handle Non-Text Messages
    if (messageType !== 'text' || !incomingMsg.text?.body) {
      const fallbackReply = 'Please send your question as a text message.';
      await sendWhatsAppTextMessage(phoneNumberId, whatsappToken, sender, fallbackReply);
      return res.status(200).json({ status: 'handled_non_text' });
    }

    const userText = incomingMsg.text.body.trim();
    if (!userText) {
      const fallbackReply = 'Please send your question as a text message.';
      await sendWhatsAppTextMessage(phoneNumberId, whatsappToken, sender, fallbackReply);
      return res.status(200).json({ status: 'handled_empty_text' });
    }

    // 5. Send Blue Ticks + Typing Indicator (non-blocking on failure)
    if (messageId) {
      await sendWhatsAppReadAndTyping(phoneNumberId, whatsappToken, messageId);
    }

    // 6. Generate AI Response with Gemini using Authoritative Master System Prompt + WhatsApp Quality Standard
    const modelToUse = ACTIVE_GEMINI_MODEL;
    const whatsappSystemPrompt = `${MASTER_SYSTEM_PROMPT}\n\n${WHATSAPP_QUALITY_INSTRUCTIONS}`;
    const geminiResult = await callGeminiRestApi(
      geminiApiKey,
      modelToUse,
      userText,
      whatsappSystemPrompt
    );

    let replyText = '';
    if (geminiResult.success && geminiResult.text) {
      replyText = geminiResult.text;
    } else {
      // Safe fallback response upholding Zeeshan identity and AMAL support boundary
      replyText =
        "Hi! I'm Zeeshan from AMAL. I'm here to help with your GCSE, IGCSE and Cambridge O-Level queries. " +
        "If you have questions about our learning plans, weekly tuition timetable, Topic Tests or Mock Exams, please ask! " +
        "For urgent support, our team is also available at support@amalearning.space.";
    }

    // 7. Format Markdown for WhatsApp (*bold*, no raw markdown headers)
    const formattedReply = formatTextForWhatsApp(replyText);

    // 8. Split into sequential messages if reply exceeds 4,000 characters
    const messageChunks = splitWhatsAppMessage(formattedReply, 4000);

    // 9. Deliver replies sequentially
    for (const chunk of messageChunks) {
      if (chunk.trim()) {
        await sendWhatsAppTextMessage(phoneNumberId, whatsappToken, sender, chunk);
      }
    }

    return res.status(200).json({ status: 'delivered', chunksSent: messageChunks.length });
  } catch (err: any) {
    console.error('[Webhook Top-Level Handler Error]', err?.message || 'Unexpected exception');
    // Always acknowledge with 200 to prevent Meta retry storm on unhandled exceptions
    return res.status(200).json({ status: 'error_logged' });
  }
}
