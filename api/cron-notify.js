import crypto from 'crypto';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY;

const COACH_PERSONALITIES = {
  kane: 'Harsh drill sergeant. Military tone. No sympathy. Very short commands.',
  elias: 'Calm scientific coach. Uses data and physiology. Warm underneath but precise.',
  aria: 'Warm encouraging scientist. Playful, data-driven, genuinely cares.',
};

async function getAccessToken() {
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  if (!sa.client_email || !sa.private_key) throw new Error('No service account');

  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  })).toString('base64url');

  const sign = crypto.createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const jwt = `${header}.${payload}.${sign.sign(sa.private_key, 'base64url')}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const data = await res.json();
  return data.access_token;
}

async function generateContent(profile) {
  const coachId = profile.coach_persona || 'elias';
  const name = profile.display_name || 'Champion';
  const streak = profile.streak_count || 0;
  const goal = profile.goal || 'fitness';

  const lastActive = profile.last_active ? new Date(profile.last_active) : null;
  const daysAgo = lastActive ? Math.floor((Date.now() - lastActive.getTime()) / 86400000) : 3;

  const timeOfDay = new Date().getHours();
  const tod = timeOfDay < 12 ? 'morning' : timeOfDay < 17 ? 'afternoon' : 'evening';

  const scenarios = [
    `${name} hasn't worked out in ${daysAgo} days. Roast them gently.`,
    `${name} has a ${streak}-day streak. Hype them up like they won the Olympics.`,
    `Send ${name} a completely unexpected random fitness fact that blows their mind.`,
    `Challenge ${name} to do one thing RIGHT NOW. Something tiny but specific.`,
    `${name} is slacking. Make them laugh while feeling guilty.`,
    `Tell ${name} something their body is doing right now that's actually amazing.`,
    `Send ${name} a weird motivational quote that makes no sense but somehow works.`,
  ];
  const scenario = scenarios[Math.floor(Math.random() * scenarios.length)];

  const prompt = `You are ${coachId.toUpperCase()} fitness coach texting your athlete at ${tod}.
PERSONALITY: ${COACH_PERSONALITIES[coachId] || COACH_PERSONALITIES.elias}
MISSION: ${scenario}
USER GOAL: ${goal}
RULES:
- Title: max 45 chars, punchy, unexpected, sometimes emoji
- Body: max 90 chars, make them smile OR feel fired up OR both
- Sound exactly like THIS coach, not generic
- Be unpredictable. No clichés. Surprise them.
- Sometimes be weird. Sometimes be tough. Sometimes be funny.
Return ONLY raw JSON: {"title": "...", "body": "..."}`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.95, maxOutputTokens: 150 },
        }),
      }
    );
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const clean = text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    const defaults = {
      kane: { title: 'Get off the couch.', body: 'No excuses. The bar is loaded. Move.' },
      elias: { title: 'Your muscles need stimulus.', body: 'Recovery window is closing. Time to train.' },
      aria: { title: 'Missing you! 💚', body: 'Consistency beats intensity. Let\'s go!' },
    };
    return defaults[coachId] || defaults.elias;
  }
}

async function sendExpoPush(token, title, body) {
  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ to: token, title, body }),
  });
  if (!res.ok) return false;
  try {
    const { data } = await res.json();
    const ticket = Array.isArray(data) ? data[0] : data;
    return ticket?.status === 'ok';
  } catch {
    return false;
  }
}

async function sendFCM(token, title, body, accessToken, projectId) {
  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        message: {
          token,
          notification: { title, body },
          webpush: {
            notification: {
              title, body,
              icon: '/logo.png',
              badge: '/badge.png',
              vibrate: [200, 100, 200],
            },
          },
        },
      }),
    }
  );
  return res.ok;
}

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization || '';
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
    const projectId = sa.project_id;
    if (!projectId) return res.status(500).json({ error: 'No Firebase project ID' });

    const usersRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=*`, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    });
    const users = await usersRes.json();
    console.log("DB users:", users?.length, JSON.stringify(users).slice(0,200));
  if (!users?.length) return res.status(200).json({ sent: 0, db: users });

    const accessToken = await getAccessToken();
    const now = Date.now();
    const results = [];

    for (const profile of users) {
      if (!profile.fcm_token) continue;

      if (profile.last_notification_at) {
        const hoursSince = (now - new Date(profile.last_notification_at).getTime()) / 3600000;
        if (hoursSince < 6) continue;
      }

      const lastActive = profile.last_active ? new Date(profile.last_active) : null;
      const daysAgo = lastActive ? (now - lastActive.getTime()) / 86400000 : 5;
      const shouldSend = daysAgo >= 3 || Math.random() < 0.20;
      if (!shouldSend) continue;

      const { title, body } = await generateContent(profile);
      const token = profile.fcm_token;
      const sent = token.startsWith('ExponentPushToken[')
        ? await sendExpoPush(token, title, body)
        : await sendFCM(token, title, body, accessToken, projectId);

      if (sent) {
        await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${profile.id}`, {
          method: 'PATCH',
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({ last_notification_at: new Date().toISOString() }),
        });
        results.push({ id: profile.id, title });
      }
    }

    return res.status(200).json({ sent: results.length, notifications: results });
  } catch (err) {
    console.error('Cron notify error:', err);
    return res.status(500).json({ error: err.message });
  }
}
