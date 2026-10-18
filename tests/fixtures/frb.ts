// Synthetic transport fixture, never used by the runtime or a live estimate.
export function frbHtml(jpy = "150.0000") {
  const rows = [
    ["JAPAN", "YEN", jpy], ["*EMU MEMBERS", "EURO", "1.2500"],
    ["*UNITED KINGDOM", "POUND", "1.5000"], ["*AUSTRALIA", "DOLLAR", "0.5000"],
    ["*NEW ZEALAND", "DOLLAR", "0.6000"], ["CANADA", "DOLLAR", "1.4000"],
    ["SWITZERLAND", "FRANC", "0.8000"], ["CHINA, P.R.", "YUAN", "7.0000"],
    ["HONG KONG", "DOLLAR", "7.8000"], ["INDIA", "RUPEE", "85.0000"],
    ["SOUTH KOREA", "WON", "1400.0000"], ["SINGAPORE", "DOLLAR", "1.3000"]
  ];
  return `<div>Release Date: October 13, 2026</div>
  <div>Rates in currency units per U.S. dollar except as noted by an asterisk</div>
  <table class="statistics"><tr><th>COUNTRY</th><th>CURRENCY</th>${[5,6,7,8,9].map(d => `<th>Oct. ${d}</th>`).join("")}</tr>
  ${rows.map(([c,u,v]) => `<tr><th>${c}</th><td>${u}</td>${Array(5).fill(`<td>${v}</td>`).join("")}</tr>`).join("")}</table>
  <div>* U.S. dollars per currency unit.</div>`;
}
export const fxNow = new Date("2026-10-14T00:00:00Z");
export const htmlResponse = (html: string) => new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
