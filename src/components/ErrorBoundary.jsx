import { Component } from 'react';

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error(this.props.label || 'Render error', error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return this.props.fallback || (
      <div className="rounded-2xl border border-[#CCFF00]/25 bg-[#141416] p-4 text-white">
        <p className="text-sm font-black text-[#CCFF00]">Something went wrong</p>
        <p className="mt-2 text-xs leading-5 text-white/55">
          This section failed to load, but the app is still running.
        </p>
        <button
          type="button"
          onClick={() => this.setState({ hasError: false, error: null })}
          className="mt-3 rounded-xl bg-[#CCFF00] px-3 py-2 text-xs font-black text-black"
        >
          Try again
        </button>
      </div>
    );
  }
}
