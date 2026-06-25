const { GoogleGenerativeAI } = require("@google/generative-ai");
const { normalizeUserSettings } = require("../settings/settings.utils.js");
const { classifyIntent, DIRECT_INTENTS } = require("./chat.intent.service.js");
const {
    appendChatTurn,
    buildAssistantPromptContext,
    getChatHistory,
    resolveDirectChatReply,
} = require("./chat.service.js");

const MAX_CHAT_MESSAGE_LENGTH = Number(process.env.CHAT_MESSAGE_MAX_LENGTH || 500);

const normalizeIncomingMessage = (value) =>
    String(value || "").replace(/\s+/g, " ").trim();

// Write a single SSE event to the response and flush immediately
const sendEvent = (res, data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    // Flush the write buffer so the token reaches the browser immediately
    if (typeof res.flush === 'function') res.flush();
};

const financeBuddyChatStream = async (req, res) => {
    // Set SSE headers immediately and flush — client starts receiving right away
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering if behind proxy
    res.flushHeaders();

    // Keep connection alive with a heartbeat comment every 20s
    const heartbeat = setInterval(() => {
        if (!res.writableEnded) res.write(": heartbeat\n\n");
    }, 20000);

    const cleanup = () => {
        clearInterval(heartbeat);
    };

    req.on("close", cleanup);

    const { message, language } = req.body || {};
    const normalizedMessage = normalizeIncomingMessage(message);
    const selectedLanguage = language === "hinglish" ? "hinglish" : "english";

    try {
        const userId = req.user?.id;
        const timeZone = normalizeUserSettings(req.user?.settings || {}).timezone;

        if (!userId) {
            sendEvent(res, { type: "error", message: "User not found" });
            cleanup();
            return res.end();
        }

        if (!normalizedMessage) {
            sendEvent(res, { type: "error", message: "Message cannot be empty" });
            cleanup();
            return res.end();
        }

        if (normalizedMessage.length > MAX_CHAT_MESSAGE_LENGTH) {
            sendEvent(res, {
                type: "error",
                message: `Message must stay under ${MAX_CHAT_MESSAGE_LENGTH} characters`,
            });
            cleanup();
            return res.end();
        }

        const history = await getChatHistory(userId);

        // ── LLM Intent Classification (replaces regex routing) ───────────────────
        // Classify the message first. Returns a label like 'expense_total', 'advice', etc.
        // Falls back to null on error → resolveDirectChatReply uses regex as safety net.
        const llmIntent = await classifyIntent(normalizedMessage, history);
        console.log(`[IntentRouter] "${normalizedMessage}" → ${llmIntent ?? "regex-fallback"}`);

        // ── Direct intent path (instant DB answer) ───────────────────────────────
        // Skip entirely if LLM said advice — don't waste time running regex
        let directReply = null;
        if (llmIntent !== "advice") {
            directReply = await resolveDirectChatReply({
                userId,
                message: normalizedMessage,
                language: selectedLanguage,
                timeZone,
                history,
                intentOverride: llmIntent, // pass LLM label; null means regex runs inside
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

            // Send entire direct reply as a single token event then done
            sendEvent(res, { type: "token", token: directReply.reply });
            sendEvent(res, {
                type: "done",
                mode: directReply.mode,
                source: directReply.source,
                intent: directReply.intent,
                rangeKey: directReply.rangeKey,
                rangeLabel: directReply.rangeLabel,
            });
            cleanup();
            return res.end();
        }

        // ── Assistant path — stream tokens from Gemini ───────────────────────────
        const assistantContext = await buildAssistantPromptContext({
            userId,
            message: normalizedMessage,
            language: selectedLanguage,
            timeZone,
            history,
        });

        // Use the official Google Generative AI SDK for clean streaming
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({
            model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
        });

        let fullReply = "";

        try {
            const result = await model.generateContentStream({
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
            });

            // Stream every token chunk as it arrives
            for await (const chunk of result.stream) {
                const token = chunk.text();
                if (token) {
                    fullReply += token;
                    sendEvent(res, { type: "token", token });
                }
            }
        } catch (streamError) {
            // Gemini failed — fall back to the pre-built fallback reply
            console.error("Gemini stream error:", streamError?.message || streamError);
            const fallbackReply =
                assistantContext.errorFallbackReply ||
                assistantContext.fallbackReply ||
                "Finance Buddy is temporarily unavailable. Please try again in a moment.";

            fullReply = fallbackReply;
            sendEvent(res, { type: "token", token: fallbackReply });
            sendEvent(res, {
                type: "done",
                mode: assistantContext.mode,
                source: assistantContext.source,
                intent: assistantContext.intent,
                rangeKey: assistantContext.rangeKey,
                rangeLabel: assistantContext.rangeLabel,
                fallback: true,
            });
            cleanup();
            return res.end();
        }

        // If Gemini returned nothing, use fallback
        if (!fullReply.trim()) {
            fullReply =
                assistantContext.coachFallbackReply ||
                assistantContext.fallbackReply ||
                "I couldn't generate a response. Please try rephrasing your question.";
            sendEvent(res, { type: "token", token: fullReply });
        }

        // Save the full assembled reply to chat history
        await appendChatTurn({
            userId,
            userMessage: normalizedMessage,
            assistantReply: fullReply.trim(),
            language: selectedLanguage,
            mode: assistantContext.mode,
            meta: {
                source: assistantContext.source,
                intent: assistantContext.intent,
                rangeKey: assistantContext.rangeKey,
                rangeLabel: assistantContext.rangeLabel,
                category: assistantContext.category,
                resolvedContext: assistantContext.resolvedContext,
            },
        });

        // Final done event with metadata
        sendEvent(res, {
            type: "done",
            mode: assistantContext.mode,
            source: assistantContext.source,
            intent: assistantContext.intent,
            rangeKey: assistantContext.rangeKey,
            rangeLabel: assistantContext.rangeLabel,
            fallback: false,
        });

        cleanup();
        res.end();
    } catch (err) {
        console.error("Chat stream handler error:", err?.message || err);
        if (!res.writableEnded) {
            sendEvent(res, {
                type: "error",
                message: "Something went wrong. Please try again.",
            });
            cleanup();
            res.end();
        }
    }
};

module.exports = { financeBuddyChatStream };
