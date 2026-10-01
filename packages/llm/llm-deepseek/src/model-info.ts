/** Protocol-independent model capabilities and reasoning choices. */
import { LlmError, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { LlmModelInfo, LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'
import type { DeepSeekCatalogModel, DeepSeekConnectionOptions } from './types.ts'

const OFF_REASONING_EFFORT = ReasoningEffortId('off')
const LOW_REASONING_EFFORT = ReasoningEffortId('low')
const HIGH_REASONING_EFFORT = ReasoningEffortId('high')
const MAX_REASONING_EFFORT = ReasoningEffortId('max')
const REASONING_EFFORTS = [
  {
    id: OFF_REASONING_EFFORT,
    name: 'Off',
    description: 'Use for simple tasks that do not need reasoning.',
  },
  {
    id: LOW_REASONING_EFFORT,
    name: 'Low',
    description: 'Prefer for routine or latency-sensitive tasks.',
  },
  {
    id: HIGH_REASONING_EFFORT,
    name: 'High',
    description: 'The default balance for most tasks.',
  },
  {
    id: MAX_REASONING_EFFORT,
    name: 'Max',
    description: 'Reserve for the hardest quality-first tasks.',
  },
] as const
const OFF_ONLY_REASONING_EFFORTS = [
  {
    id: OFF_REASONING_EFFORT,
    name: 'Off',
    description: 'Use for simple tasks that do not need reasoning.',
  },
] as const
const NATIVE_REASONING_EFFORTS = ['low', 'high', 'max'] as const

function effortChoices(connection: DeepSeekConnectionOptions, declared: readonly string[] | undefined) {
  const supported = declared === undefined
    ? [...NATIVE_REASONING_EFFORTS]
    : NATIVE_REASONING_EFFORTS.filter(effort => declared.includes(effort))
  const configured = connection.defaults.reasoningEffort
  if (configured !== undefined && configured !== 'off' && !supported.includes(configured)) {
    throw new LlmError(
      `llm-deepseek: configured reasoningEffort "${configured}" is not declared for this model`,
      'UNSUPPORTED_REASONING_EFFORT',
    )
  }
  const defaultEffort = configured ?? (supported.includes('high') ? 'high' : supported[0] ?? 'off')
  if (connection.defaults.thinking === 'disabled' && defaultEffort !== 'off') {
    return { efforts: OFF_ONLY_REASONING_EFFORTS, defaultEffort: OFF_REASONING_EFFORT }
  }
  const efforts = [
    ...OFF_ONLY_REASONING_EFFORTS,
    ...supported.map(effort => REASONING_EFFORTS.find(item => item.id === ReasoningEffortId(effort)))
      .filter(effort => effort !== undefined),
  ]
  return {
    efforts,
    defaultEffort: defaultEffort === 'off'
      ? OFF_REASONING_EFFORT
      : defaultEffort === 'low'
        ? LOW_REASONING_EFFORT
        : defaultEffort === 'max'
          ? MAX_REASONING_EFFORT
          : HIGH_REASONING_EFFORT,
  }
}

/** Advertise one catalog entry.
 * @param provider - registered provider id.
 * @param model - advisory catalog entry.
 * @returns selector metadata.
 */
export function catalogModelInfo(provider: string, model: DeepSeekCatalogModel): LlmModelInfo {
  return {
    provider,
    id: model.id,
    name: model.name ?? model.id,
    ...model.description === undefined ? {} : { description: model.description },
    inputModalities: model.inputModalities ?? ['text'],
  }
}

/** Resolve model capabilities against one configuration generation.
 * @param connection - validated connection facts.
 * @param provider - registered provider id.
 * @param model - requested wire model id.
 * @param metadata - catalog metadata for this model, when a catalog supplied it.
 * @returns effective model metadata for this operation.
 */
export function modelInfo(
  connection: DeepSeekConnectionOptions,
  provider: string,
  model: string,
  metadata?: import('@deepseek-ai/dsh-llm').LlmModelMetadata,
): LlmResolvedModelInfo {
  const configured = connection.models.find(entry => entry.id === model)
  const explicit = connection.explicitModelMetadata?.find(entry => entry.id === model)
  const explicitContext = explicit?.contextWindow
  const explicitModalities = explicit?.inputModalities
  const contextWindow = explicitContext
    ?? metadata?.contextWindow
      ?? configured?.contextWindow
      ?? connection.explicitDefaultContextWindow
    ?? connection.defaultContextWindow
  const inputModalities = explicitModalities
    ?? (metadata?.inputModalities === undefined
      ? configured?.inputModalities ?? ['text' as const]
      : [...metadata.inputModalities])
  const reasoning = effortChoices(connection, metadata?.reasoningEfforts)
  return {
    // An uncatalogued endpoint is safely treated as text-only. Declaring an
    // unverified image capability would let the host persist input that the
    // endpoint may reject on every later turn.
    ...configured === undefined
      ? { provider, id: model, name: model, inputModalities: [...inputModalities] }
      : { ...catalogModelInfo(provider, configured), inputModalities: [...inputModalities] },
    context: { contextWindow },
    defaultMaxTokens: configured?.maxTokens ?? connection.maxTokens,
    ...metadata?.maxOutputTokens === undefined ? {} : { maxOutputTokens: metadata.maxOutputTokens },
    ...configured?.systemPromptUpdate === undefined ? {} : { systemPromptUpdate: configured.systemPromptUpdate },
    ...configured?.toolUpdate === undefined ? {} : { toolUpdate: configured.toolUpdate },
    ...connection.defaults.thinking === 'disabled'
      ? {
        reasoning: { efforts: OFF_ONLY_REASONING_EFFORTS, defaultEffort: OFF_REASONING_EFFORT },
      }
      : {
        reasoning,
      },
  }
}

/** Apply one resolved model's request modalities to an operation-local connection copy.
 * @param connection - the operation's validated connection facts.
 * @param resolved - effective model metadata for the requested model.
 * @returns a copy whose matching catalog entry carries the resolved input modalities.
 */
export function connectionForModel(
  connection: DeepSeekConnectionOptions,
  resolved: LlmResolvedModelInfo,
): DeepSeekConnectionOptions {
  const model = connection.models.find(entry => entry.id === resolved.id)
  const effective = {
    ...model,
    id: resolved.id,
    inputModalities: [...resolved.inputModalities ?? ['text']],
  }
  return {
    ...connection,
    models: [...connection.models.filter(entry => entry.id !== resolved.id), effective],
  }
}
