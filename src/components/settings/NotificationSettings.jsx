import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { registerForNotifications } from '../../services/notificationService';

const DEFAULT_SETTINGS = {
  streak_reminder: true,
  streak_reminder_time: '19:00',
  morning_coach: true,
  morning_time: '08:00',
  desk_breaks: false,
  desk_break_interval: 60,
  group_session_reminder: true,
};

const MORNING_DEFAULT_TIME = '08:00';
const getNotificationEnabled = () => typeof Notification !== 'undefined' && Notification.permission === 'granted';

export const NotificationSettings = () => {
  const { user } = useAuth();
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [notifEnabled, setNotifEnabled] = useState(getNotificationEnabled);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user?.id || !supabase) return undefined;
    let cancelled = false;

    const loadSettings = async () => {
      const { data, error } = await supabase
        .from('notification_settings')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (cancelled) return;
      window.setTimeout(() => {
        if (data && !error) {
          setSettings({
            ...DEFAULT_SETTINGS,
            streak_reminder: data.streak_reminder ?? DEFAULT_SETTINGS.streak_reminder,
            streak_reminder_time: data.streak_reminder_time?.slice(0, 5) || DEFAULT_SETTINGS.streak_reminder_time,
            morning_coach: data.morning_coach ?? DEFAULT_SETTINGS.morning_coach,
            morning_time: data.morning_time?.slice(0, 5) || DEFAULT_SETTINGS.morning_time,
            desk_breaks: data.desk_breaks ?? DEFAULT_SETTINGS.desk_breaks,
            desk_break_interval: data.desk_break_interval ?? DEFAULT_SETTINGS.desk_break_interval,
            group_session_reminder: data.group_session_reminder ?? DEFAULT_SETTINGS.group_session_reminder,
          });
        }
        setNotifEnabled(getNotificationEnabled());
      }, 0);
    };

    void loadSettings();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const enableNotifications = async () => {
    if (!user?.id) return;
    const granted = await registerForNotifications(user.id);
    setNotifEnabled(granted);
  };

  const saveSettings = async () => {
    if (!user?.id || !supabase) return;
    setSaving(true);
    await supabase
      .from('notification_settings')
      .upsert({ user_id: user.id, ...settings });
    setSaving(false);
  };

  const toggle = key => setSettings(prev => ({ ...prev, [key]: !prev[key] }));

  if (!user) {
    return (
      <div className="rounded-2xl border border-white/10 bg-[#111] p-4 text-left">
        <h2 className="text-lg font-bold text-white">Notifications</h2>
        <p className="mt-2 text-sm text-white/50">Sign in to manage reminders and alarms.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 text-left">
      <h2 className="text-lg font-bold text-white">Notifications</h2>

      {!notifEnabled && (
        <div className="rounded-2xl border border-[#CCFF00]/30 bg-[#1a1a1a] p-4">
          <p className="mb-3 text-sm text-white">Enable notifications to stay on track.</p>
          <button
            onClick={enableNotifications}
            className="w-full rounded-xl bg-[#CCFF00] px-4 py-2 text-sm font-bold text-black"
          >
            Enable Notifications
          </button>
        </div>
      )}

      <SettingRow
        title="Streak Reminder"
        subtitle="Alert when your streak is at risk"
        label="Fire"
        enabled={settings.streak_reminder}
        onToggle={() => toggle('streak_reminder')}
      >
        {settings.streak_reminder && (
          <TimeInput
            value={settings.streak_reminder_time}
            onChange={value => setSettings(prev => ({ ...prev, streak_reminder_time: value }))}
            label="Remind me at"
          />
        )}
      </SettingRow>

      <SettingRow
        title="Morning Coach"
        subtitle="Daily message from your coach"
        label="AM"
        enabled={settings.morning_coach}
        onToggle={() => toggle('morning_coach')}
      >
        {settings.morning_coach && (
          <div className="space-y-2">
            <TimeInput
              value={settings.morning_time}
              onChange={value => setSettings(prev => ({ ...prev, morning_time: value }))}
              label="Wake up time"
            />
            <button
              type="button"
              onClick={() => setSettings(prev => ({ ...prev, morning_time: MORNING_DEFAULT_TIME }))}
              className="rounded-lg border border-[#CCFF00]/30 px-3 py-1 text-xs font-bold text-[#CCFF00]"
            >
              Reset to 8:00 AM
            </button>
          </div>
        )}
      </SettingRow>

      <SettingRow
        title="Desk Break Reminders"
        subtitle="Stretch reminders for desk workers"
        label="Desk"
        enabled={settings.desk_breaks}
        onToggle={() => toggle('desk_breaks')}
      >
        {settings.desk_breaks && (
          <div className="mt-2">
            <p className="mb-2 text-xs text-gray-400">Remind every:</p>
            <div className="flex gap-2">
              {[30, 45, 60, 90].map(min => (
                <button
                  key={min}
                  onClick={() => setSettings(prev => ({ ...prev, desk_break_interval: min }))}
                  className={`rounded-lg px-3 py-1 text-sm font-medium ${
                    settings.desk_break_interval === min
                      ? 'bg-[#CCFF00] text-black'
                      : 'bg-[#2a2a2a] text-gray-400'
                  }`}
                >
                  {min}min
                </button>
              ))}
            </div>
          </div>
        )}
      </SettingRow>

      <SettingRow
        title="Group Session Alerts"
        subtitle="30 min before sessions start"
        label="Team"
        enabled={settings.group_session_reminder}
        onToggle={() => toggle('group_session_reminder')}
      />

      <button
        onClick={saveSettings}
        disabled={saving}
        className="w-full rounded-xl bg-[#CCFF00] px-4 py-3 text-sm font-bold text-black disabled:opacity-70"
      >
        {saving ? 'Saving...' : 'Save Settings'}
      </button>
    </div>
  );
};

const SettingRow = ({ title, subtitle, label, enabled, onToggle, children }) => (
  <div className="rounded-2xl bg-[#1a1a1a] p-4">
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <span className="min-w-10 rounded-xl bg-white/5 px-2 py-2 text-center text-xs font-bold text-[#CCFF00]">
          {label}
        </span>
        <div>
          <p className="text-sm font-medium text-white">{title}</p>
          <p className="text-xs text-gray-500">{subtitle}</p>
        </div>
      </div>
      <button
        type="button"
        aria-pressed={enabled}
        onClick={onToggle}
        className={`relative h-6 w-12 rounded-full transition-all ${
          enabled ? 'bg-[#CCFF00]' : 'bg-[#2a2a2a]'
        }`}
      >
        <span
          className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-all ${
            enabled ? 'left-7' : 'left-1'
          }`}
        />
      </button>
    </div>
    {children && <div className="mt-3">{children}</div>}
  </div>
);

const TimeInput = ({ value, onChange, label }) => (
  <div className="flex items-center gap-3">
    <p className="text-xs text-gray-400">{label}:</p>
    <input
      type="time"
      value={value}
      onChange={event => onChange(event.target.value)}
      className="rounded-lg bg-[#2a2a2a] px-3 py-1 text-sm text-white outline-none"
    />
  </div>
);

