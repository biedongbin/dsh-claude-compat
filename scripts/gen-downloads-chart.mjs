// gen-downloads-chart.mjs — fetch last 30 days of npm downloads and render a
// simple SVG bar chart to .github/assets/downloads.svg. Run by CI daily.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const PKG = 'dsh-claude-compat';
const DAYS = 30;
const iso = (d) => d.toISOString().slice(0, 10);
const end = new Date();
const start = new Date(Date.now() - (DAYS - 1) * 86400000);
const res = await fetch(`https://api.npmjs.org/downloads/range/${iso(start)}:${iso(end)}/${PKG}`);
if (!res.ok) throw new Error(`npm API ${res.status}`);
const { downloads } = await res.json();
const days = downloads.map((d) => ({ date: d.day, n: d.downloads }));
const total = days.reduce((s, d) => s + d.n, 0);
const max = Math.max(1, ...days.map((d) => d.n));

const W = 760, H = 180, PAD = 30, CW = (W - PAD * 2) / days.length;
const bars = days.map((d, i) => {
  const h = Math.round((d.n / max) * (H - 70));
  const x = PAD + i * CW, y = H - 40 - h;
  return `<rect x="${x.toFixed(1)}" y="${y}" width="${(CW - 2).toFixed(1)}" height="${h}" rx="2" fill="#22c55e"><title>${d.date}: ${d.n}</title></rect>`;
}).join('\n  ');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif">
  <text x="${PAD}" y="24" font-size="15" font-weight="600" fill="#1f2937">${PKG} — npm downloads (last ${DAYS} days)</text>
  <text x="${W - PAD}" y="24" font-size="13" text-anchor="end" fill="#374151">total ${total.toLocaleString()} · max ${max.toLocaleString()}/day</text>
  ${bars}
  <text x="${PAD}" y="${H - 15}" font-size="11" fill="#6b7280">${days[0].date}</text>
  <text x="${W - PAD}" y="${H - 15}" font-size="11" text-anchor="end" fill="#6b7280">${days[days.length - 1].date}</text>
</svg>\n`;

const out = new URL('../.github/assets/downloads.svg', import.meta.url);
mkdirSync(dirname(out.pathname), { recursive: true });
writeFileSync(out.pathname, svg);
console.log(`chart written: total=${total} max=${max}`);
