/* Нийтлэг туслах функцууд (UI) */
import { getSettings, configured, toDate } from './db.js';

export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const priceText = (p, withUnit) => {
  if (p == null || p === '') return 'Private';
  const n = Number(p);
  const s = (Number.isInteger(n) ? n : n.toFixed(1)) + ' сая';
  return withUnit ? s + ' ₮' : s;
};

const p2 = n => String(n).padStart(2, '0');
export const fmtDate = v => {
  const d = toDate(v); if (!d) return '';
  return `${d.getFullYear()}.${p2(d.getMonth() + 1)}.${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
};
export const fmtDay = v => {
  const d = toDate(v); if (!d) return '';
  return `${d.getFullYear()} оны ${d.getMonth() + 1} сарын ${d.getDate()}`;
};

export const statusMn = s => ({ pending: 'Хүлээгдэж байна', confirmed: 'Баталгаажсан', cancelled: 'Цуцлагдсан' }[s] || s);

export const LOGO = '<span class="brand-mark"></span>';

// Хуудасны хаягууд (GitHub Pages дэд замтай ч ажиллана)
export const url = {
  home: () => 'index.html',
  stallion: slug => 'azarga.html?id=' + encodeURIComponent(slug),
  booking: code => 'zahialga.html?code=' + encodeURIComponent(code),
  bookingAbs: code => location.origin + location.pathname.replace(/[^/]*$/, '') + 'zahialga.html?code=' + encodeURIComponent(code),
  admin: () => 'admin.html'
};
export const img = (key, small) => `img/${key}${small ? '-s' : ''}.jpg`;
export const param = name => new URLSearchParams(location.search).get(name);

export async function renderChrome(active) {
  const c = await getSettings();
  document.title = (document.title ? document.title + ' — ' : '') + c.siteName;
  const h = document.getElementById('site-header');
  if (h) h.innerHTML = `<div class="container">
    <a class="brand" href="${url.home()}"><span class="logo">${LOGO}</span><span>${esc(c.siteName)}<small>${esc(c.siteTagline)}</small></span></a>
    <nav class="nav">
      <a href="${url.home()}" class="${active === 'home' ? 'active' : ''}">Азарганууд</a>
      <a href="zahialga.html" class="hide-sm">Захиалга шалгах</a>
      <a href="${url.home()}#azarga" class="btn-accent">Гүү тавих захиалга</a>
    </nav></div>`;
  const f = document.getElementById('site-footer');
  if (f) f.innerHTML = `<div class="container">
    <div><b>${esc(c.orgName || c.siteName)}</b><br>${esc(c.address || '')}${c.phone ? ' · Утас: ' + esc(c.phone) : ''}</div>
    <div>Үржүүлгийн улирал: ${esc(c.season || '')}<br><a href="zahialga.html">Захиалгын төлөв шалгах</a> · <a href="${url.admin()}">Админ</a></div>
  </div>`;
  if (!configured) {
    const main = document.querySelector('main');
    if (main) main.insertAdjacentHTML('afterbegin', `<div class="container"><div class="alert warn" style="margin-top:14px"><b>Firebase тохиргоо хийгдээгүй байна.</b> <code>js/firebase-config.js</code> файлд Firebase төслийнхөө config-ийг тавина уу (README-г үзнэ үү).</div></div>`);
  }
  return c;
}

export function meterHtml(st) {
  const cap = st.capacity || 10;
  const cPct = Math.min(100, st.confirmedMares / cap * 100);
  const pPct = Math.min(100 - cPct, st.pendingMares / cap * 100);
  const label = st.status === 'full' ? `<b>Дүүрсэн ${st.confirmedMares}/${cap}</b>` : `<b>${st.confirmedMares}/${cap}</b> баталгаажсан`;
  return `<div class="meter ${st.status}"><div class="bar"><i class="c" style="width:${cPct}%"></i><i class="p" style="width:${pPct}%"></i></div>
    <div class="lbl"><span>${label}</span><span>${st.status === 'full' ? 'Захиалга хаагдсан' : (st.pendingMares ? st.pendingMares + ' хүлээгдэж · ' : '') + st.remaining + ' суудал үлдсэн'}</span></div></div>`;
}

export function toast(msg) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._tm); t._tm = setTimeout(() => t.classList.remove('show'), 2800);
}

export function lightbox() {
  let lb = document.querySelector('.lightbox');
  if (!lb) {
    lb = document.createElement('div'); lb.className = 'lightbox'; lb.innerHTML = '<img alt="">';
    lb.addEventListener('click', () => lb.classList.remove('open'));
    document.body.appendChild(lb);
  }
  return src => { lb.querySelector('img').src = src; lb.classList.add('open'); };
}
