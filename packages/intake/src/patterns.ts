export const cnrPattern = /(?<![\p{L}\p{N}])(?:CNR\s*(?:No\.?|Number)?\s*[:#-]?\s*([A-Z0-9]{16})|([A-Z]{4}\d{12}))(?![\p{L}\p{N}])/dgiu;

export const firPattern = /(?<![\p{L}\p{N}])(?:F\.?\s*I\.?\s*R\.?(?:[ \t]+(?:No\.?|Number))?|प्राथमिकी(?:[ \t]+(?:नं\.?|संख्या))?)[ \t]*[:#-]?[ \t]*([A-Z]*[0-9०-९]+(?:[ \t]*[/-][ \t]*[A-Z0-9०-९]+)*)(?![\p{L}\p{N}])/dgiu;
export const caseIdPattern = /(?<![\p{L}\p{N}])(?:M\.?C\.?R\.?C\.?|C\.?R\.?A\.?|C\.?R\.?L\.?[ \t]*(?:A|M)|Criminal[ \t]+(?:Appeal|Revision)|Bail[ \t]+(?:Application|Petition)|Crime|Case)[ \t]*(?:No\.?|Number|#)?[ \t]*[:#-]?[ \t]*([A-Z]*[ \t]*[0-9०-९]+[ \t]*(?:\/|of|-)[ \t]*[0-9०-९]{4})(?![\p{L}\p{N}])/dgiu;
export const caseIdLoosePattern = /(?<![\p{L}\p{N}])(?:M\.?C\.?R\.?C\.?|C\.?R\.?A\.?|Crime|Case)\s*(?:No\.?|Number|#)?\s*[:#-]?\s*([A-Z]{0,4}\s*[0-9०-९]{1,8}(?:\s*(?:\/|of|-)\s*[0-9०-९]{2,4})?)(?![\p{L}\p{N}])/dgiu;

export function validSpan(text: string, start: number, end: number): boolean {
  return Number.isInteger(start) && Number.isInteger(end) && start >= 0 && start < end && end <= text.length;
}
