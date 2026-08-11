/** Normalize employer question for matching / logging (S5a). */

export function normalizeQuestion(q: string): string {
  return q
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/["'`]+/g, '')
    .replace(/[?!.]+$/g, '')
    .trim();
}
