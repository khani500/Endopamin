/**
 * Reusable glassmorphism surface (pure black theme + neon accents applied by parent).
 */
export function GlassCard({ children, className = '' }) {
  return <div className={`np-card ${className}`.trim()}>{children}</div>;
}
