/**
 * SiliconFlow 轻量文生图 / 图生图服务。
 * API: POST {baseUrl}/images/generations
 * 生成图 URL 有效期约 1 小时，调用方需及时下载保存。
 *
 * @see src/service/lite-image-generate.md
 */



/** 直连 SiliconFlow（Node / CLI）。浏览器请走 Vite 反代路径。 */
export const LITE_IMAGE_DEFAULT_BASE_URL = 'https://api.siliconflow.cn/v1'
/** 浏览器默认：Vite `/lite-image-proxy` → SiliconFlow */
export const LITE_IMAGE_BROWSER_BASE_URL = '/lite-image-proxy/v1'
export const LITE_IMAGE_DEFAULT_MODEL = 'Tongyi-MAI/Z-Image-Turbo'
//export const LITE_IMAGE_DEFAULT_MODEL = 'Kwai-Kolors/Kolors'
export const LITE_IMAGE_DEFAULT_IMAGE_SIZE = '1024x1024'

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

/** 不支持 image_size 的模型 */
const MODELS_WITHOUT_IMAGE_SIZE = new Set([
  'Qwen/Qwen-Image-Edit-2509',
  'Qwen/Qwen-Image-Edit',
])

export type LiteImageSize =
  | '1024x1024'
  | '960x1280'
  | '768x1024'
  | '720x1440'
  | '720x1280'
  | '1328x1328'
  | '1664x928'
  | '928x1664'
  | '1472x1140'
  | '1140x1472'
  | '1584x1056'
  | '1056x1584'
  | (string & {})

export type LiteImageGenerateInput = {
  /** 文本提示词 */
  prompt: string
  /** 模型名，默认 Kwai-Kolors/Kolors */
  model?: string
  /** 负面提示词 */
  negativePrompt?: string
  /**
   * 图片尺寸 widthxheight。
   * Qwen-Image-Edit / Qwen-Image-Edit-2509 不支持此字段。
   */
  imageSize?: LiteImageSize
  /** 输出数量，仅 Kolors，1–4 */
  batchSize?: number
  /** 随机种子，0–9999999999 */
  seed?: number
  /** 推理步数，1–100，默认 20 */
  numInferenceSteps?: number
  /** Guidance，仅 Kolors，默认 7.5 */
  guidanceScale?: number
  /** CFG，仅 Qwen-Image，0.1–20 */
  cfg?: number
  /** 参考图（URL 或 data:image/...;base64,...） */
  image?: string
  /** 参考图 2，仅 Qwen-Image-Edit-2509 */
  image2?: string
  /** 参考图 3，仅 Qwen-Image-Edit-2509 */
  image3?: string
}

export type LiteImageGenerateOptions = LiteImageGenerateInput & {
  /** 覆盖环境变量 LITE_IMAGE_API_KEY / SILICONFLOW_API_KEY */
  apiKey?: string
  /** 覆盖环境变量 LITE_IMAGE_BASE_URL */
  baseUrl?: string
  /** 可注入 fetch，便于单测 */
  fetchImpl?: typeof fetch
}

export type LiteImageItem = {
  url: string
}

export type LiteImageGenerateResult = {
  images: LiteImageItem[]
  timings?: { inference?: number }
  seed?: number
  /** 响应头 x-siliconcloud-trace-id */
  traceId?: string | null
}

export type LiteImageApiErrorBody = {
  code?: number | string | null
  message?: string
  data?: unknown
}

export class LiteImageGenerateError extends Error {
  readonly status: number
  readonly body: unknown
  readonly traceId: string | null

  constructor(message: string, status: number, body?: unknown, traceId?: string | null) {
    super(message)
    this.name = 'LiteImageGenerateError'
    this.status = status
    this.body = body
    this.traceId = traceId ?? null
  }
}

