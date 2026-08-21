import { defaultState, mergeState, migrate, isoDate } from './logic.js';

// index.html definerer window.EDGE_FUNCTION_URL (tom streng i utvikling = localStorage-modus).
const EDGE = () => (window.EDGE_FUNCTION_URL || '').trim();

// Rom-ID fra URL-hash (#r=...) eller opprett ny og skriv til hash.
// Rom-ID-en er bare en delbar identifikator for familiens datablob, ikke en hemmelig nøkkel.
export function getRoom() {
  const m = location.hash.match(/[#&]r=([^&]+)/);
  if (m) return decodeURIComponent(m[1]);
  const id = 'h_' + crypto.randomUUID().replace(/-/g, '');
  location.hash = 'r=' + id;
  return id;
}

const cacheKey = (room) => 'honniscoins:' + room;

export function loadLocal(room) {
  try {
    const raw = localStorage.getItem(cacheKey(room));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
export function saveLocal(room, state) {
  try {
    localStorage.setItem(cacheKey(room), JSON.stringify(state));
  } catch {}
}

export async function loadRemote(room) {
  if (!EDGE()) return null;
  try {
    const r = await fetch(EDGE(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ room, action: 'load' }),
    });
    const j = await r.json();
    return j.data || null;
  } catch {
    return null;
  }
}

export async function saveRemote(room, state) {
  if (!EDGE()) return false;
  try {
    const r = await fetch(EDGE(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ room, action: 'save', data: state }),
    });
    return (await r.json()).ok === true;
  } catch {
    return false;
  }
}

// Lokal cache + remote, flettet. Alltid en gyldig state ut.
export async function loadState(room) {
  const local = loadLocal(room) || defaultState();
  const remote = await loadRemote(room);
  // Migrer før fletting: fyll manglende felt og lås eksisterende dager med innhold,
  // så opptjente poeng ikke forsvinner når «lås styrer alt» tas i bruk.
  const today = isoDate(new Date());
  const merged = migrate(mergeState(local, remote), today);
  saveLocal(room, merged);
  return merged;
}

// Debounce-lagring (600 ms). Lokal cache skrives umiddelbart.
let saveTimer = null;
export function scheduleSave(room, getState) {
  saveLocal(room, getState());
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveRemote(room, getState()), 600);
}

// Polling: hent remote, flett inn. Tegn KUN på nytt når fletting faktisk endrer
// vår nåværende state (dvs. skyen hadde noe nytt) — ikke for våre egne endringer.
// Det hindrer at UI-et tegnes om under skriving og stjeler fokus.
export function startPolling(room, getState, applyMerged, intervalMs = 5000) {
  setInterval(async () => {
    const remote = await loadRemote(room);
    if (!remote) return;
    const current = JSON.stringify(getState());
    const merged = mergeState(getState(), remote);
    if (JSON.stringify(merged) !== current) {
      saveLocal(room, merged);
      applyMerged(merged);
    }
  }, intervalMs);
}
