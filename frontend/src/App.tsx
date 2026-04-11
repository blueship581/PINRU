/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './shared/components/Layout';
import RouteErrorBoundary from './shared/components/RouteErrorBoundary';
import Board from './features/board';
import Claim from './features/claim';
import Prompt from './features/prompt';
import Submit from './features/submit';
import Settings from './features/settings';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Board />} />
          <Route path="claim" element={<Claim />} />
          <Route path="prompt" element={<RouteErrorBoundary><Prompt /></RouteErrorBoundary>} />
          <Route path="submit" element={<Submit />} />
          <Route path="settings" element={<RouteErrorBoundary><Settings /></RouteErrorBoundary>} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
