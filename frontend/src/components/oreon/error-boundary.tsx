import { Component, type ReactNode } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";

interface Props {
  children: ReactNode;
  /** Short label for what failed, e.g. "Command Center". */
  section?: string;
}
interface State {
  hasError: boolean;
  message?: string;
}

/**
 * Section-level error boundary. Keeps a single broken panel from blanking the
 * whole app — shows a recoverable inline error instead of an empty screen.
 */
export class SectionErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message };
  }

  componentDidCatch(error: Error) {
    // eslint-disable-next-line no-console
    console.warn("[OREON] section error:", error.message);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="h-full w-full grid place-items-center p-8">
        <div className="max-w-sm text-center">
          <div className="mx-auto mb-4 grid size-11 place-items-center rounded-full border border-amber-500/30 bg-amber-500/10">
            <AlertTriangle className="size-5 text-amber-400" strokeWidth={1.75} />
          </div>
          <div className="text-[15px] font-medium text-foreground">
            {this.props.section ? `${this.props.section} hit a snag` : "This view hit a snag"}
          </div>
          <p className="mt-1.5 text-[13px] text-text-muted">
            The rest of OREON is still running. Reloading this section usually clears it.
          </p>
          <button
            onClick={() => this.setState({ hasError: false, message: undefined })}
            className="mt-5 inline-flex items-center gap-2 h-9 px-4 rounded-md border border-border text-[12px] font-mono text-text-secondary hover:text-foreground hover:bg-surface-2 transition-colors"
          >
            <RotateCw className="size-3.5" strokeWidth={1.75} /> Retry
          </button>
        </div>
      </div>
    );
  }
}
