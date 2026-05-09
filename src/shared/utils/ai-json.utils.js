const stripCodeFences = (text = "") =>
    String(text)
        .replace(/^\s*```(?:json)?\s*/i, "")
        .replace(/\s*```\s*$/i, "")
        .trim();

const sanitizeJSONText = (text = "") =>
    stripCodeFences(text)
        .replace(/^\uFEFF/, "")
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[â€œâ€]/g, '"')
        .replace(/[â€˜â€™]/g, "'")
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

const extractFirstJSONObjectString = (text = "") => {
    const cleanText = sanitizeJSONText(text);
    const firstOpen = cleanText.indexOf("{");

    if (firstOpen === -1) {
        throw new Error("No JSON object found in response");
    }

    let braceCount = 0;
    let inString = false;
    let escapeNext = false;

    for (let index = firstOpen; index < cleanText.length; index += 1) {
        const char = cleanText[index];

        if (escapeNext) {
            escapeNext = false;
            continue;
        }

        if (char === "\\") {
            escapeNext = true;
            continue;
        }

        if (char === '"') {
            inString = !inString;
            continue;
        }

        if (!inString) {
            if (char === "{") {
                braceCount += 1;
            } else if (char === "}") {
                braceCount -= 1;

                if (braceCount === 0) {
                    return cleanText.substring(firstOpen, index + 1);
                }
            }
        }
    }

    throw new Error("Could not find complete JSON object");
};

const parseAIJSON = (text = "") => {
    const candidates = [];

    const addCandidate = (value) => {
        const normalized = sanitizeJSONText(value);

        if (normalized && !candidates.includes(normalized)) {
            candidates.push(normalized);
        }
    };

    addCandidate(text);

    try {
        addCandidate(extractFirstJSONObjectString(text));
    } catch (error) {
        // Ignore and keep trying the remaining candidates.
    }

    const strippedText = stripCodeFences(text);
    if (strippedText !== text) {
        addCandidate(strippedText);

        try {
            addCandidate(extractFirstJSONObjectString(strippedText));
        } catch (error) {
            // Ignore and keep trying the remaining candidates.
        }
    }

    const expandedCandidates = [];
    candidates.forEach((candidate) => {
        if (!expandedCandidates.includes(candidate)) {
            expandedCandidates.push(candidate);
        }

        const withoutTrailingCommas = candidate.replace(/,\s*([}\]])/g, "$1");
        if (
            withoutTrailingCommas !== candidate &&
            !expandedCandidates.includes(withoutTrailingCommas)
        ) {
            expandedCandidates.push(withoutTrailingCommas);
        }
    });

    let lastError = new Error("No parseable JSON found in AI response");

    for (const candidate of expandedCandidates) {
        try {
            const parsed = JSON.parse(candidate);

            if (Array.isArray(parsed)) {
                if (parsed[0] && typeof parsed[0] === "object") {
                    return parsed[0];
                }

                throw new Error("AI response JSON array did not contain an object");
            }

            if (parsed && typeof parsed === "object") {
                return parsed;
            }

            throw new Error("AI response JSON was not an object");
        } catch (error) {
            lastError = error;
        }
    }

    throw new Error(`Failed to parse AI JSON: ${lastError.message}`);
};

module.exports = {
    stripCodeFences,
    sanitizeJSONText,
    extractFirstJSONObjectString,
    parseAIJSON,
};
