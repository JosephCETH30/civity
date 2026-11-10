import { Component, type ReactNode } from 'react';

interface Props { children: ReactNode; fallback?: (error: Error, reset: () => void) => ReactNode; onError?: (e: Error) => void }

export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) {
    console.error('[ui]', error);
    this.props.onError?.(error);
  }
  reset = () => this.setState({ error: null });
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <div className="max-w-sm">
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="mt-2 text-sm text-ink-muted">{error.message}</p>
          <button className="mt-4 rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white" onClick={() => location.reload()}>Reload</button>
        </div>
      </div>
    );
  }
}
