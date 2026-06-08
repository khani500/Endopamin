import { useNavigate } from 'react-router-dom';

export default function GroupSession() {
  const navigate = useNavigate();
  return (
    <main className="mx-auto min-h-screen w-full max-w-[430px] bg-[#0A0A0A] px-4 pb-24 pt-8 text-white flex flex-col">
      <button
        type="button"
        onClick={() => navigate(-1)}
        style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', marginBottom: 32 }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
      </button>

      <div className="flex-1 flex flex-col items-center justify-center text-center gap-6">
        <div style={{ width: 72, height: 72, borderRadius: 20, background: 'rgba(204,255,0,0.08)', border: '1px solid rgba(204,255,0,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#CCFF00" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
        </div>

        <div>
          <h1 className="text-2xl font-black text-white mb-2">Train Together</h1>
          <p className="text-white/40 text-sm leading-relaxed">Group sessions are coming soon.<br/>Work out in sync with your crew.</p>
        </div>

        <div style={{ background: 'rgba(204,255,0,0.06)', border: '1px solid rgba(204,255,0,0.15)', borderRadius: 16, padding: '16px 24px' }}>
          <p className="text-[#CCFF00] text-xs font-black uppercase tracking-widest mb-1">Coming Soon</p>
          <p className="text-white/30 text-xs">Shared timers · Group chat · Live sync</p>
        </div>
      </div>
    </main>
  );
}
