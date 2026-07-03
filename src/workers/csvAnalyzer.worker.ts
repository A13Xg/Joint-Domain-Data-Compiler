/// <reference lib="webworker" />
// Thin sampling worker: stream-parses the CSV off the main thread and returns
// a raw-row sample plus the sniffed delimiter. Column intelligence runs on the
// main thread (core/csvAnalysis) so header settings can re-analyze instantly.
import Papa from 'papaparse'

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

export interface SampleResult {
  delimiter: string
  rawRows: string[][]
}

interface CompleteMessage {
  type: 'complete'
  payload: SampleResult
}

interface ErrorMessage {
  type: 'error'
  payload: {
    message: string
  }
}

self.onmessage = (event: MessageEvent<AnalyzeMessage>) => {
  if (event.data.type !== 'analyze') {
    return
  }

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
        if (rawRows.length < sampleLimit) rawRows.push(row)
      }

      const progress = result.meta.cursor
        ? Math.min(100, (result.meta.cursor / file.size) * 100)
        : 0
      self.postMessage({
        type: 'progress',
        payload: { progress, sampled: rawRows.length },
      } satisfies ProgressMessage)

      if (rawRows.length >= sampleLimit) parser.abort()
    },
    complete: () => {
      self.postMessage({
        type: 'complete',
        payload: { delimiter, rawRows },
      } satisfies CompleteMessage)
    },
    error: (error: Error) => {
      self.postMessage({ type: 'error', payload: { message: error.message } } satisfies ErrorMessage)
    },
  })
}

export {}
