"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class MapErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-full flex items-center justify-center bg-neutral-100 rounded-lg border border-neutral-200">
          <div className="text-center text-neutral-400">
            <p className="text-sm font-medium">Map unavailable</p>
            <p className="text-xs mt-1">WebGL required for map rendering</p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
