import { Component, type ReactNode } from 'react';
import { ui } from '../lib/i18n';

export class RouteErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return <>
        <p role="alert">{ui("Could not load this screen.")}</p>
        <button type="button" className="button secondary" onClick={() => window.location.reload()}>
          {ui("Reload")}
        </button>
      </>;
    }
    return this.props.children;
  }
}
