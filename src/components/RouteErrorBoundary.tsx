// @ts-nocheck
import { AlertTriangle, RefreshCw } from 'lucide-react';
import React, { type ErrorInfo, type ReactNode } from 'react';

type Props = {
  children: ReactNode;
};

type State = {
  hasError: boolean;
  errorMessage: string;
};

export default class RouteErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      errorMessage: '',
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      errorMessage: error.message || '页面渲染失败',
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Route render failed:', error, info);
  }

  private handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="h-full flex items-center justify-center p-8 bg-stone-50 dark:bg-[#161615]">
        <div className="w-full max-w-lg rounded-3xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 shadow-sm px-8 py-10 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 dark:bg-red-900/20 text-red-500">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <h2 className="text-lg font-bold text-stone-900 dark:text-stone-50 tracking-tight">
            页面加载失败
          </h2>
          <p className="mt-2 text-sm leading-6 text-stone-500 dark:text-stone-400">
            已拦截本次路由渲染异常，避免直接黑屏。可以先刷新重试；如果仍然失败，再继续定位具体报错。
          </p>
          {this.state.errorMessage && (
            <div className="mt-5 rounded-2xl bg-stone-50 dark:bg-stone-800/50 border border-stone-200 dark:border-stone-700 px-4 py-3 text-left font-mono text-xs leading-5 text-stone-600 dark:text-stone-300 break-all">
              {this.state.errorMessage}
            </div>
          )}
          <div className="mt-6 flex justify-center">
            <button
              onClick={this.handleReload}
              className="px-5 py-2.5 bg-[#111827] hover:bg-[#1F2937] dark:bg-[#E5EAF2] dark:hover:bg-[#F3F6FB] text-white dark:text-[#0D1117] rounded-full text-sm font-semibold transition-colors shadow-sm flex items-center gap-2 cursor-default"
            >
              <RefreshCw className="w-4 h-4" />
              刷新页面
            </button>
          </div>
        </div>
      </div>
    );
  }
}
