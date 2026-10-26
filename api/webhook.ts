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

/**
 * Formats standard Markdown for WhatsApp readability:
 * - Converts markdown bold **text** to WhatsApp bold *text*
 * - Removes markdown heading hashes (#, ##, ###) while preserving the text
 * - Cleans excessive markdown syntax while preserving bullets and spacing
 */
export function formatTextForWhatsApp(text: string): string {
  if (!text) return '';

  let formatted = text;

  // 1. Remove markdown heading hashes (# Title -> Title, ## Subtitle -> Subtitle)
  formatted = formatted.replace(/^#{1,6}\s+(.+)$/gm, '*$1*');

  // 2. Convert markdown bold **bold** to WhatsApp *bold*
  // Avoid replacing if it's already a single asterisk or bullet
  formatted = formatted.replace(/\*\*(.*?)\*\*/g, '*$1*');

  // 3. Remove markdown horizontal rules (--- or ***)
  formatted = formatted.replace(/^[*-]{3,}$/gm, '');

  // 4. Remove markdown italics like _text_ or *text* inside already bold sections
  // Standardize bullet points
  formatted = formatted.replace(/^\s*[-+]\s+/gm, '• ');

  // 5. Clean up multiple consecutive empty lines (max 2)
  formatted = formatted.replace(/\n{3,}/g, '\n\n');

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
 * Sends a single text message through Meta WhatsApp Cloud API.
 */
export async function sendWhatsAppTextMessage(
  phoneNumberId: string,
  whatsappToken: string,
  to: string,
  bodyText: string
): Promise<{ success: boolean; status?: number; error?: string }> {
  const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;

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

    // 5. Generate AI Response with Gemini using Authoritative Master System Prompt
    const modelToUse = ACTIVE_GEMINI_MODEL;
    const geminiResult = await callGeminiRestApi(
      geminiApiKey,
      modelToUse,
      userText,
      MASTER_SYSTEM_PROMPT
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

    // 6. Format Markdown for WhatsApp (*bold*, no raw markdown headers)
    const formattedReply = formatTextForWhatsApp(replyText);

    // 7. Split into sequential messages if reply exceeds 4,000 characters
    const messageChunks = splitWhatsAppMessage(formattedReply, 4000);

    // 8. Deliver replies sequentially
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
