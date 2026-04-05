/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import RouteErrorBoundary from './components/RouteErrorBoundary';
import Board from './pages/Board';
import Claim from './pages/Claim';
import Prompt from './pages/Prompt';
import Submit from './pages/Submit';
import Settings from './pages/Settings';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Board />} />
          <Route path="claim" element={<Claim />} />
          <Route path="prompt" element={<RouteErrorBoundary><Prompt /></RouteErrorBoundary>} />
          <Route path="submit" element={<Submit />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
