const axios = require("axios");
const {
  getGeminiTextParts,
  getGeminiUrl,
  isGeminiQuotaError,
  logGeminiError,
} = require("../ai/gemini.client.js");
const { normalizeUserSettings } = require("../settings/settings.utils.js");
const { classifyIntent } = require("./chat.intent.service.js");
const {
  appendChatTurn,
  buildAssistantPromptContext,
  getChatHistory,
  resolveDirectChatReply,
} = require("./chat.service.js");

const MAX_CHAT_MESSAGE_LENGTH = Number(
  process.env.CHAT_MESSAGE_MAX_LENGTH || 500
);

const normalizeIncomingMessage = (value) =>
  String(value || "").replace(/\s+/g, " ").trim();

const buildChatReplyFromGemini = (responseData) => {
  const textParts = getGeminiTextParts(responseData);

  if (!textParts.length) {
    return "";
  }

  return textParts
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;!?])/g, "$1")
    .trim();
};

const hasCleanFinishReason = (responseData) => {
  const finishReason = String(
    responseData?.candidates?.[0]?.finishReason || ""
  ).trim().toUpperCase();

  return (
    !finishReason ||
    finishReason === "STOP" ||
    finishReason === "FINISH_REASON_UNSPECIFIED"
  );
};

const isSuspiciouslyIncompleteReply = (replyText, responseData) => {
  const normalizedReply = String(replyText || "").replace(/\s+/g, " ").trim();

  if (!normalizedReply) {
    return true;
  }

  if (!hasCleanFinishReason(responseData)) {
    return true;
  }

  if (/[,:;\-]$/.test(normalizedReply)) {
    return true;
  }

  const words = normalizedReply.split(/\s+/).filter(Boolean);

  if (words.length >= 5 && /\b(and|but|because|so|that|which|you|your|have|with|about|to|for|this|my|our)$/i.test(normalizedReply)) {
    return true;
  }

  return false;
};

const buildFallbackMeta = (assistantContext) => ({
  source: assistantContext?.source || "assistant",
  intent: assistantContext?.intent || "assistant_coaching",
  rangeKey: assistantContext?.rangeKey || "this_month",
  rangeLabel: assistantContext?.rangeLabel || "this month",
  category: assistantContext?.category || null,
  resolvedContext: assistantContext?.resolvedContext || {
    intent: "assistant",
    rangeKey: "this_month",
    category: null,
  },
  fallback: true,
});

