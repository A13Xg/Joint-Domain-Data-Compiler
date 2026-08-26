// Top-level error boundary. Any render-time crash is caught, logged through the
// structured logger, and shown with a recovery action instead of a white screen.
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { logger, serializeError } from '../core/logger'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logger.error('ui', `Render error: ${error.message}`, {
      ...serializeError(error),
      componentStack: info.componentStack,
    })
  }

  private reset = () => this.setState({ error: null })

  render() {
    if (this.state.error) {
      return (
        <div className="error-boundary">
          <div className="error-boundary-card">
            <h2>Something went wrong in the UI</h2>
            <p className="mono">{this.state.error.message}</p>
            <p className="muted">
              The error was captured in the log console. Your loaded data is preserved in memory.
            </p>
            <button type="button" onClick={this.reset}>
              Dismiss and continue
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
