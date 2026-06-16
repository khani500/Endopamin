import { supabase } from './supabase';

const DELETE_ACCOUNT_API_URL = 'https://endopamin.vercel.app/api/delete-account';

export async function deleteUserAccount() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('Not signed in');
  }

  const response = await fetch(DELETE_ACCOUNT_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
  });

  const raw = await response.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw new Error(data?.error || `Account deletion failed (${response.status})`);
  }

  await supabase.auth.signOut();
}
