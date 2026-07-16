/**
 * SiliconFlow 文本转语音（TTS）服务。
 * API: POST {baseUrl}/audio/speech
 * 响应为音频二进制，调用方自行播放 / 下载 / 写入。
 *
 * voice 组合规则：`${model}:${speaker}`，如 `FunAudioLLM/CosyVoice2-0.5B:diana`
 */

/** 直连 SiliconFlow（Node / CLI）。浏览器请走 Vite 反代路径。 */
export const LITE_SPEECH_DEFAULT_BASE_URL = 'https://api.siliconflow.cn/v1'
/** 浏览器默认：与文生图共用 Vite `/lite-image-proxy` → SiliconFlow */
export const LITE_SPEECH_BROWSER_BASE_URL = '/lite-image-proxy/v1'
export const LITE_SPEECH_DEFAULT_MODEL = 'FunAudioLLM/CosyVoice2-0.5B'
export const LITE_SPEECH_DEFAULT_SPEAKER = 'alex'
export const LITE_SPEECH_DEFAULT_RESPONSE_FORMAT = 'mp3'
export const LITE_SPEECH_DEFAULT_SPEED = 1
export const LITE_SPEECH_DEFAULT_GAIN = 0

/** MOSS-TTSD / CosyVoice2 常见说话人 */
export const LITE_SPEECH_SPEAKERS = [
  'alex',
  'anna',
  'bella',
  'benjamin',
  'charles',
  'claire',
  'david',
  'diana',
] as const

export type LiteSpeechSpeaker = (typeof LITE_SPEECH_SPEAKERS)[number] | (string & {})

export type LiteSpeechModel =
  | 'fnlp/MOSS-TTSD-v0.5'
  | 'FunAudioLLM/CosyVoice2-0.5B'
  | (string & {})

export type LiteSpeechResponseFormat = 'mp3' | 'opus' | 'wav' | 'pcm'

export type LiteSpeechReference = {
  /** 参考音频 URL 或 data URL 等，按上游文档传 */
  audio?: string
  text?: string
  [key: string]: unknown
}

export type LiteSpeechGenerateInput = {
  /** 待合成文本；自然语言指令可加 `<|endofprompt|>` 与 `[laughter]` 等标记 */
  input: string
  /** 模型名，默认 FunAudioLLM/CosyVoice2-0.5B */
  model?: LiteSpeechModel
  /**
   * 说话人短名（alex / diana 等）。
   * 与 model 组合成 voice：`${model}:${speaker}`。
   * 若同时传 voice，以 voice 为准。
   */
  speaker?: LiteSpeechSpeaker
  /**
   * 完整 voice，如 `FunAudioLLM/CosyVoice2-0.5B:alex`。
   * 与 references 互斥。
   */
  voice?: string
  /** 参考音色列表；与 voice 互斥 */
  references?: LiteSpeechReference[]
  /** 输出格式，默认 mp3 */
  responseFormat?: LiteSpeechResponseFormat
  /**
   * 采样率。
   * mp3: 32000 | 44100；wav/pcm: 8000–44100；opus: 48000
   */
  sampleRate?: number
  /** 是否流式输出（仍可整段读完为 ArrayBuffer） */
  stream?: boolean
  /** 语速 0.25–4.0，默认 1.0 */
  speed?: number
  /** 增益 -10–10，默认 0 */
  gain?: number
}

export type LiteSpeechGenerateOptions = LiteSpeechGenerateInput & {
  /** 覆盖 LITE_SPEECH_API_KEY / LITE_IMAGE_API_KEY / SILICONFLOW_API_KEY */
  apiKey?: string
  /** 覆盖 LITE_SPEECH_BASE_URL / LITE_IMAGE_BASE_URL */
  baseUrl?: string
  /** 可注入 fetch，便于单测 */
  fetchImpl?: typeof fetch
}

export type LiteSpeechGenerateResult = {
  /** 原始音频二进制 */
  audio: ArrayBuffer
  /** 便于播放 / 下载的 Blob */
  blob: Blob
  mimeType: string
  responseFormat: LiteSpeechResponseFormat
  /** 实际请求的 voice（references 模式下可能为空） */
  voice?: string
  model: string
  /** 响应头 x-siliconcloud-trace-id */
  traceId?: string | null
}

export type LiteSpeechApiErrorBody = {
  code?: number | string | null
  message?: string
  data?: unknown
}

export class LiteSpeechGenerateError extends Error {
  readonly status: number
  readonly body: unknown
  readonly traceId: string | null

  constructor(message: string, status: number, body?: unknown, traceId?: string | null) {
    super(message)
    this.name = 'LiteSpeechGenerateError'
    this.status = status
    this.body = body
    this.traceId = traceId ?? null
  }
}

