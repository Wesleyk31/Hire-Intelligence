import { Component, Suspense, type ReactNode } from 'react';

type Props = { label: string; children: ReactNode };

export default class LazySection extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <section className="auth-panel" role="alert" style={{ margin: 24 }}>
          <h2>{this.props.label} could not be loaded.</h2>
          <p>Check your connection and reload the page to try again.</p>
          <button type="button" onClick={() => window.location.reload()}>
            Reload page
          </button>
        </section>
      );
    }
    return (
      <Suspense
        fallback={
          <div role="status" aria-live="polite" style={{ padding: 24 }}>
            Loading {this.props.label.toLowerCase()}…
          </div>
        }
      >
        {this.props.children}
      </Suspense>
    );
  }
}
