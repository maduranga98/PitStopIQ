import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
  label?: string;
}

interface State {
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, errorInfo: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    // eslint-disable-next-line no-console
    console.error(
      `[ErrorBoundary${this.props.label ? ` · ${this.props.label}` : ""}]`,
      error,
      errorInfo,
    );
  }

  reset = () => this.setState({ error: null, errorInfo: null });

  render() {
    const { error, errorInfo } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return (
      <div className="min-h-screen bg-[#0B1120] text-white flex items-center justify-center p-6">
        <div className="max-w-lg w-full bg-[#162032] border border-red-500/30 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-6 h-6 text-red-400 flex-shrink-0" />
            <h2 className="font-semibold text-white text-lg">Something went wrong</h2>
          </div>
          {this.props.label && (
            <p className="text-xs text-gray-500 uppercase tracking-wider">
              {this.props.label}
            </p>
          )}
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-sm text-red-300 break-words">
            <div className="font-medium">{error.name}: {error.message}</div>
          </div>
          {errorInfo?.componentStack && (
            <details className="text-xs text-gray-400">
              <summary className="cursor-pointer hover:text-white">Stack trace</summary>
              <pre className="mt-2 whitespace-pre-wrap break-words bg-black/30 p-2 rounded text-[11px] max-h-64 overflow-auto">
                {error.stack}
                {"\n\nComponent stack:"}
                {errorInfo.componentStack}
              </pre>
            </details>
          )}
          <div className="flex gap-2">
            <button
              onClick={this.reset}
              className="flex-1 bg-orange-500 hover:bg-orange-600 text-white py-2 rounded-lg text-sm font-medium"
            >
              Try again
            </button>
            <button
              onClick={() => window.location.assign("/")}
              className="flex-1 bg-white/10 hover:bg-white/20 text-white py-2 rounded-lg text-sm"
            >
              Go home
            </button>
          </div>
        </div>
      </div>
    );
  }
}
