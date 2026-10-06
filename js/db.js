/*
 * Дата давхарга — Firebase Firestore + Auth.
 * Бүх хуудас зөвхөн энэ файлын функцуудыг дууддаг; Firestore-той шууд харьцдаггүй.
 *
 * Collections:
 *   stallions/{slug}   — азарга (нийтэд уншигдана, зөвхөн админ бичнэ); confirmedMares/confirmedCount тоолуур
 *   bookings/{code}    — захиалга бүрэн (утас г.м): кодоо мэддэг хүн get хийнэ, жагсаалтыг зөвхөн админ
 *   queue/{code}       — захиалгын нийтэд харагдах хэсэг (азарга, гүүний тоо, төлөв, дараалал); утас байхгүй
 *   settings/site      — сайтын нэр, утас, нөхцөл (нийтэд уншигдана, админ бичнэ)
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getFirestore, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, query, where, orderBy,
  writeBatch, runTransaction, serverTimestamp, increment
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { firebaseConfig } from './firebase-config.js';

export const configured = !!firebaseConfig.projectId && !/YOUR_/.test(firebaseConfig.projectId);

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

const DEFAULT_SETTINGS = {
  siteName: 'Морьтон Үржүүлэг',
  siteTagline: 'Үржүүлгийн азарганд гүү тавих захиалга',
  orgName: 'Морьтон Групп — Үржүүлгийн алба',
  phone: '7000-0000',
  address: 'Хүй 7, Төв аймаг',
  season: '2027 оны хавар',
  defaultCapacity: 10,
  maxMaresPerBooking: 5,
  terms: [
    'Захиалга нь ажилтан утсаар холбогдож баталгаажуулснаар хүчин төгөлдөр болно.',
    'Гүүг хавар (4–6 сард) баталгаажсан дарааллын дагуу азарганд тавина.',
    'Үржүүлгийн үнийг гүү тавихаас өмнө бүрэн төлнө. «Private» азарганы үнийг тохиролцоно.',
    'Гүү нь эрүүл, ийлдэс/шинжилгээний бичигтэй байх шаардлагатай.',
    'Захиалгаа цуцлах бол дор хаяж 14 хоногийн өмнө мэдэгдэнэ.'
  ]
};

// ------------------------------------------------------------ helpers
export function toDate(v) {
  if (!v) return null;
  if (typeof v.toDate === 'function') return v.toDate();
  if (typeof v === 'string' || typeof v === 'number') return new Date(v);
  if (v.seconds != null) return new Date(v.seconds * 1000);
  return null;
}
export function friendlyError(e) {
  const code = (e && e.code) || '';
  if (/permission-denied/.test(code)) return 'Эрх хүрэхгүй байна (Firestore дүрэм татгалзлаа). Админ имэйл firestore.rules дотор байгаа эсэхийг шалгана уу.';
  if (/unavailable|network/.test(code)) return 'Сүлжээний алдаа. Интернэт холболтоо шалгана уу.';
  if (/auth\/(invalid-credential|wrong-password|user-not-found|invalid-email)/.test(code)) return 'Имэйл эсвэл нууц үг буруу байна.';
  if (/auth\/too-many-requests/.test(code)) return 'Хэт олон оролдлого. Түр хүлээгээд дахин оролдоно уу.';
  if (/failed-precondition/.test(code) && /index/i.test(e.message || '')) return 'Firestore индекс дутуу: ' + e.message;
  return (e && e.message) || String(e);
}
function genCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return 'GT-' + Array.from(bytes).map(b => alphabet[b % alphabet.length]).join('');
}
function cleanStr(v, max) {
  return String(v == null ? '' : v).replace(/[<>\u0000-\u001F]/g, '').trim().slice(0, max);
}
export function maskName(name) {
  return String(name || '').trim().split(/\s+/).map(w => w.length <= 1 ? w : w[0] + '.').join(' ');
}
function stats(s) {
  const capacity = Number(s.capacity || DEFAULT_SETTINGS.defaultCapacity);
  const confirmedMares = Number(s.confirmedMares || 0);
  const pendingMares = Number(s._pendingMares || 0);
  const remaining = Math.max(0, capacity - confirmedMares);
  let status = 'open';
  if (s.active === false) status = 'inactive';
  else if (remaining <= 0) status = 'full';
  return { capacity, confirmedMares, pendingMares, remaining, status, confirmedCount: Number(s.confirmedCount || 0), pendingCount: Number(s._pendingCount || 0) };
}

// ------------------------------------------------------------ settings
let settingsCache = null;
export async function getSettings() {
  if (settingsCache) return settingsCache;
  let data = {};
  try { const snap = await getDoc(doc(db, 'settings', 'site')); if (snap.exists()) data = snap.data(); } catch (e) { /* дүрэм/сүлжээ — анхдагчаар */ }
  settingsCache = Object.assign({}, DEFAULT_SETTINGS, data);
  return settingsCache;
}
export async function saveSettings(obj) {
  await setDoc(doc(db, 'settings', 'site'), obj, { merge: true });
  settingsCache = null;
}

