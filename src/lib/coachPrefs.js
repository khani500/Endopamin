const COACH_STORAGE_KEY = 'endopamin_coach';
const HISTORY_STORAGE_KEY = 'endopamin_history';

export function getSavedCoachId() {
  try {
    return sessionStorage.getItem(COACH_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function saveCoachId(coachId) {
  try {
    sessionStorage.setItem(COACH_STORAGE_KEY, coachId);
  } catch {
    // ignore
  }
}

export function clearCoachSessionPrefs() {
  try {
    sessionStorage.removeItem(HISTORY_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function syncCoachPrefs(coachId) {
  saveCoachId(coachId);
  clearCoachSessionPrefs();
}
