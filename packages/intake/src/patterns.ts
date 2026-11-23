export const cnrPattern = /(?<![\p{L}\p{N}])(?:CNR\s*(?:No\.?|Number)?\s*[:#-]?\s*([A-Z0-9]{16})|([A-Z]{4}\d{12}))(?![\p{L}\p{N}])/dgiu;

export const firPattern = /(?<![\p{L}\p{N}])(?:F\.?\s*I\.?\s*R\.?(?:[ \t]+(?:No\.?|Number))?|प्राथमिकी(?:[ \t]+(?:नं\.?|संख्या))?)[ \t]*[:#-]?[ \t]*([A-Z]*[0-9०-९]+(?:[ \t]*[/-][ \t]*[A-Z0-9०-९]+)*)(?![\p{L}\p{N}])/dgiu;

export function validSpan(text: string, start: number, end: number): boolean {
  return Number.isInteger(start) && Number.isInteger(end) && start >= 0 && start < end && end <= text.length;
}
