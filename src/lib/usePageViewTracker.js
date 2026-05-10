// Hooks React Router's location into the page_visits tracker. Mount once
// at the top of the app (after BrowserRouter), and every subsequent route
// change logs a row to public.page_visits.
//
// Without this, the tracker only catches the initial pageload — which is
// fine for source attribution but misses multi-page sessions, so we
// couldn't tell which screens get viewed most.
//
// Skips the FIRST location change because trackVisit.js already logs the
// initial load on module import.

import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { logPageVisit } from './trackVisit';

export function usePageViewTracker() {
  const location = useLocation();
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      // Initial mount — trackVisit.js IIFE already logged this
      firstRun.current = false;
      return;
    }
    logPageVisit();
  }, [location.pathname, location.search]);
}
