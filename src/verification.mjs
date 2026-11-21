// A heading or generic completion message is not a verification report.
export function hasVerificationReport(value) {
  if (typeof value !== 'string') return false;
  const body = value.split(/\r?\n/).filter(line => !/^\s*(?:#{1,6}\s|[-=_]{3,}\s*$)/.test(line)).join('\n').trim();
  return body.length >= 40 && !/^(?:verify|verification)(?:\s+report)?\s*:[^\n]*$|^(?:completed?|done|success)[.!]?$/i.test(body);
}
