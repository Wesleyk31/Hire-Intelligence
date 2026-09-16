/** Restrictions remain attached to evidence until a reviewed upstream correction. */
export function evidenceHoldReasons(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return ['MALFORMED_EVIDENCE'];
  const row = value as Record<string, unknown>,
    reasons: string[] = [];
  if (row.contextOnly === true) reasons.push('CONTEXT_ONLY');
  if (row.promotionEligible === false) reasons.push('NOT_PROMOTION_ELIGIBLE');
  if (
    (row.contextOnly !== undefined && typeof row.contextOnly !== 'boolean') ||
    (row.promotionEligible !== undefined &&
      typeof row.promotionEligible !== 'boolean')
  )
    reasons.push('MALFORMED_PROMOTION_RESTRICTION');
  if (row.qualityFlags !== undefined) {
    if (!Array.isArray(row.qualityFlags))
      reasons.push('MALFORMED_QUALITY_FLAGS');
    else
      for (const flag of row.qualityFlags) {
        if (typeof flag !== 'string') reasons.push('MALFORMED_QUALITY_FLAGS');
        else if (flag.trim()) reasons.push(flag.trim().slice(0, 200));
        else reasons.push('MALFORMED_QUALITY_FLAGS');
      }
  }
  return [...new Set(reasons)].sort();
}
export const isEvidenceEligible = (value: unknown) =>
  evidenceHoldReasons(value).length === 0;
