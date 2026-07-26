/// <reference lib="webworker" />
// Stream-parse and analyze CSV samples off the main thread. The worker returns a
// normalized CsvAnalysisResult so the mapping UI never receives partial arrays.
import Papa from 'papaparse'
import { analyzeRawRows } from '../core/csvAnalysis'
import { normalizeCsvAnalysisResult } from '../core/csvContract'

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

self.onmessage = (event: MessageEvent<AnalyzeMessage>) => {
  if (event.data.type !== 'analyze') return

  const { file, sampleLimit } = event.data.payload
  const rawRows: string[][] = []
  let delimiter = ','

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
        const message = error instanceof Error ? error.message : String(error)
        self.postMessage({ type: 'error', payload: { message } } satisfies ErrorMessage)
      }
    },
    error: (error: Error) => {
      self.postMessage({ type: 'error', payload: { message: error.message } } satisfies ErrorMessage)
    },
  })
}

export {}
