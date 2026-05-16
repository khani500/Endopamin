import { Link } from 'react-router-dom';
import { LifestyleSettings } from '../components/settings/LifestyleSettings';
import { NotificationSettings } from '../components/settings/NotificationSettings';

export default function PlaceholderPage({ title }) {
  const isProfile = title === 'Profile';

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0a0a0a',
        color: '#fafafa',
        padding: '48px 20px 100px',
        fontFamily: 'system-ui, sans-serif',
        textAlign: 'center',
      }}
    >
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>{title}</h1>
      <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14, marginBottom: 28 }}>
        {isProfile ? 'Manage your Dopa Peak account.' : 'Coming soon in Dopa Peak.'}
      </p>
      {isProfile && (
        <div style={{ maxWidth: 390, margin: '0 auto 24px' }}>
          <LifestyleSettings />
          <NotificationSettings />
        </div>
      )}
      <Link
        to="/"
        style={{
          display: 'inline-block',
          padding: '12px 24px',
          borderRadius: 12,
          background: '#39ff14',
          color: '#0a0a0a',
          fontWeight: 800,
          textDecoration: 'none',
        }}
      >
        Back to Home
      </Link>
    </div>
  );
}