const financeBuddyChat = async (req, res) => {
  const { message, language } = req.body || {};
  let assistantContext = null;

  try {
    const userId = req.user?.id;
    const normalizedMessage = normalizeIncomingMessage(message);
    const selectedLanguage = language === "hinglish" ? "hinglish" : "english";
    const timeZone = normalizeUserSettings(req.user?.settings || {}).timezone;

    if (!userId) {
      return res.status(400).json({ message: "User ID not found" });
    }

    if (!normalizedMessage) {
      return res.status(400).json({ message: "Message cannot be empty" });
    }

    if (normalizedMessage.length > MAX_CHAT_MESSAGE_LENGTH) {
      return res.status(400).json({
        message: `Message must stay under ${MAX_CHAT_MESSAGE_LENGTH} characters`,
      });
    }

    const history = await getChatHistory(userId);

    // ── LLM Intent Classification (replaces regex routing) ───────────────────
    const llmIntent = await classifyIntent(normalizedMessage, history);
    console.log(`[IntentRouter - Sync] "${normalizedMessage}" → ${llmIntent ?? "regex-fallback"}`);

    let directReply = null;
    if (llmIntent !== "advice") {
      directReply = await resolveDirectChatReply({
        userId,
        message: normalizedMessage,
        language: selectedLanguage,
        timeZone,
        history,
        intentOverride: llmIntent,
      });
    }

    if (directReply) {
      await appendChatTurn({
        userId,
        userMessage: normalizedMessage,
        assistantReply: directReply.reply,
        language: selectedLanguage,
        mode: directReply.mode,
        meta: {
          source: directReply.source,
          intent: directReply.intent,
          rangeKey: directReply.rangeKey,
          rangeLabel: directReply.rangeLabel,
          category: directReply.category,
          resolvedContext: directReply.resolvedContext,
        },
      });

      return res.json({
        success: true,
        reply: directReply.reply,
        userMessage: normalizedMessage,
        mode: directReply.mode,
        source: directReply.source,
        intent: directReply.intent,
        rangeKey: directReply.rangeKey,
        rangeLabel: directReply.rangeLabel,
      });
    }

    assistantContext = await buildAssistantPromptContext({
      userId,
      message: normalizedMessage,
      language: selectedLanguage,
      timeZone,
      history,
    });

    const response = await axios.post(
      getGeminiUrl(),
      {
        contents: [
          {
            role: "user",
            parts: [{ text: assistantContext.prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.35,
          topK: 24,
          topP: 0.9,
          maxOutputTokens: 700,
        },
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    const rawBotReply = buildChatReplyFromGemini(response.data);
    const usedCoachFallback = isSuspiciouslyIncompleteReply(
      rawBotReply,
      response.data
    );
    const botReply = usedCoachFallback
      ? assistantContext.coachFallbackReply || assistantContext.fallbackReply
      : rawBotReply;

    await appendChatTurn({
      userId,
      userMessage: normalizedMessage,
      assistantReply: botReply.trim(),
      language: selectedLanguage,
      mode: assistantContext.mode,
      meta: {
        source: assistantContext.source,
        intent: assistantContext.intent,
        rangeKey: assistantContext.rangeKey,
        rangeLabel: assistantContext.rangeLabel,
        category: assistantContext.category,
        resolvedContext: assistantContext.resolvedContext,
        fallback: usedCoachFallback,
      },
    });

    return res.json({
      success: true,
      reply: botReply.trim(),
      userMessage: normalizedMessage,
      mode: assistantContext.mode,
      source: assistantContext.source,
      intent: assistantContext.intent,
      rangeKey: assistantContext.rangeKey,
      rangeLabel: assistantContext.rangeLabel,
      fallback: usedCoachFallback,
    });
  } catch (err) {
    const normalizedMessage = normalizeIncomingMessage(message);
    const selectedLanguage = language === "hinglish" ? "hinglish" : "english";

    if (isGeminiQuotaError(err)) {
      logGeminiError("Finance Buddy Chat quota fallback", err);
      const fallbackReply =
        assistantContext?.errorFallbackReply ||
        assistantContext?.fallbackReply ||
        "Finance Buddy is temporarily unavailable because the AI limit has been reached. Please try again in a few minutes.";

      if (req.user?.id) {
        await appendChatTurn({
          userId: req.user.id,
          userMessage: normalizedMessage,
        assistantReply: fallbackReply,
          language: selectedLanguage,
          mode: assistantContext?.mode || "assistant",
          meta: buildFallbackMeta(assistantContext),
        });
      }

      return res.status(200).json({
        success: true,
        reply: fallbackReply,
        userMessage: normalizedMessage,
        mode: assistantContext?.mode || "assistant",
        source: assistantContext?.source || "assistant",
        intent: assistantContext?.intent || "assistant_coaching",
        rangeKey: assistantContext?.rangeKey || "this_month",
        rangeLabel: assistantContext?.rangeLabel || "this month",
        fallback: true,
      });
    }

    if (assistantContext) {
      logGeminiError("Finance Buddy Chat assistant fallback", err);

      await appendChatTurn({
        userId: req.user.id,
        userMessage: normalizedMessage,
        assistantReply:
          assistantContext.errorFallbackReply || assistantContext.fallbackReply,
        language: selectedLanguage,
        mode: assistantContext.mode,
        meta: buildFallbackMeta(assistantContext),
      });

      return res.status(200).json({
        success: true,
        reply:
          assistantContext.errorFallbackReply || assistantContext.fallbackReply,
        userMessage: normalizedMessage,
        mode: assistantContext.mode,
        source: assistantContext.source,
        intent: assistantContext.intent,
        rangeKey: assistantContext.rangeKey,
        rangeLabel: assistantContext.rangeLabel,
        fallback: true,
      });
    }

    logGeminiError("Finance Buddy Chat error", err);
    return res.status(500).json({
      message: "Something went wrong. Please try again later.",
      success: false,
    });
  }
};

module.exports = {
  financeBuddyChat,
};
