/**
 * Meeting content is untrusted data. These patterns flag text that looks like
 * instructions aimed at an AI (prompt injection). Flagged text is still kept in
 * the transcript as conversation, but it can never become a task, decision or
 * an action the app takes.
 */
const INJECTION_PATTERNS: RegExp[] = [
  /\b(ignore|disregard|forget|override)\b[^.?!]{0,40}\b(previous|prior|above|earlier|all|your|system)\b[^.?!]{0,20}\b(instructions?|prompts?|rules|guidelines|directions)\b/i,
  /\b(reveal|print|show|output|repeat|leak)\b[^.?!]{0,30}\b(system prompt|your prompt|your instructions|hidden instructions)\b/i,
  /\b(you are now|from now on you are|act as|pretend to be)\b[^.?!]{0,40}\b(ai|assistant|model|system|admin)\b/i,
  /\b(email|e-mail|send|forward|upload|post|share|exfiltrate)\b[^.?!]{0,40}\b(transcript|recording|meeting data|all (the )?data|this meeting|meeting notes)\b[^.?!]{0,40}\b(to|at)\b[^.?!]{0,60}@/i,
  /\b(mark|set)\b[^.?!]{0,20}\b(all|every)\b[^.?!]{0,20}\b(tasks?|action items?)\b[^.?!]{0,20}\b(complete|completed|done|closed)\b/i,
  /\b(delete|erase|wipe|drop)\b[^.?!]{0,20}\b(all|every)\b[^.?!]{0,30}\b(meetings?|data|notes|tasks?|records|tables?)\b/i,
  /(^|\n|\s)(system|assistant|developer)\s*:\s*(new instructions|you must|ignore)/i,
  /<\/?\s*(transcript|system|instructions?|screen_context)\s*>/i,
  /\bnew instructions?\s*:/i,
  /\b(ai|assistant|bot|note[- ]?taker)\b[^.?!]{0,20}\b(must|should|needs to)\b[^.?!]{0,40}\b(email|send|forward|delete|approve|mark)\b/i,
];

export function looksLikeInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((re) => re.test(text));
}

export function findInjectionSegments(segments: readonly { id: string; text: string }[]): string[] {
  return segments.filter((s) => looksLikeInjection(s.text)).map((s) => s.id);
}

/**
 * Neutralize tag-like sequences so untrusted text cannot close the data
 * delimiters used in model prompts.
 */
export function escapeForPrompt(text: string): string {
  return text.replace(/</g, '‹').replace(/>/g, '›');
}
