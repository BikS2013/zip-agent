/**
 * Microsoft Foundry endpoints often arrive in two shapes:
 *   https://<resource>.services.ai.azure.com
 *   https://<resource>.services.ai.azure.com/models
 * For the OpenAI-compatible (DeepSeek) path the suffix is `/openai/v1`;
 * for the Anthropic-compatible path it is `/anthropic`. Either way the
 * trailing `/models` (if present) and any trailing slashes are stripped
 * before the chosen suffix is appended.
 */
export function normalizeFoundryEndpoint(
  base: string,
  suffix: '/anthropic' | '/openai/v1',
): string {
  let b = base.trim().replace(/\/+$/, '');
  if (b.toLowerCase().endsWith('/models')) b = b.slice(0, -'/models'.length);
  return b.replace(/\/+$/, '') + suffix;
}
