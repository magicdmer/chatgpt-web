export type Provider = 'google' | 'openai' | 'anthropic' | 'deepseek' | 'other'

export function detectProvider(model: string): Provider {
  const m = (model || '').toLowerCase()
  if (m.includes('gemini')) return 'google'
  if (m.startsWith('gpt') || m.includes('gpt-') || m.includes('o3') || m.includes('o4') || m.includes('4o')) return 'openai'
  if (m.includes('claude') || m.includes('anthropic')) return 'anthropic'
  if (m.includes('deepseek')) return 'deepseek'
  return 'other'
}

// 统一构造可扩展的 extra_body，不同厂商专属参数放在各自命名空间下
export function buildExtraBody(model: string, usingThinking: boolean): Record<string, any> | undefined {
  const provider = detectProvider(model)

  switch (provider) {
    case 'google':
      // Gemini Thinking：控制思考预算与是否回传思考内容
      return usingThinking
        ? {
            google: {
              thinking_config: {
                thinking_budget: -1,
                include_thoughts: true,
              },
            },
          }
        : {
            google: {
              thinking_config: {
                thinking_budget: 0,
              },
            },
          }
    case 'openai':
      // OpenAI 当前不支持 extra_body；由 new-api 仅用于非 OpenAI 模型
      return undefined
    case 'anthropic':
      // 预留：可在此返回 Anthropic 的专属参数
      return undefined
    case 'deepseek':
      // 预留：可在此返回 DeepSeek 的专属参数
      return undefined
    default:
      return undefined
  }
}