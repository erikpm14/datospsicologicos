const logger = require('./logger');

function preview(text, max = 240) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function stripBom(text = '') {
  return String(text || '').replace(/^\uFEFF/, '');
}

function stripCodeFences(text = '') {
  return String(text || '')
    .replace(/```(?:json|javascript|js)?/gi, '')
    .replace(/```/g, '')
    .trim();
}

function removeTrailingCommas(text = '') {
  return String(text || '').replace(/,\s*([}\]])/g, '$1');
}

function escapeStringWhitespace(text = '') {
  let out = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        out += ch;
        escaped = false;
        continue;
      }

      if (ch === '\\') {
        out += ch;
        escaped = true;
        continue;
      }

      if (ch === '"') {
        out += ch;
        inString = false;
        continue;
      }

      if (ch === '\n') {
        out += '\\n';
        continue;
      }

      if (ch === '\r') {
        out += '\\r';
        continue;
      }

      if (ch === '\t') {
        out += '\\t';
        continue;
      }

      out += ch;
      continue;
    }

    if (ch === '"') inString = true;
    out += ch;
  }

  return out;
}

function sanitizeJsonText(text = '') {
  return escapeStringWhitespace(
    removeTrailingCommas(
      stripCodeFences(
        stripBom(
          String(text || '')
            .replace(/[\u201C\u201D]/g, '"')
            .replace(/[\u2018\u2019]/g, "'")
            .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ''),
        ),
      ),
    ),
  ).trim();
}

function extractFirstJsonBlock(text = '') {
  const input = String(text || '');
  const start = input.search(/[\[{]/);
  if (start === -1) return '';

  const stack = [];
  let inString = false;
  let escaped = false;

  for (let i = start; i < input.length; i += 1) {
    const ch = input[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') {
      if (stack[stack.length - 1] === ch) stack.pop();
      if (stack.length === 0) return input.slice(start, i + 1);
    }
  }

  return input.slice(start).trim();
}

function detectTruncation(text = '') {
  const input = String(text || '').trim();
  if (!input) return false;
  if (/```(?:json|javascript|js)?\s*$/i.test(input)) return true;
  if (/[,{[]\s*$/.test(input)) return true;
  if (/:\\?\s*$/.test(input)) return true;
  const quoteCount = (input.match(/(?<!\\)"/g) || []).length;
  return quoteCount % 2 === 1;
}

function buildParseCandidates(rawText = '') {
  const raw = String(rawText || '');
  const noBom = stripBom(raw);
  const stripped = stripCodeFences(noBom);
  const extractedFromRaw = extractFirstJsonBlock(noBom);
  const extractedFromStripped = extractFirstJsonBlock(stripped);

  return [
    ['extracted_raw', extractedFromRaw],
    ['extracted_raw_sanitized', sanitizeJsonText(extractedFromRaw)],
    ['extracted_stripped', extractedFromStripped],
    ['extracted_stripped_sanitized', sanitizeJsonText(extractedFromStripped)],
    ['stripped_sanitized', sanitizeJsonText(stripped)],
    ['raw_sanitized', sanitizeJsonText(noBom)],
  ];
}

function parseAttempt(text, label, stage) {
  try {
    return { ok: true, value: JSON.parse(text), stage };
  } catch (error) {
    logger.warn(`${label}: JSON parse retry failed at ${stage} (${error.message})`);
    return { ok: false, error, stage };
  }
}

function parseModelJson(rawText, { label = 'llm-json' } = {}) {
  const raw = String(rawText || '');
  if (!raw.trim()) throw new Error(`${label}: empty model response`);
  const truncated = detectTruncation(raw);

  const attempts = [];
  const seen = new Set();

  for (const [stage, candidate] of buildParseCandidates(raw)) {
    const text = String(candidate || '').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    const result = parseAttempt(text, label, stage);
    attempts.push(result);
    if (result.ok) {
      return {
        data: result.value,
        meta: {
          llm_parse_fail: attempts.length > 1,
          llm_recovery_used: false,
          llm_truncated_suspected: truncated,
          parseStage: result.stage,
          attempts: attempts.length,
        },
      };
    }
  }

  const candidatePreview = preview(extractFirstJsonBlock(stripCodeFences(stripBom(raw))), 400);
  const lastError = attempts.at(-1)?.error || new Error('unknown JSON parse error');
  logger.error(
    `${label}: JSON parse failed | raw="${preview(raw, 400)}" | candidate="${candidatePreview}" | error=${lastError.message}`,
  );

  const error = new Error(`${label}: invalid JSON from model (${lastError.message})`);
  error.rawPreview = preview(raw, 400);
  error.candidatePreview = candidatePreview;
  error.llm_parse_fail = true;
  error.llm_truncated_suspected = truncated;
  throw error;
}

function validateParsedJson(data, { label = 'llm-json', validate = null, stage = 'initial' } = {}) {
  if (typeof validate !== 'function') return data;
  try {
    return validate(data);
  } catch (error) {
    error.llm_schema_fail = true;
    logger.warn(`${label}: schema validation failed at ${stage} (${error.message})`);
    throw error;
  }
}

async function parseModelJsonWithRecovery(rawText, {
  label = 'llm-json',
  recover = null,
  validate = null,
} = {}) {
  try {
    const parsed = parseModelJson(rawText, { label });
    return {
      data: validateParsedJson(parsed.data, { label, validate, stage: parsed.meta.parseStage || 'initial' }),
      meta: {
        ...parsed.meta,
        llm_schema_fail: false,
      },
    };
  } catch (error) {
    logger.warn(`${label}: parse/schema failed, attempting JSON recovery`);
    if (typeof recover !== 'function') throw error;

    try {
      const recoveredRaw = await recover(rawText, error);
      const recoveredText = String(recoveredRaw || '').trim();
      if (!recoveredText) throw error;

      logger.warn(`${label}: recovery response received, retrying parse`);
      const parsed = parseModelJson(recoveredText, { label: `${label}.recovery` });
      return {
        data: validateParsedJson(parsed.data, { label, validate, stage: `${parsed.meta.parseStage || 'recovery'}.recovery` }),
        meta: {
          ...parsed.meta,
          llm_parse_fail: true,
          llm_recovery_used: true,
          llm_schema_fail: Boolean(error.llm_schema_fail),
          llm_truncated_suspected: Boolean(error.llm_truncated_suspected || parsed.meta.llm_truncated_suspected),
        },
      };
    } catch (recoveryError) {
      recoveryError.llm_hard_fail = true;
      throw recoveryError;
    }
  }
}

module.exports = {
  parseModelJson,
  parseModelJsonWithRecovery,
  stripBom,
  stripCodeFences,
  extractFirstJsonBlock,
  removeTrailingCommas,
};