// ------------------------------------------------------------ public reads
async function loadQueueAll() {
  const snap = await getDocs(collection(db, 'queue'));
  return snap.docs.map(d => ({ code: d.id, ...d.data() }));
}
function attachPending(stallions, queue) {
  const pend = {};
  queue.forEach(q => { if (q.status === 'pending') { const p = pend[q.stallion] || (pend[q.stallion] = { m: 0, c: 0 }); p.m += Number(q.mares || 0); p.c += 1; } });
  return stallions.map(s => {
    const p = pend[s.slug] || { m: 0, c: 0 };
    const withPending = { ...s, _pendingMares: p.m, _pendingCount: p.c };
    return { ...s, stats: stats(withPending) };
  });
}
export async function listStallions() {
  const [snap, queue] = await Promise.all([getDocs(collection(db, 'stallions')), loadQueueAll()]);
  const list = snap.docs.map(d => ({ slug: d.id, ...d.data() })).sort((a, b) => (a.order || 99) - (b.order || 99));
  return attachPending(list, queue);
}
export async function getStallion(slug) {
  const [snap, qsnap] = await Promise.all([
    getDoc(doc(db, 'stallions', slug)),
    getDocs(query(collection(db, 'queue'), where('stallion', '==', slug)))
  ]);
  if (!snap.exists()) throw new Error('Азарга олдсонгүй');
  const queue = qsnap.docs.map(d => ({ code: d.id, ...d.data() }));
  const s = attachPending([{ slug: snap.id, ...snap.data() }], queue)[0];
  const confirmedQueue = queue.filter(q => q.status === 'confirmed').sort((a, b) => (a.queueFrom || 0) - (b.queueFrom || 0));
  return { stallion: s, queue: confirmedQueue };
}

// ------------------------------------------------------------ public booking
export async function createBooking(input) {
  const settings = await getSettings();
  const slug = cleanStr(input.stallion, 60);
  const snap = await getDoc(doc(db, 'stallions', slug));
  if (!snap.exists()) throw new Error('Азарга олдсонгүй');
  const s = { slug, ...snap.data() };
  const st = stats(s);
  if (st.status === 'inactive') throw new Error('Энэ азарга одоогоор захиалга авахгүй байна');
  if (st.status === 'full') throw new Error(`Уучлаарай, ${s.name} азарга дүүрсэн (${st.capacity}/${st.capacity})`);
  const ownerName = cleanStr(input.ownerName, 80);
  const phone = cleanStr(input.phone, 30).replace(/[^\d+]/g, '');
  const mares = Math.floor(Number(input.mares || 1));
  const maxM = Number(settings.maxMaresPerBooking || 5);
  if (ownerName.length < 2) throw new Error('Нэрээ оруулна уу');
  if (!/^\+?\d{8,15}$/.test(phone)) throw new Error('Утасны дугаар буруу байна (8 оронтой байх ёстой)');
  if (!(mares >= 1 && mares <= maxM)) throw new Error(`Гүүний тоо 1–${maxM} хооронд байна`);
  if (mares > st.remaining) throw new Error(`Энэ азарганд ${st.remaining} суудал л үлдсэн байна`);
  if (input.website) throw new Error('Spam');

  const code = genCode();
  const batch = writeBatch(db);
  batch.set(doc(db, 'bookings', code), {
    code, stallion: slug, ownerName, phone, mares,
    mareInfo: cleanStr(input.mareInfo, 500), location: cleanStr(input.location, 120), note: cleanStr(input.note, 500),
    status: 'pending', createdAt: serverTimestamp()
  });
  batch.set(doc(db, 'queue', code), { code, stallion: slug, mares, status: 'pending', createdAt: serverTimestamp() });
  await batch.commit();
  return code;
}
export async function getBooking(code) {
  code = String(code || '').trim().toUpperCase();
  if (!/^GT-[A-Z0-9]{6}$/.test(code)) throw new Error('Кодын хэлбэр буруу байна (GT-XXXXXX)');
  const snap = await getDoc(doc(db, 'bookings', code));
  if (!snap.exists()) throw new Error('Ийм дугаартай захиалга олдсонгүй');
  const b = { code: snap.id, ...snap.data() };
  const ssnap = await getDoc(doc(db, 'stallions', b.stallion));
  b.stallionData = ssnap.exists() ? { slug: ssnap.id, ...ssnap.data() } : null;
  return b;
}

