import { TRAINING_CARD_COLORS, TRAINING_OPTIONS } from './trainingSectionData';

export default function ChooseTrainingSection({ onSelect, className = '' }) {
  return (
    <div className={className}>
      <p className="px-[18px] text-[10px] tracking-[2.5px] uppercase text-white/40 font-bold mb-3">Choose Training</p>
      <div className="px-[18px] grid grid-cols-3 gap-[10px] mb-5">
        {TRAINING_OPTIONS.map(item => {
          const colors = TRAINING_CARD_COLORS[item.color];

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect?.(item)}
              className="rounded-[22px] p-4 flex flex-col justify-between min-h-[120px] relative overflow-hidden border transition-transform duration-200 active:scale-95"
              style={{
                background: `linear-gradient(145deg, ${colors.bg}, rgba(0,0,0,0))`,
                borderColor: colors.border,
                boxShadow: '0 10px 32px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.07)',
              }}
            >
              <div
                className="absolute bottom-0 left-0 right-0 h-[2px] rounded-b-[22px]"
                style={{ background: `linear-gradient(90deg,transparent,${colors.line},transparent)` }}
              />
              <div className="w-8 h-8" style={{ color: colors.line }}>{item.svg}</div>
              <div>
                <p className="text-[11px] font-bold text-white leading-tight">{item.title}</p>
                <p className="text-[9px] text-white/40 mt-0.5">{item.sub}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
