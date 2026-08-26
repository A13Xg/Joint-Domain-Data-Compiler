/// <reference lib="webworker" />
// Stream-parse and analyze CSV samples off the main thread. The worker returns a
// normalized CsvAnalysisResult so the mapping UI never receives partial arrays.
import Papa from 'papaparse'
import { analyzeRawRows } from '../core/csvAnalysis'
import { normalizeCsvAnalysisResult } from '../core/csvContract'
import { errorMessage } from '../core/errors'

interface AnalyzeMessage {
  type: 'analyze'
  payload: {
    file: File
    sampleLimit: number
  }
}

interface ProgressMessage {
  type: 'progress'
  payload: {
    progress: number
    sampled: number
  }
}

interface CompleteMessage {
  type: 'complete'
  payload: ReturnType<typeof normalizeCsvAnalysisResult>
}

interface ErrorMessage {
  type: 'error'
  payload: {
    message: string
  }
}

function reportError(message: string): void {
  self.postMessage({ type: 'error', payload: { message } } satisfies ErrorMessage)
}

self.onmessage = (event: MessageEvent<AnalyzeMessage>) => {
  const data = event.data
  if (!data || typeof data !== 'object' || data.type !== 'analyze') return
  const payload = data.payload
  if (!payload || !(payload.file instanceof Blob)) {
    reportError('The analyzer received no readable file.')
    return
  }

  const { file, sampleLimit } = payload
  const rawRows: string[][] = []
  let delimiter = ','

  // Papa surfaces synchronous setup failures by throwing rather than through
  // its `error` callback; without this the caller waits on a reply that never
  // comes.
  try {
    Papa.parse<string[]>(file, {
      header: false,
      skipEmptyLines: 'greedy',
      chunkSize: 1024 * 1024,
      chunk: (result: Papa.ParseResult<string[]>, parser: Papa.Parser) => {
        if (result.meta.delimiter) delimiter = result.meta.delimiter

        for (const row of result.data) {
          if (Array.isArray(row) && rawRows.length < sampleLimit) rawRows.push(row)
        }

        const progress = result.meta.cursor && file.size > 0
          ? Math.min(100, (result.meta.cursor / file.size) * 100)
          : 0
        self.postMessage({
          type: 'progress',
          payload: { progress, sampled: rawRows.length },
        } satisfies ProgressMessage)

        if (rawRows.length >= sampleLimit) parser.abort()
      },
      complete: () => {
        try {
          const analysis = normalizeCsvAnalysisResult(analyzeRawRows(rawRows, delimiter, 'single'))
          self.postMessage({ type: 'complete', payload: analysis } satisfies CompleteMessage)
        } catch (error) {
          reportError(errorMessage(error))
        }
      },
      error: (error: unknown) => {
        reportError(errorMessage(error))
      },
    })
  } catch (error) {
    reportError(errorMessage(error))
  }
}

export {}
