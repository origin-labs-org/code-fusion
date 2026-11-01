// ============================================================
// Token Estimation
// ============================================================

import { ESTIMATED_TOKEN_CHAR_DIVISOR } from "@origin-ai/cf-shared";

export function estimateTokens(text: string): number {
  const chineseChars = (text.match(/[One-鿿]/g) || []).length;
  const otherChars = text.length - chineseChars;

  return Math.ceil((chineseChars * 2 + otherChars) / ESTIMATED_TOKEN_CHAR_DIVISOR);
}