function readEnv(...keys: string[]): string {
  for (const key of keys) {
    if (typeof process !== 'undefined') {
      const fromProcess = process.env?.[key]?.trim()
      if (fromProcess) return fromProcess
    }
    try {
      const fromMeta = (import.meta as ImportMeta & { env?: Record<string, unknown> }).env?.[
        key
      ]
      if (typeof fromMeta === 'string' && fromMeta.trim()) return fromMeta.trim()
    } catch {
      // import.meta.env unavailable outside Vite/bundler
    }
  }
  return ''
}

function isBrowserRuntime(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined'
}

export function normalizeLiteSpeechBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '')
  if (!trimmed) return LITE_SPEECH_DEFAULT_BASE_URL
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`
}

/** 将模型与说话人拼成上游 voice 字段 */
export function buildLiteSpeechVoice(model: string, speaker: string): string {
  const m = model.trim()
  const s = speaker.trim()
  if (!m) throw new LiteSpeechGenerateError('model 不能为空', 400)
  if (!s) throw new LiteSpeechGenerateError('speaker 不能为空', 400)
  if (s.includes(':')) return s
  return `${m}:${s}`
}

export function mimeTypeForLiteSpeechFormat(format: LiteSpeechResponseFormat): string {
  switch (format) {
    case 'mp3':
      return 'audio/mpeg'
    case 'opus':
      return 'audio/opus'
    case 'wav':
      return 'audio/wav'
    case 'pcm':
      return 'audio/L16'
    default:
      return 'application/octet-stream'
  }
}

export function resolveLiteSpeechConfig(overrides?: {
  apiKey?: string
  baseUrl?: string
  model?: string
  speaker?: string
}): { apiKey: string; baseUrl: string; model: string; speaker: string } {
  const apiKey =
    overrides?.apiKey?.trim() ||
    readEnv(
      'LITE_SPEECH_API_KEY',
      'VITE_LITE_SPEECH_API_KEY',
      'LITE_IMAGE_API_KEY',
      'VITE_LITE_IMAGE_API_KEY',
      'SILICONFLOW_API_KEY',
      'VITE_SILICONFLOW_API_KEY',
    )

  const defaultBase = isBrowserRuntime()
    ? LITE_SPEECH_BROWSER_BASE_URL
    : LITE_SPEECH_DEFAULT_BASE_URL

  const baseUrl = normalizeLiteSpeechBaseUrl(
    overrides?.baseUrl?.trim() ||
      readEnv(
        'LITE_SPEECH_BASE_URL',
        'VITE_LITE_SPEECH_BASE_URL',
        'LITE_IMAGE_BASE_URL',
        'VITE_LITE_IMAGE_BASE_URL',
      ) ||
      defaultBase,
  )

  const model =
    overrides?.model?.trim() ||
    readEnv('LITE_SPEECH_MODEL', 'VITE_LITE_SPEECH_MODEL') ||
    LITE_SPEECH_DEFAULT_MODEL

  const speaker =
    overrides?.speaker?.trim() ||
    readEnv('LITE_SPEECH_SPEAKER', 'VITE_LITE_SPEECH_SPEAKER') ||
    LITE_SPEECH_DEFAULT_SPEAKER

  return { apiKey, baseUrl, model, speaker }
}

/** Same-origin Vite proxy can inject Authorization; client key optional then. */
export function liteSpeechAllowsMissingApiKey(baseUrl: string): boolean {
  return baseUrl.startsWith('/') || baseUrl.startsWith('./')
}

export function buildLiteSpeechPayload(
  input: LiteSpeechGenerateInput & { model: string; speaker: string },
): Record<string, unknown> {
  const text = input.input?.trim()
  if (!text) {
    throw new LiteSpeechGenerateError('input 不能为空', 400)
  }
  if (text.length > 128_000) {
    throw new LiteSpeechGenerateError('input 长度须为 1–128000', 400)
  }

  const model = input.model.trim()
  if (!model) {
    throw new LiteSpeechGenerateError('model 不能为空', 400)
  }

  const hasReferences = Array.isArray(input.references) && input.references.length > 0
  const voice = input.voice?.trim() || (hasReferences ? '' : buildLiteSpeechVoice(model, input.speaker))

  if (hasReferences && voice) {
    throw new LiteSpeechGenerateError('voice 与 references 互斥，请只传其一', 400)
  }
  if (!hasReferences && !voice) {
    throw new LiteSpeechGenerateError('请提供 voice / speaker，或 references', 400)
  }

  const responseFormat = (input.responseFormat?.trim() ||
    LITE_SPEECH_DEFAULT_RESPONSE_FORMAT) as LiteSpeechResponseFormat
  if (!['mp3', 'opus', 'wav', 'pcm'].includes(responseFormat)) {
    throw new LiteSpeechGenerateError('responseFormat 须为 mp3 | opus | wav | pcm', 400)
  }

  const payload: Record<string, unknown> = {
    model,
    input: text,
    response_format: responseFormat,
  }

  if (voice) payload.voice = voice
  if (hasReferences) payload.references = input.references

  if (input.sampleRate != null) {
    if (!Number.isFinite(input.sampleRate) || input.sampleRate <= 0) {
      throw new LiteSpeechGenerateError('sampleRate 须为正数', 400)
    }
    payload.sample_rate = input.sampleRate
  }

  if (input.stream != null) {
    payload.stream = Boolean(input.stream)
  }

  if (input.speed != null) {
    if (input.speed < 0.25 || input.speed > 4) {
      throw new LiteSpeechGenerateError('speed 范围须为 0.25–4', 400)
    }
    payload.speed = input.speed
  }

  if (input.gain != null) {
    if (input.gain < -10 || input.gain > 10) {
      throw new LiteSpeechGenerateError('gain 范围须为 -10–10', 400)
    }
    payload.gain = input.gain
  }

  return payload
}

function authorizationHeader(apiKey: string): string {
  if (/^Bearer\s+/i.test(apiKey)) return apiKey
  return `Bearer ${apiKey}`
}

function extractErrorMessage(status: number, body: unknown, rawText: string): string {
  if (body && typeof body === 'object') {
    const msg = (body as LiteSpeechApiErrorBody).message
    if (typeof msg === 'string' && msg.trim()) {
      return `lite-speech-generate HTTP ${status}: ${msg.trim()}`
    }
  }
  if (typeof body === 'string' && body.trim()) {
    return `lite-speech-generate HTTP ${status}: ${body.trim().slice(0, 280)}`
  }
  const fallback = rawText.trim().slice(0, 280)
  return fallback
    ? `lite-speech-generate HTTP ${status}: ${fallback}`
    : `lite-speech-generate HTTP ${status}`
}

async function readErrorBody(response: Response): Promise<{ body: unknown; rawText: string }> {
  const rawText = await response.text()
  if (!rawText) return { body: null, rawText: '' }
  try {
    return { body: JSON.parse(rawText) as unknown, rawText }
  } catch {
    return { body: rawText, rawText }
  }
}

/** 将音频二进制转为可播放的 object URL（调用方负责 URL.revokeObjectURL） */
export function createLiteSpeechObjectUrl(result: Pick<LiteSpeechGenerateResult, 'blob'>): string {
  return URL.createObjectURL(result.blob)
}

/**
 * 调用 SiliconFlow 创建文本转语音请求。
 * 成功时返回音频 ArrayBuffer / Blob。
 */
export async function generateLiteSpeech(
  options: LiteSpeechGenerateOptions,
): Promise<LiteSpeechGenerateResult> {
  const { apiKey, baseUrl, model, speaker } = resolveLiteSpeechConfig({
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    model: options.model,
    speaker: options.speaker,
  })

  if (!apiKey && !liteSpeechAllowsMissingApiKey(baseUrl)) {
    throw new LiteSpeechGenerateError(
      '请配置 LITE_SPEECH_API_KEY、LITE_IMAGE_API_KEY 或 SILICONFLOW_API_KEY',
      401,
    )
  }

  const payload = buildLiteSpeechPayload({ ...options, model, speaker })
  const responseFormat = payload.response_format as LiteSpeechResponseFormat
  const endpoint = `${baseUrl}/audio/speech`
  const fetchImpl = options.fetchImpl ?? globalThis.fetch

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'audio/*, application/json',
  }
  if (apiKey) {
    headers.Authorization = authorizationHeader(apiKey)
  }

  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })

  const traceId = response.headers.get('x-siliconcloud-trace-id')

  if (!response.ok) {
    const { body, rawText } = await readErrorBody(response)
    const message = extractErrorMessage(response.status, body, rawText)
    throw new LiteSpeechGenerateError(message, response.status, body, traceId)
  }

  const audio = await response.arrayBuffer()
  if (!audio.byteLength) {
    throw new LiteSpeechGenerateError('响应未包含音频数据', 502, null, traceId)
  }

  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim()
  const mimeType =
    contentType && contentType.startsWith('audio/')
      ? contentType
      : mimeTypeForLiteSpeechFormat(responseFormat)

  return {
    audio,
    blob: new Blob([audio], { type: mimeType }),
    mimeType,
    responseFormat,
    voice: typeof payload.voice === 'string' ? payload.voice : undefined,
    model,
    traceId: traceId ?? null,
  }
}
