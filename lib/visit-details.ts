// Small pure helpers for message text about a visit (no server imports, so they can be tested on their own).

/** The tests on a request — H360 catalog picks first, then typed ones — without duplicates. */
export function requestTests(r: { testItems?: { name?: string | null }[] | null; tests?: (string | null)[] | null }): string[] {
  return [...new Set([...(r.testItems ?? []).map((t) => t?.name), ...(r.tests ?? [])].map((x) => String(x ?? '').trim()).filter(Boolean))]
}

/**
 * Bring a waiting WhatsApp text up to date with the visit (used for drafts written before a test / UHID was added):
 *  · "Tests: …" is replaced, or inserted after the "Service:" line, or removed when the visit has no tests;
 *  · "UHID: …" is inserted after the first "Patient:" line when the text has no UHID yet.
 * Texts without a Service / Patient line (car times, bills…) come back unchanged. Running it twice changes nothing.
 */
export function withVisitDetails(text: string, v: { tests: string[]; uhid?: string | null }): string {
  const lines = text.split('\n')
  const tests = v.tests.join(', ')
  const ti = lines.findIndex((l) => /^Tests:/.test(l))
  if (ti >= 0) {
    if (tests) lines[ti] = `Tests: ${tests}`
    else lines.splice(ti, 1)
  } else if (tests) {
    const si = lines.findIndex((l) => /^Service:/.test(l))
    if (si >= 0) lines.splice(si + 1, 0, `Tests: ${tests}`)
  }
  const uhid = String(v.uhid ?? '').trim()
  if (uhid && !/UHID/i.test(text)) {
    const pi = lines.findIndex((l) => /^Patient:/.test(l))
    if (pi >= 0) lines.splice(pi + 1, 0, `UHID: ${uhid}`)
  }
  return lines.join('\n')
}
