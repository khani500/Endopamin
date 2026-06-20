import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { FREE_SCAN_LIMIT, isProUser } from '../config/tiers';

const SCAN_COUNT_KEY = 'scan_count';

function readScanCount() {
  if (typeof window === 'undefined') return 0;
  return Number(localStorage.getItem(SCAN_COUNT_KEY)) || 0;
}

function writeScanCount(count) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(SCAN_COUNT_KEY, String(count));
}

export function useScanLimit() {
  const { profile } = useAuth();
  const [scanCount, setScanCount] = useState(() => readScanCount());
  const isPro = isProUser(profile);

  const resetScanCount = useCallback(() => {
    writeScanCount(0);
    setScanCount(0);
  }, []);

  const canScan = useMemo(() => {
    if (isPro) return true;
    return scanCount < FREE_SCAN_LIMIT;
  }, [isPro, scanCount]);

  useEffect(() => {
    if (isPro) resetScanCount();
  }, [isPro, resetScanCount]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('upgraded') !== 'true') return;

    resetScanCount();
    params.delete('upgraded');
    const query = params.toString();
    window.history.replaceState(
      {},
      '',
      query ? `${window.location.pathname}?${query}` : window.location.pathname,
    );
  }, [resetScanCount]);

  const incrementScan = useCallback(() => {
    if (isProUser(profile)) return;
    const next = readScanCount() + 1;
    writeScanCount(next);
    setScanCount(next);
  }, [profile]);

  return { scanCount, canScan, incrementScan, resetScanCount };
}
