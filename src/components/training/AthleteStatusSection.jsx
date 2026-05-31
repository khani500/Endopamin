import { ACTIVE_STATUS_SVG, MOODS } from './trainingSectionData';

function MoodButton({ mood, selected, onSelect }) {
  const active = selected === mood.id;

  return (
    <button
      type="button"
      onClick={() => onSelect?.(mood.id)}
      className={`flex flex-col items-center justify-center gap-2 rounded-[16px] border transition-all duration-200 active:scale-95 ${
        active
          ? 'border-[#CCFF00]/35 bg-[#CCFF00]/08'
          : 'border-white/[0.07] bg-white/[0.03]'
      }`}
      style={{
        minHeight: 76,
        padding: '12px 6px',
        boxShadow: active ? '0 0 12px rgba(204,255,0,0.08)' : undefined,
      }}
    >
      <div className={`w-6 h-6 shrink-0 ${active ? 'text-[#CCFF00]' : 'text-white/40'}`}>
        {mood.svg}
      </div>
      <div className={`text-[10px] font-semibold leading-none ${active ? 'text-[#CCFF00]' : 'text-white/45'}`}>
        {mood.label}
      </div>
    </button>
  );
}

export default function AthleteStatusSection({
  selectedMood,
  onMoodChange,
  className = 'mx-[18px] mb-5',
  variant = 'default',
}) {
  const isCoach = variant === 'coach';

  return (
    <div
      className={`${className} rounded-[24px] border border-white/[0.07] p-4`}
      style={{
        background: 'linear-gradient(135deg,rgba(255,255,255,0.04),rgba(255,255,255,0.015))',
        boxShadow: '0 8px 28px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)',
      }}
    >
      <div className="flex justify-between items-center mb-4">
        <p className="text-[10px] tracking-[2px] uppercase text-white/40 font-bold">Athlete Status</p>
        <span className="flex items-center gap-1.5 text-[10px] text-[#CCFF00] font-bold bg-[#CCFF00]/10 border border-[#CCFF00]/20 px-2 py-0.5 rounded-full">
          {ACTIVE_STATUS_SVG}
          Active
        </span>
      </div>

      {isCoach ? (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            {MOODS.slice(0, 3).map(mood => (
              <MoodButton
                key={mood.id}
                mood={mood}
                selected={selectedMood}
                onSelect={onMoodChange}
              />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 max-w-[66%] mx-auto">
            {MOODS.slice(3).map(mood => (
              <MoodButton
                key={mood.id}
                mood={mood}
                selected={selectedMood}
                onSelect={onMoodChange}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          {MOODS.map(mood => (
            <button
              key={mood.id}
              type="button"
              onClick={() => onMoodChange?.(mood.id)}
              className={`flex-1 flex flex-col items-center justify-center gap-1.5 py-2.5 rounded-[14px] border transition-all duration-200 ${
                selectedMood === mood.id
                  ? 'border-[#CCFF00]/35 bg-[#CCFF00]/08'
                  : 'border-white/[0.07] bg-white/[0.03]'
              }`}
              style={selectedMood === mood.id ? { boxShadow: '0 0 12px rgba(204,255,0,0.08)' } : {}}
            >
              <div className={`w-5 h-5 ${selectedMood === mood.id ? 'text-[#CCFF00]' : 'text-white/40'}`}>
                {mood.svg}
              </div>
              <div className={`text-[9px] font-medium ${selectedMood === mood.id ? 'text-[#CCFF00]' : 'text-white/40'}`}>
                {mood.label}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
