// @ts-check
import { Component } from 'react';

/**
 * A per-pane error boundary.
 *
 * This is the one that saves a demo. A bug in the graph layout must degrade
 * THAT PANE to a message, not blank the application while someone is watching.
 * Wrapping the whole ViewGrid instead would defeat the point.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { err: null };
  }

  static getDerivedStateFromError(err) {
    return { err };
  }

  componentDidCatch(err, info) {
    console.error('[orrery] renderer crashed:', err, info);
  }

  render() {
    if (!this.state.err) return this.props.children;
    const text = `${this.state.err.message}\n${this.state.err.stack ?? ''}`;
    return (
      <div>
        <p className="pane-note">
          The <b>{this.props.label}</b> view crashed. The rest of the app is fine.
        </p>
        <div className="diag" data-sev="error">{this.state.err.message}</div>
        <button style={{ marginTop: 8, textDecoration: 'underline' }}
                onClick={() => navigator.clipboard?.writeText(text)}>
          copy the stack
        </button>
        <button style={{ marginTop: 8, marginLeft: 8, textDecoration: 'underline' }}
                onClick={() => this.setState({ err: null })}>
          try again
        </button>
      </div>
    );
  }
}
