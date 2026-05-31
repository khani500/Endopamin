const iconClass = 'h-full w-full';

export const MOODS = [
  { id: 'fired', label: 'Fired', svg: <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2c0 0-5 4-5 9a5 5 0 0010 0c0-5-5-9-5-9z"/><path d="M12 12c0 0-2 1.5-2 3a2 2 0 004 0c0-1.5-2-3-2-3z" fill="currentColor"/></svg> },
  { id: 'strong', label: 'Strong', svg: <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 4h2l1 3h6l1-3h2"/><path d="M9 7v10M15 7v10"/><path d="M6 20h12"/><path d="M8 11h8"/></svg> },
  { id: 'tired', label: 'Tired', svg: <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 15s1.5-1 4-1 4 1 4 1"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/><path d="M8 9.5c.5-.5 1-.5 1.5 0M14.5 9.5c.5-.5 1-.5 1.5 0"/></svg> },
  { id: 'calm', label: 'Calm', svg: <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg> },
  { id: 'hyped', label: 'Hyped', svg: <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> },
];

export const TRAINING_OPTIONS = [
  { id: 'gym', title: 'Gym', sub: 'Equipment', path: '/gym', color: 'neon',
    svg: <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 4h2v16H6zM16 4h2v16h-2z"/><path d="M2 9h4M18 9h4M2 15h4M18 15h4"/><path d="M8 12h8"/></svg> },
  { id: 'home', title: 'Home', sub: 'No gear', path: '/workout/mobility', color: 'blue',
    svg: <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H5a1 1 0 01-1-1V9.5z"/><path d="M9 21V12h6v9"/></svg> },
  { id: 'desk', title: 'Desk Break', sub: '5 min', path: '/gym', color: 'purple',
    svg: <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="14" width="20" height="2" rx="1"/><path d="M6 16v4M18 16v4"/><path d="M12 14V8M9 8h6M12 5a1 1 0 100-2 1 1 0 000 2z" fill="currentColor"/></svg> },
];

export const TRAINING_CARD_COLORS = {
  neon: { bg: 'rgba(204,255,0,0.12)', border: 'rgba(204,255,0,0.2)', line: 'rgba(204,255,0,0.5)' },
  blue: { bg: 'rgba(100,180,255,0.09)', border: 'rgba(100,180,255,0.16)', line: 'rgba(100,180,255,0.5)' },
  purple: { bg: 'rgba(160,100,255,0.09)', border: 'rgba(160,100,255,0.16)', line: 'rgba(160,100,255,0.5)' },
};

export const ACTIVE_STATUS_SVG = (
  <svg className="h-2 w-2 shrink-0" viewBox="0 0 8 8" fill="none">
    <circle cx="4" cy="4" r="4" fill="#CCFF00" />
  </svg>
);
