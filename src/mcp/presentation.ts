import { createDisplayQuote } from "../core/display-quote.js";
import type { EvaluationRecord } from "../core/evaluation.js";
import type { FxProvider } from "../profiles/frb.js";

export async function presentEvaluation(record: EvaluationRecord, provider: FxProvider, locale = "ja-JP", currency?: string) {
  const quote = await createDisplayQuote(record, provider, locale, currency);
  const a = record.normalized_assessment;
  return {
    evaluation_id: record.evaluation_id, assessment_id: a.assessment_id, evaluated_at: record.evaluated_at,
    report: record.report, report_hash: record.report_hash, basis: record.basis, display_quote: quote,
    review: { scope: a.scope, components: a.components, functional_processes: a.functional_processes,
      functional_users: a.functional_users, persistent_stores: a.persistent_stores,
      data_groups: a.data_groups, objects_of_interest: a.objects_of_interest,
      evidence: a.evidence, findings: a.findings, human_amendments: a.human_amendments,
      unread_files: a.input.manifest.files.filter(f => f.disposition === "unread").map(f => f.path) },
    storage: "LOCAL_ONLY", signed: false, published: false,
    notices: [record.basis.notice, record.basis.effort_scope_name,
      "ソースコードはOpen Estimateのサーバーへアップロードされず、一般公開もされません。",
      "CodexはAIによる解析のためにコードをモデル提供元へ送信する場合があります。",
      ...(quote.limitation_codes.includes("FX_CACHE_AFTER_FAILURE") ? ["為替の最新確認に失敗／前回取得レートを利用"] : [])]
  };
}
export type EvaluationView = Awaited<ReturnType<typeof presentEvaluation>>;
const escape = (value: unknown) => String(value ?? "未算出").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export function renderEvaluationHtml(view: EvaluationView): string {
  const { report: r, display_quote: q, review } = view;
  const quartiles = ["p25", "median", "p75"] as const;
  const row = (label: string, values: Record<"p25" | "median" | "p75", unknown> | null) => `<tr><th>${escape(label)}</th>${quartiles.map(k => `<td>${escape(values?.[k])}</td>`).join("")}</tr>`;
  const labels: Record<string, string> = { accepted: "計数対象", excluded: "対象外", unresolved: "未解決", measured: "測定対象", AVAILABLE: "算出済み", FX_UNAVAILABLE: "為替取得不可・現地額は未算出", FX_STALE: "為替が古いため現地額は未算出", UPSTREAM_UNAVAILABLE: "工数・基準額が未算出" };
  const processes = review.functional_processes.map(p => `<tr><td>${escape(p.name)}</td><td>${escape(labels[p.status] ?? p.status)}</td><td>${p.status === "accepted" ? p.movements.length : "未確定"}</td><td>${escape(p.decision_reason)}</td></tr>`).join("");
  const detail = review.functional_processes.map(p => `<details><summary>${escape(p.name)} — データ移動の内訳</summary><p>${escape(p.description)}</p><table><tr><th>移動</th><th>データ</th><th>相手／ストア</th><th>根拠</th></tr>${p.movements.map(m => {
    const group = review.data_groups.find(g => g.data_group_id === m.data_group_id)?.name ?? m.data_group_id;
    const peer = review.functional_users.find(u => u.user_id === m.peer_id)?.name ?? review.persistent_stores.find(s => s.store_id === m.store_id)?.name;
    const evidence = m.evidence_refs.map(ref => { const e = review.evidence.find(e => e.evidence_id === ref); return e ? `${e.file_path}:${e.line_start}-${e.line_end}` : ref; }).join(", ");
    return `<tr><td>${escape(m.type)}</td><td>${escape(group)}</td><td>${escape(peer)}</td><td>${escape(evidence)}</td></tr>`;
  }).join("")}</table></details>`).join("");
  const evidenceRows = review.evidence.map(e => `<tr><td>${escape(e.file_path)}:${e.line_start}–${e.line_end}</td><td>${escape(e.symbol)}</td><td>${escape(e.description)}</td></tr>`).join("");
  const components = review.components.map(c => `<li>${escape(c.name)} — ${escape(labels[c.status] ?? c.status)}：${escape(c.reason)}</li>`).join("");
  const findings = review.findings.map(f => `<li>${escape(f.category)} / ${escape(f.severity)}：${escape(f.message)}</li>`).join("");
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>Open Estimate — ローカル評価</title>
<style>body{font:16px/1.7 system-ui,sans-serif;background:#f4f6f8;color:#172b3a;max-width:1080px;margin:32px auto;padding:0 24px}main{background:white;border-radius:12px;padding:32px}h1{margin:0}h2{margin-top:32px}table{border-collapse:collapse;width:100%;font-size:14px}td,th{border:1px solid #dce3e8;padding:10px;text-align:left;overflow-wrap:anywhere}.notice{padding:16px;background:#fff3d6;border-left:4px solid #cc931c}.metric{font-size:32px;font-weight:700}code{overflow-wrap:anywhere}details{margin:12px 0}summary{cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}@media print{body{margin:0;padding:0;background:white}main{padding:0}details{break-inside:avoid}}</style></head>
<body><main><h1>Open Estimate</h1><p>ローカル評価・未署名・未公開</p>
<div class="notice">${view.notices.map(n => `<div>${escape(n)}</div>`).join("")}</div>
<h2>測定した機能規模</h2><div class="metric">${escape(r.measurement.cfp)} CFP · ${escape(r.measurement.status)}</div>
<p>${escape(review.scope.description)}</p><p>PARTIALは測定できた部分のみ。COMPLETEもAIの意味解釈の正しさを独立に保証するものではありません。</p>
<h2>TEST試算</h2><table><tr><th>項目</th><th>第1四分位（TEST）</th><th>中央値（TEST）</th><th>第3四分位（TEST）</th></tr>
${row("工数（人時）", r.effort.person_hours)}${row("人日（1人日＝8人時）", q.person_days)}${row("基準額（USD）", r.reference_usd.amount_usd)}${row(`表示時の参考換算額（${q.display_currency}）`, q.localized_reference.amount)}</table>
<p>換算状態：${escape(labels[q.localized_reference.status])}／レート：${escape(q.localized_reference.currency_per_usd)} ${escape(q.display_currency)}/USD</p>
<p>換算日時：${escape(q.displayed_at)}<br>FRB観測日：${escape(q.fx_snapshot?.observed_on)}／公表日：${escape(q.fx_snapshot?.published_on)}<br>最新確認：${escape(q.fx_snapshot?.checked_at)}<br>出典：${escape(q.fx_snapshot?.source_url)}</p>
<p>このHTMLは生成時点の記録です。新しい為替で表示するにはプラグインで再表示・レポート再生成してください。</p>
<h2>機能別の計数</h2><table><tr><th>機能</th><th>状態</th><th>CFP</th><th>判断理由</th></tr>${processes}</table>${detail}
<h2>実装の根拠</h2><table><tr><th>ファイル・行番号</th><th>関数等</th><th>確認内容</th></tr>${evidenceRows}</table>
<h2>対象範囲・未解決点</h2><ul>${components}</ul><p>未読ファイル：${review.unread_files.length ? escape(review.unread_files.join(", ")) : "なし"}</p>
${findings ? `<ul>${findings}</ul>` : "<p>申告された未解決点：なし</p>"}
<h2>計算根拠と再表示ID</h2><p>TEST係数（p25／中央値／p75）：${escape(quartiles.map(k => view.basis.benchmark.hours_per_cfp[k]).join(" / "))} 人時/CFP<br>TEST時給：${escape(view.basis.wage.hourly_wage_usd)} USD/人時</p>
<p>評価ID：<code>${escape(view.evaluation_id)}</code><br>Report hash：<code>${escape(view.report_hash)}</code></p>
<details><summary>詳細な測定データ・修正履歴（JSON）</summary><pre>${escape(JSON.stringify(review, null, 2))}</pre></details>
<details><summary>計算プロファイル・制約コード（JSON）</summary><pre>${escape(JSON.stringify({ basis: view.basis, limitations: q.limitation_codes }, null, 2))}</pre></details>
</main></body></html>`;
}
