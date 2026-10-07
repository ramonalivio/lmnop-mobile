/** Formatting only: preserve values and require explicit clinical/unit context. */
export function normalizeClinicalText(text: string): string {
  return text
    .replace(/\b(\d+(?:\.\d+)?)\s+milligrams?\b/gi, '$1mg')
    .replace(
      /\b(\d+(?:\.\d+)?)\s+(?:degrees?\s+)?(celsius|fahrenheit)\b/gi,
      (_, value: string, unit: string) =>
        `${value}\u00b0${unit.toLowerCase() === 'celsius' ? 'C' : 'F'}`,
    )
    .replace(
      /\b(\d+(?:\.\d+)?)\s+degrees?\s+([cf])\b/gi,
      (_, value: string, unit: string) => `${value}\u00b0${unit.toUpperCase()}`,
    )
    .replace(/\b(\d+(?:\.\d+)?)[\s-]+years?[\s-]+old\b/gi, '$1-year-old')
    .replace(
      /(\b(?:blood\s+pressure|bp)\s*(?:(?:is|was|of|at)\s+)?[:=]?\s*)(\d{2,3})\s+over\s+(\d{2,3})\b/gi,
      '$1$2/$3',
    );
}
