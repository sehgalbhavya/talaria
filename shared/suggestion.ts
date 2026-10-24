// Hermes's suggested answers must be the answer itself, in the candidate's voice. When it can't write one
// honestly it sometimes writes advice instead ("State your sponsorship need…"); that is not a suggestion.
const ADVICE = /^\s*(?:if (?:you|there)\b|(?:please |briefly |simply |just )?(?:state|say|describe|explain|mention|give|list|include|add|note|provide|tell|share|specify|confirm|answer|write|outline|highlight|clarify|detail|name|consider|be\b|keep|use)\b)/i;

/** The suggestion if it reads as an answer; undefined when it's an instruction about what to write. */
export function usableSuggestion(s?: string): string | undefined {
  const t = (s || '').trim();
  return t && !ADVICE.test(t) ? t : undefined;
}