// ------------------------------------------------------------ admin auth
export function onAdmin(cb) { return onAuthStateChanged(auth, user => cb(user ? { uid: user.uid, email: user.email } : null)); }
export async function login(email, password) { await signInWithEmailAndPassword(auth, email, password); }
export async function logout() { await signOut(auth); }

// ------------------------------------------------------------ admin data
export async function adminOverview() {
  const stallions = await listStallions();
  const bsnap = await getDocs(collection(db, 'bookings'));
  const counts = { pending: 0, confirmed: 0, cancelled: 0, total: bsnap.size };
  bsnap.docs.forEach(d => { const s = d.data().status; counts[s] = (counts[s] || 0) + 1; });
  return { stallions, counts };
}
export async function listBookings() {
  const snap = await getDocs(query(collection(db, 'bookings'), orderBy('createdAt', 'desc')));
  return snap.docs.map(d => ({ code: d.id, ...d.data() }));
}

async function renumberQueue(slug) {
  // баталгаажсан дарааллыг баталгаажсан цагийн дарааллаар дахин дугаарлана (админ үйлдэл)
  const snap = await getDocs(query(collection(db, 'bookings'), where('stallion', '==', slug)));
  const list = snap.docs.map(d => ({ code: d.id, ...d.data() })).filter(b => b.status === 'confirmed')
    .sort((a, b) => (toDate(a.confirmedAt) || 0) - (toDate(b.confirmedAt) || 0));
  const batch = writeBatch(db);
  let n = 1;
  list.forEach(b => {
    const from = n, to = n + Number(b.mares) - 1; n = to + 1;
    if (b.queueFrom !== from || b.queueTo !== to) {
      batch.update(doc(db, 'bookings', b.code), { queueFrom: from, queueTo: to });
      batch.set(doc(db, 'queue', b.code), { code: b.code, stallion: slug, mares: Number(b.mares), status: 'confirmed', queueFrom: from, queueTo: to, owner: maskName(b.ownerName), createdAt: b.createdAt || serverTimestamp() }, { merge: true });
    }
  });
  await batch.commit();
}

export async function confirmBooking(code) {
  const bRef = doc(db, 'bookings', code);
  const result = await runTransaction(db, async tx => {
    const bs = await tx.get(bRef);
    if (!bs.exists()) throw new Error('Захиалга олдсонгүй');
    const b = bs.data();
    if (b.status === 'confirmed') throw new Error('Аль хэдийн баталгаажсан');
    const sRef = doc(db, 'stallions', b.stallion);
    const ss = await tx.get(sRef);
    if (!ss.exists()) throw new Error('Азарга олдсонгүй');
    const s = ss.data();
    if (s.active === false) throw new Error('Азарга идэвхгүй байна');
    const cap = Number(s.capacity || DEFAULT_SETTINGS.defaultCapacity);
    const confirmed = Number(s.confirmedMares || 0);
    const mares = Number(b.mares);
    if (confirmed + mares > cap) throw new Error(`Суудал хүрэлцэхгүй: ${cap - confirmed} үлдсэн, захиалга ${mares} гүү`);
    const queueFrom = confirmed + 1, queueTo = confirmed + mares;
    tx.update(bRef, { status: 'confirmed', confirmedAt: serverTimestamp(), cancelledAt: null, cancelReason: null, queueFrom, queueTo });
    tx.update(sRef, { confirmedMares: increment(mares), confirmedCount: increment(1) });
    tx.set(doc(db, 'queue', code), { code, stallion: b.stallion, mares, status: 'confirmed', queueFrom, queueTo, owner: maskName(b.ownerName), createdAt: b.createdAt || serverTimestamp() });
    return { queueFrom, queueTo, remaining: cap - confirmed - mares };
  });
  return result;
}

