import path from 'node:path'
import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'

/**
 * NVIDIA hosted speech-to-text (Riva gRPC on build.nvidia.com).
 *
 * The hosted ASR models are gRPC-only — there is no HTTPS upload endpoint
 * like Groq/OpenAI — so this is a tiny typed client around the vendored
 * Riva protos (src/lib/riva/proto, MIT/Apache, from github.com/nvidia-riva/common).
 *
 * Whisper-large-v3 is the default: it copes with SINGING far better than
 * dictation models. Parakeet is available for spoken English if ever wanted.
 *
 * Audio in: mono 16-bit PCM WAV (the client records exactly that).
 */

const SERVER = 'grpc.nvcf.nvidia.com:443'

/** Function IDs published on build.nvidia.com for each hosted model. */
export const NVIDIA_ASR_FUNCTIONS = {
  'whisper-large-v3': 'b702f636-f60c-4a3d-a6f4-f3568c13bd7d',
  'parakeet-ctc-0.6b': 'd8dd4e9b-fbf5-4fb0-9dba-8cf436c8d965',
} as const
export type NvidiaAsrModel = keyof typeof NVIDIA_ASR_FUNCTIONS

interface RecognizeResponse {
  results?: Array<{ alternatives?: Array<{ transcript?: string; confidence?: number }> }>
}
interface RivaAsrClient extends grpc.Client {
  Recognize(
    request: Record<string, unknown>,
    metadata: grpc.Metadata,
    options: grpc.CallOptions,
    callback: (err: grpc.ServiceError | null, res: RecognizeResponse) => void,
  ): void
}

let cached: { ctor: grpc.ServiceClientConstructor } | null = null

function loadService(): grpc.ServiceClientConstructor {
  if (cached) return cached.ctor
  const root = path.join(process.cwd(), 'src', 'lib', 'riva', 'proto')
  const def = protoLoader.loadSync('riva/proto/riva_asr.proto', {
    includeDirs: [root],
    keepCase: true,
    longs: Number,
    enums: String,
    defaults: true,
  })
  const pkg = grpc.loadPackageDefinition(def) as unknown as {
    nvidia: { riva: { asr: { RivaSpeechRecognition: grpc.ServiceClientConstructor } } }
  }
  cached = { ctor: pkg.nvidia.riva.asr.RivaSpeechRecognition }
  return cached.ctor
}

export async function nvidiaTranscribe(
  wav: Buffer,
  opts: { apiKey: string; model?: NvidiaAsrModel; language?: string; sampleRate?: number; timeoutMs?: number },
): Promise<{ text: string; confidence: number | null }> {
  const model = opts.model ?? 'whisper-large-v3'
  const Ctor = loadService()
  const client = new Ctor(SERVER, grpc.credentials.createSsl()) as unknown as RivaAsrClient

  const metadata = new grpc.Metadata()
  metadata.set('function-id', NVIDIA_ASR_FUNCTIONS[model])
  metadata.set('authorization', `Bearer ${opts.apiKey}`)

  const request = {
    config: {
      encoding: 'LINEAR_PCM',
      sample_rate_hertz: opts.sampleRate ?? 16000,
      // Whisper takes "en" (or "multi"); Parakeet wants a BCP-47 tag.
      language_code: opts.language ?? (model === 'whisper-large-v3' ? 'en' : 'en-US'),
      max_alternatives: 1,
      audio_channel_count: 1,
      enable_automatic_punctuation: false,
    },
    audio: wav,
  }

  try {
    return await new Promise((resolve, reject) => {
      client.Recognize(
        request,
        metadata,
        { deadline: Date.now() + (opts.timeoutMs ?? 20_000) },
        (err, res) => {
          if (err) return reject(err)
          const alt = res?.results?.[0]?.alternatives?.[0]
          resolve({ text: (alt?.transcript ?? '').trim(), confidence: alt?.confidence ?? null })
        },
      )
    })
  } finally {
    client.close()
  }
}
