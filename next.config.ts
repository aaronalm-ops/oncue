import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // The Riva .proto files are read from disk at runtime by @grpc/proto-loader;
  // Vercel's file tracing can't see that, so include them explicitly.
  outputFileTracingIncludes: {
    '/api/identify/transcribe': ['./src/lib/riva/proto/**/*'],
  },
  serverExternalPackages: ['@grpc/grpc-js', '@grpc/proto-loader'],
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
}

export default nextConfig
