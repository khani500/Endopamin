import { useCallback, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { FREE_SCAN_LIMIT, isProUser } from '../config/tiers';

const SCAN_COUNT_KEY = 'scan_count';

function readScanCount() {
  if (typeof window === 'undefined') return 0;
  return Number(localStorage.getItem(SCAN_COUNT_KEY)) || 0;
}

export function useScanLimit() {
  const { profile } = useAuth();
  const [scanCount, setScanCount] = useState(() => readScanCount());
  const canScan = isProUser(profile) || scanCount < FREE_SCAN_LIMIT;

  const incrementScan = useCallback(() => {
    const next = readScanCount() + 1;
    localStorage.setItem(SCAN_COUNT_KEY, String(next));
    setScanCount(next);
  }, []);

  return { scanCount, canScan, incrementScan };
}