export function normalizeLiteImageBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '')
  if (!trimmed) return LITE_IMAGE_DEFAULT_BASE_URL
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`
}

export function resolveLiteImageConfig(overrides?: {
  apiKey?: string
  baseUrl?: string
  model?: string
}): { apiKey: string; baseUrl: string; model: string } {
  const apiKey =
    overrides?.apiKey?.trim() ||
    readEnv(
      'LITE_IMAGE_API_KEY',
      'VITE_LITE_IMAGE_API_KEY',
      'SILICONFLOW_API_KEY',
      'VITE_SILICONFLOW_API_KEY',
    )

  const defaultBase = isBrowserRuntime()
    ? LITE_IMAGE_BROWSER_BASE_URL
    : LITE_IMAGE_DEFAULT_BASE_URL

  const baseUrl = normalizeLiteImageBaseUrl(
    overrides?.baseUrl?.trim() ||
      readEnv('LITE_IMAGE_BASE_URL', 'VITE_LITE_IMAGE_BASE_URL') ||
      defaultBase,
  )
  const model =
    overrides?.model?.trim() ||
    readEnv('LITE_IMAGE_MODEL', 'VITE_LITE_IMAGE_MODEL') ||
    LITE_IMAGE_DEFAULT_MODEL
  return { apiKey, baseUrl, model }
}

/** Same-origin Vite proxy can inject Authorization; client key optional then. */
export function liteImageAllowsMissingApiKey(baseUrl: string): boolean {
  return baseUrl.startsWith('/') || baseUrl.startsWith('./')
}

export function supportsLiteImageSize(model: string): boolean {
  return !MODELS_WITHOUT_IMAGE_SIZE.has(model.trim())
}

export function buildLiteImagePayload(
  input: LiteImageGenerateInput & { model: string },
): Record<string, unknown> {
  const prompt = input.prompt?.trim()
  if (!prompt) {
    throw new LiteImageGenerateError('prompt 不能为空', 400)
  }

  const model = input.model.trim()
  if (!model) {
    throw new LiteImageGenerateError('model 不能为空', 400)
  }

  const payload: Record<string, unknown> = {
    model,
    prompt,
  }

  if (input.negativePrompt?.trim()) {
    payload.negative_prompt = input.negativePrompt.trim()
  }

  if (supportsLiteImageSize(model)) {
    payload.image_size = (input.imageSize?.trim() || LITE_IMAGE_DEFAULT_IMAGE_SIZE) as string
  }

  if (input.batchSize != null) {
    if (input.batchSize < 1 || input.batchSize > 4) {
      throw new LiteImageGenerateError('batchSize 范围须为 1–4', 400)
    }
    payload.batch_size = input.batchSize
  }

  if (input.seed != null) {
    if (input.seed < 0 || input.seed > 9_999_999_999) {
      throw new LiteImageGenerateError('seed 范围须为 0–9999999999', 400)
    }
    payload.seed = input.seed
  }

  if (input.numInferenceSteps != null) {
    if (input.numInferenceSteps < 1 || input.numInferenceSteps > 100) {
      throw new LiteImageGenerateError('numInferenceSteps 范围须为 1–100', 400)
    }
    payload.num_inference_steps = input.numInferenceSteps
  }

  if (input.guidanceScale != null) {
    if (input.guidanceScale < 0 || input.guidanceScale > 20) {
      throw new LiteImageGenerateError('guidanceScale 范围须为 0–20', 400)
    }
    payload.guidance_scale = input.guidanceScale
  }

  if (input.cfg != null) {
    if (input.cfg < 0.1 || input.cfg > 20) {
      throw new LiteImageGenerateError('cfg 范围须为 0.1–20', 400)
    }
    payload.cfg = input.cfg
  }

  if (input.image?.trim()) payload.image = input.image.trim()
  if (input.image2?.trim()) payload.image2 = input.image2.trim()
  if (input.image3?.trim()) payload.image3 = input.image3.trim()

  return payload
}

export function parseLiteImageResponse(
  data: unknown,
  traceId?: string | null,
): LiteImageGenerateResult {
  if (!data || typeof data !== 'object') {
    throw new LiteImageGenerateError('响应不是 JSON 对象', 502, data, traceId)
  }

  const raw = data as {
    images?: Array<{ url?: string }>
    timings?: { inference?: number }
    seed?: number
    message?: string
  }

  const images = (raw.images ?? [])
    .map((item) => ({ url: item?.url?.trim() ?? '' }))
    .filter((item) => item.url.length > 0)

  if (images.length === 0) {
    throw new LiteImageGenerateError(
      raw.message?.trim() || '响应未包含有效图片 URL',
      502,
      data,
      traceId,
    )
  }

  return {
    images,
    timings: raw.timings,
    seed: raw.seed,
    traceId: traceId ?? null,
  }
}

function authorizationHeader(apiKey: string): string {
  if (/^Bearer\s+/i.test(apiKey)) return apiKey
  return `Bearer ${apiKey}`
}

function extractErrorMessage(status: number, body: unknown, rawText: string): string {
  if (body && typeof body === 'object') {
    const msg = (body as LiteImageApiErrorBody).message
    if (typeof msg === 'string' && msg.trim()) {
      return `lite-image-generate HTTP ${status}: ${msg.trim()}`
    }
  }
  if (typeof body === 'string' && body.trim()) {
    return `lite-image-generate HTTP ${status}: ${body.trim().slice(0, 280)}`
  }
  const fallback = rawText.trim().slice(0, 280)
  return fallback
    ? `lite-image-generate HTTP ${status}: ${fallback}`
    : `lite-image-generate HTTP ${status}`
}

/**
 * 调用 SiliconFlow 创建图片生成请求。
 * 返回的 images[].url 约 1 小时后失效。
 */
export async function generateLiteImage(
  options: LiteImageGenerateOptions,
): Promise<LiteImageGenerateResult> {
  const { apiKey, baseUrl, model } = resolveLiteImageConfig({
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    model: options.model,
  })

  if (!apiKey && !liteImageAllowsMissingApiKey(baseUrl)) {
    throw new LiteImageGenerateError(
      '请配置 LITE_IMAGE_API_KEY 或 SILICONFLOW_API_KEY',
      401,
    )
  }

  const payload = buildLiteImagePayload({ ...options, model })
  const endpoint = `${baseUrl}/images/generations`
  const fetchImpl = options.fetchImpl ?? globalThis.fetch

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
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
  const rawText = await response.text()

  let body: unknown = null
  if (rawText) {
    try {
      body = JSON.parse(rawText) as unknown
    } catch {
      body = rawText
    }
  }

  if (!response.ok) {
    const message = extractErrorMessage(response.status, body, rawText)
    throw new LiteImageGenerateError(message, response.status, body, traceId)
  }

  const result = parseLiteImageResponse(body, traceId)
  return result
}
