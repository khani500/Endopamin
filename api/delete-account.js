// api/delete-account.js
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const USER_ID_TABLES = [
  'nutrition_logs',
  'workout_logs',
  'personal_records',
  'workout_plans',
  'nutrition_plans',
  'notification_settings',
  'token_usage',
  'coach_memory',
];

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Server not configured' });
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Missing access token' });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData || !userData.user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  const userId = userData.user.id;

  try {
    for (const table of USER_ID_TABLES) {
      const { error } = await admin.from(table).delete().eq('user_id', userId);
      if (error) console.error(`delete-account: failed clearing ${table}:`, error.message);
    }

    const { error: profileErr } = await admin.from('profiles').delete().eq('id', userId);
    if (profileErr) console.error('delete-account: failed clearing profiles:', profileErr.message);

    const { error: delErr } = await admin.auth.admin.deleteUser(userId);
    if (delErr) {
      return res.status(500).json({ error: `Auth user deletion failed: ${delErr.message}` });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('delete-account error:', err);
    return res.status(500).json({ error: (err && err.message) || 'Deletion failed' });
  }
}