export async function cancelBooking(code, reason) {
  const bRef = doc(db, 'bookings', code);
  let slug = null, wasConfirmed = false;
  await runTransaction(db, async tx => {
    const bs = await tx.get(bRef);
    if (!bs.exists()) throw new Error('Захиалга олдсонгүй');
    const b = bs.data(); slug = b.stallion;
    if (b.status === 'cancelled') throw new Error('Аль хэдийн цуцлагдсан');
    wasConfirmed = b.status === 'confirmed';
    if (wasConfirmed) tx.update(doc(db, 'stallions', b.stallion), { confirmedMares: increment(-Number(b.mares)), confirmedCount: increment(-1) });
    tx.update(bRef, { status: 'cancelled', cancelledAt: serverTimestamp(), cancelReason: cleanStr(reason, 300), confirmedAt: null, queueFrom: null, queueTo: null });
    tx.delete(doc(db, 'queue', code));
  });
  if (wasConfirmed) await renumberQueue(slug);
}

export async function reopenBooking(code) {
  const bRef = doc(db, 'bookings', code);
  let slug = null, wasConfirmed = false;
  await runTransaction(db, async tx => {
    const bs = await tx.get(bRef);
    if (!bs.exists()) throw new Error('Захиалга олдсонгүй');
    const b = bs.data(); slug = b.stallion;
    if (b.status === 'pending') throw new Error('Аль хэдийн хүлээгдэж байна');
    wasConfirmed = b.status === 'confirmed';
    if (wasConfirmed) tx.update(doc(db, 'stallions', b.stallion), { confirmedMares: increment(-Number(b.mares)), confirmedCount: increment(-1) });
    tx.update(bRef, { status: 'pending', confirmedAt: null, cancelledAt: null, cancelReason: null, queueFrom: null, queueTo: null });
    tx.set(doc(db, 'queue', code), { code, stallion: b.stallion, mares: Number(b.mares), status: 'pending', createdAt: b.createdAt || serverTimestamp() });
  });
  if (wasConfirmed) await renumberQueue(slug);
}

export async function updateStallion(slug, fields) {
  const ref = doc(db, 'stallions', slug);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Азарга олдсонгүй');
  const cur = snap.data();
  const upd = {};
  ['name', 'nameEn', 'breed', 'sire', 'dam', 'description', 'notes'].forEach(k => { if (fields[k] !== undefined) upd[k] = cleanStr(fields[k], k === 'description' || k === 'notes' ? 2000 : 120); });
  if (fields.foaled !== undefined) upd.foaled = fields.foaled === '' || fields.foaled == null ? null : Number(fields.foaled);
  if (fields.price !== undefined) upd.price = fields.price === '' || fields.price == null ? null : Number(fields.price);
  if (fields.capacity !== undefined) {
    const c = Math.floor(Number(fields.capacity));
    if (!(c >= 1 && c <= 100)) throw new Error('Багтаамж 1–100 хооронд байна');
    if (c < Number(cur.confirmedMares || 0)) throw new Error(`Багтаамжийг ${cur.confirmedMares}-аас бага болгож болохгүй (баталгаажсан гүү байна)`);
    upd.capacity = c;
  }
  if (fields.active !== undefined) upd.active = !!fields.active;
  if (fields.order !== undefined) upd.order = Number(fields.order) || cur.order || 99;
  await updateDoc(ref, upd);
}

export async function importSeed(seed, capacity) {
  // зөвхөн байхгүй азаргыг нэмнэ — байгаа бичлэгийн тоолуур/засварыг хөндөхгүй
  const snap = await getDocs(collection(db, 'stallions'));
  const existing = new Set(snap.docs.map(d => d.id));
  const batch = writeBatch(db);
  let n = 0;
  seed.forEach((s, i) => {
    if (existing.has(s.slug)) return;
    batch.set(doc(db, 'stallions', s.slug), {
      ...s, capacity: Number(capacity || DEFAULT_SETTINGS.defaultCapacity), active: true, order: i + 1,
      confirmedMares: 0, confirmedCount: 0,
      images: { main: `${s.slug}-a`, second: `${s.slug}-b`, page: `${s.slug}-page` }
    });
    n += 1;
  });
  if (n) await batch.commit();
  return n;
}

export const _internal = { db, auth, doc, getDoc, deleteDoc };
