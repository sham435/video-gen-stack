// Structured JSON validation for LLM outputs.
//
// The provider layer may hand back a raw string (prompt echo, markdown fenced
// block, truncated JSON). This module parses, validates against an expected
// schema, retries once with a correction request, and throws when the output
// is still invalid. It never silently returns a malformed object.

export class StructuredParseError extends Error {
  constructor(message, detail = {}) {
    super(message)
    this.name = 'StructuredParseError'
    this.code = 'STRUCTURED_PARSE_ERROR'
    this.detail = detail
  }
}

// Strip markdown code fences and stray prose around a JSON payload.
export function extractJson(text) {
  if (typeof text !== 'string') return text
  let t = text.trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) t = fence[1].trim()
  const start = t.search(/[[{]/)
  if (start === -1) return t
  return t.slice(start)
}

// Validate `value` against a plain shape definition.
// schema examples:
//   { title: 'string' }
//   { scenes: 'array' }                 → scenes must be an array
//   { 'scenes[]': 'object' }            → each element of scenes must be an object
//   { 'scenes[].duration': 'number' }   → each scenes[i].duration must be a number
export function validateSchema(value, schema = {}) {
  const errors = []
  for (const [key, type] of Object.entries(schema)) {
    const bracket = key.match(/^([^[\]]+)(\[\])(?:\.(.*))?$/)
    if (bracket) {
      const parent = bracket[1]
      const child = bracket[3] || ''
      const list = value?.[parent]
      if (!Array.isArray(list)) {
        errors.push(`missing array "${parent}"`)
        continue
      }
      for (let i = 0; i < list.length; i++) {
        const item = list[i]
        if (child) {
          if (!matchesType(item?.[child], type)) {
            errors.push(`${parent}[${i}].${child} expected ${type}`)
          }
        } else if (!matchesType(item, type)) {
          errors.push(`${parent}[${i}] expected ${type}`)
        }
      }
      continue
    }
    if (!matchesType(value?.[key], type)) {
      errors.push(`"${key}" expected ${type}, got ${typeName(value?.[key])}`)
    }
  }
  return errors
}

function matchesType(v, type) {
  switch (type) {
    case 'string': return typeof v === 'string'
    case 'number': return typeof v === 'number' && Number.isFinite(v)
    case 'boolean': return typeof v === 'boolean'
    case 'array': return Array.isArray(v)
    case 'object': return v !== null && typeof v === 'object' && !Array.isArray(v)
    case 'any': return v !== undefined
    default: return true
  }
}

function typeName(v) {
  if (Array.isArray(v)) return 'array'
  if (v === null) return 'null'
  return typeof v
}

// Parse JSON, validate against schema, retry once via `correct`, throw on
// failure. `generate` is the LLM call; `correct` is a callback that produces
// a corrective prompt (or returns the corrected content).
export async function parseStructured(content, options = {}) {
  const {
    schema = {},
    generate,
    correct,
    attempts = 1,
  } = options

  const parse = (raw) => {
    // Providers may already return a parsed object (json:true pre-parses).
    // Validate it directly; only strings go through JSON extraction/parse.
    const extracted = extractJson(raw)
    let parsed
    if (extracted !== null && typeof extracted === 'object') {
      parsed = extracted
    } else {
      try {
        parsed = JSON.parse(extracted)
      } catch (err) {
        throw new StructuredParseError(`Invalid JSON: ${err.message}`, { raw: String(raw).slice(0, 300) })
      }
    }
    const errors = validateSchema(parsed, schema)
    if (errors.length) {
      throw new StructuredParseError(`Schema mismatch: ${errors.join('; ')}`, { parsed, errors })
    }
    return parsed
  }

  let raw = content
  for (let i = 0; i <= attempts; i++) {
    try {
      return parse(raw)
    } catch (err) {
      const isLastAttempt = i === attempts
      if (isLastAttempt) throw err
      if (!generate || !correct) throw err
      const prompt = correct(err.detail || err)
      const retryContent = await generate(prompt, { retryAttempt: i + 1 })
      raw = typeof retryContent === 'string' ? retryContent : JSON.stringify(retryContent)
    }
  }
  throw new StructuredParseError('unreachable')
}