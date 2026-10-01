/** Locale copy for the file-recognition settings page. */

import type { SettingsFormLabels } from '@deepseek-ai/dsh-client-ui-primitives'

/** Keys rendered by the page. */
export type OfficeRecognitionLocaleKey =
  | 'description' | 'apiKey' | 'apiKeyHint' | 'apiKeySet' | 'apiKeyUnset'
  | 'ocrGroup' | 'audioGroup' | 'videoGroup' | 'limitsGroup'
  | 'endpoint' | 'endpointHint' | 'model' | 'modelHint'
  | 'audioApiKey' | 'audioApiKeyHint' | 'videoApiKey' | 'videoApiKeyHint'
  | 'audioEndpoint' | 'audioEndpointHint' | 'audioModel' | 'audioModelHint'
  | 'videoEndpoint' | 'videoEndpointHint' | 'videoModel' | 'videoModelHint'
  | 'maxInputBytes' | 'maxInputBytesHint' | 'maxExtractedChars' | 'maxExtractedCharsHint'
  | 'maxPdfPages' | 'maxPdfPagesHint' | 'overridden' | 'reset' | 'readOnly'
  | 'unavailable' | 'save' | 'saving' | 'saveFailed' | 'invalidNumber'

/** English labels. */
export const en: Record<OfficeRecognitionLocaleKey, string> = {
  description: 'Extract Office and PDF text, with optional OCR, audio transcription, and video understanding.',
  ocrGroup: 'Scanned PDF OCR',
  audioGroup: 'Audio transcription',
  videoGroup: 'Video understanding',
  limitsGroup: 'Local parsing limits',
  apiKey: 'OCR API key',
  apiKeyHint: 'Stored in the credential store and sent only to the OCR endpoint.',
  apiKeySet: 'Configured',
  apiKeyUnset: 'Not configured',
  endpoint: 'OCR endpoint',
  endpointHint: 'OpenAI-compatible API base URL such as https://host/v1, or a full /chat/completions URL. Leave empty to disable scanned-page OCR.',
  model: 'Vision model',
  modelHint: 'Model id accepted by the OCR endpoint.',
  audioApiKey: 'Audio transcription API key',
  audioApiKeyHint: 'Stored in the credential store and sent only to the audio endpoint.',
  audioEndpoint: 'Audio transcription endpoint',
  audioEndpointHint: 'OpenAI-compatible API base URL; /audio/transcriptions is appended when the URL ends in a version path such as /v1.',
  audioModel: 'Transcription model',
  audioModelHint: 'Model id accepted by the audio endpoint.',
  videoApiKey: 'Video understanding API key',
  videoApiKeyHint: 'Stored in the credential store and sent only to the video endpoint.',
  videoEndpoint: 'Video understanding endpoint',
  videoEndpointHint: 'OpenAI-compatible API base URL; /chat/completions is appended when the URL ends in a version path such as /v1.',
  videoModel: 'Video model',
  videoModelHint: 'Model id accepted by the video endpoint and its video_url input format.',
  maxInputBytes: 'Maximum file size (bytes)',
  maxInputBytesHint: 'Larger files remain available through their attachment handle without local extraction.',
  maxExtractedChars: 'Maximum extracted characters',
  maxExtractedCharsHint: 'Per attached file; longer results are truncated.',
  maxPdfPages: 'Maximum PDF pages',
  maxPdfPagesHint: 'Maximum pages inspected for text or sent to OCR.',
  overridden: 'Overridden',
  reset: 'Reset to default',
  readOnly: 'This deployment stores settings read-only.',
  unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
  save: 'Save',
  saving: 'Saving…',
  saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
  invalidNumber: 'Enter a number, or leave blank to use the default.',
}

/** Simplified Chinese labels. */
export const zh: Record<OfficeRecognitionLocaleKey, string> = {
  description: '提取 Office 和 PDF 文本，并可配置 OCR、音频转写与视频理解。',
  ocrGroup: '扫描 PDF OCR',
  audioGroup: '音频转写',
  videoGroup: '视频理解',
  limitsGroup: '本地解析限制',
  apiKey: 'OCR API 密钥',
  apiKeyHint: '密钥保存在凭据存储中，只会发送到 OCR endpoint。',
  apiKeySet: '已配置',
  apiKeyUnset: '未配置',
  endpoint: 'OCR endpoint',
  endpointHint: '填写 OpenAI 兼容 API base URL（如 https://host/v1）或完整的 /chat/completions URL。留空会关闭扫描页 OCR。',
  model: '视觉模型',
  modelHint: 'OCR endpoint 接受的模型 ID。',
  audioApiKey: '音频转写 API 密钥',
  audioApiKeyHint: '密钥保存在凭据存储中，只会发送到音频 endpoint。',
  audioEndpoint: '音频转写 endpoint',
  audioEndpointHint: 'OpenAI 兼容 API base URL；当路径以版本号（如 /v1）结尾时会追加 /audio/transcriptions。',
  audioModel: '转写模型',
  audioModelHint: '音频 endpoint 接受的模型 ID。',
  videoApiKey: '视频理解 API 密钥',
  videoApiKeyHint: '密钥保存在凭据存储中，只会发送到视频 endpoint。',
  videoEndpoint: '视频理解 endpoint',
  videoEndpointHint: 'OpenAI 兼容 API base URL；当路径以版本号（如 /v1）结尾时会追加 /chat/completions。',
  videoModel: '视频模型',
  videoModelHint: '模型和 endpoint 必须支持 video_url 输入格式。',
  maxInputBytes: '文件大小上限（字节）',
  maxInputBytesHint: '更大的文件仍可通过附件句柄访问，但不会在本机提取。',
  maxExtractedChars: '提取字符上限',
  maxExtractedCharsHint: '每个附件单独限制；超出的结果会截断。',
  maxPdfPages: 'PDF 页数上限',
  maxPdfPagesHint: '本地提取文本或发送 OCR 的最大页数。',
  overridden: '已覆盖',
  reset: '恢复默认值',
  readOnly: '此部署的设置为只读。',
  unavailable: '此插件当前未加载，暂时无法配置。',
  save: '保存',
  saving: '保存中…',
  saveFailed: '部署未接受这些值，已保留供你修改。',
  invalidNumber: '请填写数字；留空表示使用默认值。',
}

/** Shared form-shell labels.
 * @param t - the locale lookup for Office recognition Settings text.
 * @returns the localized labels required by the shared form shell.
 */
export function formLabels(t: (key: OfficeRecognitionLocaleKey) => string): SettingsFormLabels {
  return { unavailable: t('unavailable'), readOnly: t('readOnly'), saveFailed: t('saveFailed'), save: t('save'), saving: t('saving') }
}
