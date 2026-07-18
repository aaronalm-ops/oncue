'use client'

/**
 * Browser-side PDF text extraction using pdf.js.
 *
 * Runs on the uploader's machine, where fonts always resolve — serverless
 * runtimes silently drop text runs when a PDF's fonts fail to load, which
 * produced chord sheets with every other lyric line missing. The extracted
 * positioned lines are sent to the server, which does the (pure) parsing.
 */
import { bandItemsToLines, pdfTextItemsToRaw, type ExtractResult, type RawItem } from './extract'

export async function extractPdfInBrowser(file: File): Promise<ExtractResult> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString()

  const data = new Uint8Array(await file.arrayBuffer())
  const loadingTask = pdfjs.getDocument({ data })
  const pdf = await loadingTask.promise

  const items: RawItem[] = []
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const viewport = page.getViewport({ scale: 1 })
    const content = await page.getTextContent()
    items.push(
      ...pdfTextItemsToRaw(
        content.items as Array<{ str: string; transform: number[]; width: number; height: number }>,
        viewport.height,
        p,
      ),
    )
  }

  const result = bandItemsToLines(items, pdf.numPages)
  await loadingTask.destroy()
  return result
}
