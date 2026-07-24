import { attachComputeWorker, type WorkerScopeLike } from './workerRuntime'

attachComputeWorker(self as unknown as WorkerScopeLike)
