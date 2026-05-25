export function CoachMessageContent({ text }) {
  const paragraphs = String(text || '')
    .split(/\n\s*\n/)
    .map(block => block.trim())
    .filter(Boolean);

  if (!paragraphs.length) return null;

  return (
    <div className="space-y-3">
      {paragraphs.map((paragraph, index) => (
        <p key={index} className="leading-6 text-white/90">
          {paragraph.replace(/\*\*/g, '').replace(/^[-*•]\s+/gm, '')}
        </p>
      ))}
    </div>
  );
}
