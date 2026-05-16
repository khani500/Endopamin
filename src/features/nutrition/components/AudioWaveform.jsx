const BAR_COUNT = 28;

export function AudioWaveform({ active }) {
  return (
    <div className={`np-wave ${active ? 'np-wave--active' : ''}`} role="img" aria-label={active ? 'Coach is speaking' : 'Audio idle'}>
      {Array.from({ length: BAR_COUNT }).map((_, i) => (
        <span key={i} style={{ animationDelay: active ? `${(i * 28) % 420}ms` : undefined }} />
      ))}
    </div>
  );
}
