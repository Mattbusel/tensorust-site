// Tensorust Under Oath - live public-record investigation endpoint.
// Given a plain-language claim/question (or structured entity+metric+amount), it queries
// the relevant public dataset (USAspending federal contracts, Senate LDA lobbying, or
// NIH grants), resolves the entity, and returns an evidence-first "receipt": a verdict,
// the real figures, the source records, confidence, coverage, and honest limitations.
//
// Design rule: it never asserts a claim is false without a specific sourced record. When
// the data is thin it returns INSUFFICIENT_EVIDENCE. It reports what the public record
// shows and links every number. All sources are public-domain government data.

const AGENCY = "AutocoderFarm/0.6 (tensorust; contact mattbusel@gmail.com)";

function fmtUSD(n) {
  n = Number(n) || 0; const a = Math.abs(n); const s = n < 0 ? "-$" : "$";
  if (a >= 1e9) return s + (a / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return s + (a / 1e6).toFixed(1) + "M";
  if (a >= 1e3) return s + Math.round(a / 1e3) + "k";
  return s + Math.round(a).toLocaleString();
}
function toNumber(numStr, unit) {
  let n = parseFloat(String(numStr).replace(/,/g, "")); if (!isFinite(n)) return null;
  const u = (unit || "").toLowerCase();
  if (u.startsWith("b")) n *= 1e9;
  else if (u === "m" || u === "mm" || u.startsWith("mil")) n *= 1e6;
  else if (u === "k" || u.startsWith("thou")) n *= 1e3;
  return n;
}
function parseQuery(q) {
  const s = String(q || "").trim();
  let amount = null;
  const am = s.match(/\$?\s*([\d][\d,]*(?:\.\d+)?)\s*(billion|bn|b|million|mm|m|thousand|k)?\b/i);
  if (am && (am[2] || s.includes("$"))) amount = toNumber(am[1], am[2]);
  let metric = "contracts", sub = null;
  if (/lobby|lobbie/i.test(s)) metric = "lobbying";
  else if (/\bgrant|\bnih\b|\bnsf\b/i.test(s)) metric = "grants";
  else if (/vulnerab|\bcve\b|hacked|exploit|breach|cyber|\b(?:in)?secure\b/i.test(s)) metric = "cyber";
  else if (/\bdrugs?\b|\bfda\b|approv|medicine/i.test(s)) metric = "fda";
  else if (/revenue|sales|profit|earnings|net income|financials|\br ?& ?d\b|research and development|invest/i.test(s)) {
    metric = "financials";
    sub = (/\br ?& ?d\b|research and development|invest|research/i.test(s)) ? "rnd"
      : (/profit|earnings|net income/i.test(s)) ? "netincome" : "revenue";
  }
  let e = s
    .replace(/\$?\s*[\d][\d,]*(?:\.\d+)?\s*(billion|bn|b|million|mm|m|thousand|k)?/ig, " ")
    .replace(/\b(did|does|do|is|are|was|were|has|have|had|actually|really|truly|the|a|an|receive|received|receives|get|got|gets|win|won|wins|award|awarded|contract|contracts|claim|claims|claimed|how|many|much|money|federal|government|govt|in|of|to|from|for|and|or|lobby|lobbying|lobbied|grant|grants|granted|research|funding|funded|verify|check|nih|nsf|fda|revenue|sales|profit|profits|earnings|drugs?|approved|approvals?|vulnerab\w*|cve|invest\w*|spent|spend|make|made|gotten|software|secure|being|exploited|breached|hacked|vulnerable|financials|company|corporation|corp|inc)\b/ig, " ")
    .replace(/[?.,!"'`]/g, " ").replace(/\s+/g, " ").trim();
  return { entity: e || s, metric, sub, amount, raw: s };
}

async function postJSON(url, body) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), 13000);
  try {
    const r = await fetch(url, { method: "POST", signal: c.signal,
      headers: { "Content-Type": "application/json", "User-Agent": AGENCY },
      body: JSON.stringify(body) });
    return r.ok ? await r.json() : null;
  } catch (e) { return null; } finally { clearTimeout(t); }
}
async function getJSON(url) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), 13000);
  try {
    const r = await fetch(url, { signal: c.signal, headers: { "User-Agent": AGENCY } });
    return r.ok ? await r.json() : null;
  } catch (e) { return null; } finally { clearTimeout(t); }
}

const CONTRACT_CODES = ["A", "B", "C", "D"];
const ALL_TIME = [{ start_date: "2008-01-01", end_date: "2026-12-31" }];

async function contracts(entity, amount) {
  const tok = entity.toLowerCase().split(/\s+/)[0] || entity.toLowerCase();
  const agg = await postJSON("https://api.usaspending.gov/api/v2/search/spending_by_category/recipient/",
    { filters: { recipient_search_text: [entity], time_period: ALL_TIME, award_type_codes: CONTRACT_CODES }, category: "recipient", limit: 30 });
  let total = 0; const recips = [];
  for (const x of ((agg && agg.results) || [])) {
    if (((x.name || "").toLowerCase()).includes(tok)) { total += Number(x.amount || 0); recips.push(x.name); }
  }
  const aw = await postJSON("https://api.usaspending.gov/api/v2/search/spending_by_award/",
    { filters: { recipient_search_text: [entity], time_period: ALL_TIME, award_type_codes: CONTRACT_CODES },
      fields: ["Award ID", "Recipient Name", "Award Amount", "Total Outlays", "Awarding Agency", "Start Date", "End Date", "generated_internal_id"],
      sort: "Award Amount", order: "desc", limit: 8, page: 1 });
  const awards = ((aw && aw.results) || [])
    .filter(a => ((a["Recipient Name"] || "").toLowerCase()).includes(tok))
    .map(a => ({ id: a["Award ID"], recipient: a["Recipient Name"], amount: Number(a["Award Amount"] || 0),
      outlays: Number(a["Total Outlays"] || 0), agency: a["Awarding Agency"], start: a["Start Date"], end: a["End Date"],
      url: a.generated_internal_id ? "https://www.usaspending.gov/award/" + a.generated_internal_id + "/" : null }));

  const found = recips.length || awards.length;
  const big = awards.length ? awards[0].amount : 0;
  let status, claim_check;
  if (!found) {
    status = "INSUFFICIENT_EVIDENCE";
    claim_check = "No federal prime contracts found in USAspending for this name. It may not be a prime federal contractor, may operate under a different legal name, or the spending may flow through subcontracts or other vehicles.";
  } else if (amount) {
    if (Math.abs(big - amount) / amount < 0.2) {
      status = "VERIFIED";
      claim_check = "A specific award of " + fmtUSD(big) + " is on record (" + awards[0].id + "). Note the record also shows " + fmtUSD(awards[0].outlays) + " actually paid out so far (outlays), which is the money that has changed hands.";
    } else if (amount <= total * 1.2) {
      status = "PARTIALLY_SUPPORTED";
      claim_check = "The record shows " + fmtUSD(total) + " in total federal prime contracts to date. The claimed " + fmtUSD(amount) + " fits within that total, but it is not a single contract of that size (the largest single award on record is " + fmtUSD(big) + ").";
    } else {
      status = "NEEDS_CONTEXT";
      claim_check = "The claimed " + fmtUSD(amount) + " is larger than the " + fmtUSD(total) + " in federal prime-contract obligations on record. A number this size is usually an announced ceiling or total-potential value, a multi-year total, a subcontract, or non-prime spending, rather than dollars already obligated as prime contracts.";
    }
  } else {
    status = "ON_RECORD";
    claim_check = "On the record: " + fmtUSD(total) + " in federal prime contracts across all years.";
  }
  return {
    metric: "federal contracts", status, claim_check,
    figures: [
      { label: "Federal prime contracts on record (all years)", value: fmtUSD(total) },
      { label: "Largest single award", value: fmtUSD(big) },
      awards.length ? { label: "Actually paid out on that award (outlays)", value: fmtUSD(awards[0].outlays), note: "announced value vs money actually spent" } : null,
    ].filter(Boolean),
    records: awards.map(a => ({ title: a.id, sub: (a.agency || "") + (a.start ? " · " + a.start : ""),
      amount: fmtUSD(a.amount) + (a.outlays < a.amount ? "  (" + fmtUSD(a.outlays) + " paid)" : ""), url: a.url })),
    confidence: recips.length ? "medium" : (awards.length ? "medium" : "low"),
    coverage: ["USAspending / FPDS federal prime-contract awards, 2008 to present."],
    limitations: [
      "Excludes subcontracts, grants, classified programs, and spending routed through resellers or indefinite-delivery vehicles.",
      "Announced contract 'values' are often ceilings; 'obligated' and 'outlays' are what is committed and paid. They can differ by a lot.",
      "Company-name matching may miss subsidiaries or include a namesake." ],
    sources: [{ name: "USAspending.gov recipient search", url: "https://www.usaspending.gov/search" }]
      .concat(awards.filter(a => a.url).slice(0, 5).map(a => ({ name: "Award " + a.id, url: a.url }))),
  };
}

async function lobbying(entity, amount) {
  let total = 0; const filings = []; let count = 0; let page = 1;
  while (page <= 4) {
    const j = await getJSON("https://lda.senate.gov/api/v1/filings/?client_name=" + encodeURIComponent(entity) + "&filing_year=2023&page_size=25&page=" + page);
    if (!j) break;
    count = j.count || count;
    const results = j.results || [];
    for (const f of results) {
      const a = Number(f.income || f.expenses || 0); total += a;
      if (filings.length < 8) filings.push({ registrant: (f.registrant || {}).name, amount: a,
        period: f.filing_period_display || f.filing_period, url: f.filing_document_url });
    }
    if (!j.next || results.length < 25) break;
    page++;
  }
  let status, claim_check;
  if (!filings.length) { status = "INSUFFICIENT_EVIDENCE"; claim_check = "No 2023 federal lobbying filings found under this client name in the Senate LDA database."; }
  else if (amount) {
    if (Math.abs(total - amount) / amount < 0.25) { status = "VERIFIED"; claim_check = "2023 disclosed lobbying totals " + fmtUSD(total) + ", consistent with the claim."; }
    else if (amount < total) { status = "PARTIALLY_SUPPORTED"; claim_check = "2023 disclosed lobbying totals " + fmtUSD(total) + ", more than the claimed " + fmtUSD(amount) + "."; }
    else { status = "NEEDS_CONTEXT"; claim_check = "2023 disclosed lobbying totals " + fmtUSD(total) + ", less than the claimed " + fmtUSD(amount) + ". The claim may cover multiple years or include activity not captured in federal LDA filings."; }
  } else { status = "ON_RECORD"; claim_check = "On the record: " + fmtUSD(total) + " in disclosed federal lobbying in 2023."; }
  return {
    metric: "federal lobbying (2023)", status, claim_check,
    figures: [{ label: "Disclosed federal lobbying, 2023", value: fmtUSD(total) }, { label: "Filings on record", value: String(count || filings.length) }],
    records: filings.map(f => ({ title: f.registrant || "(in-house)", sub: f.period || "", amount: fmtUSD(f.amount), url: f.url })),
    confidence: filings.length ? "medium" : "low",
    coverage: ["U.S. Senate Lobbying Disclosure Act filings, 2023 calendar year."],
    limitations: ["Covers federal lobbying only, not state or foreign influence activity.", "Client-name matching may split or miss affiliated entities.", "This view is 2023; multi-year claims need a wider window."],
    sources: [{ name: "Senate LDA filing search", url: "https://lda.senate.gov/filings/public/filing/search/?client_name=" + encodeURIComponent(entity) + "&filing_year=2023" }],
  };
}

async function grants(entity, amount) {
  const j = await postJSON("https://api.reporter.nih.gov/v2/projects/search",
    { criteria: { org_names: [entity] }, include_fields: ["AwardAmount", "Organization", "FiscalYear", "ProjectNum", "ProjectTitle"], limit: 200, offset: 0 });
  const res = (j && j.results) || []; let total = 0; const recs = [];
  for (const p of res) { const a = Number(p.award_amount || 0); total += a;
    if (recs.length < 8) recs.push({ title: p.project_num || "grant", sub: (((p.organization || {}).org_name) || "") + (p.fiscal_year ? " · FY" + p.fiscal_year : ""), amount: fmtUSD(a),
      url: p.project_num ? "https://reporter.nih.gov/search/" + encodeURIComponent(p.project_num) : null }); }
  let status, claim_check;
  if (!res.length) { status = "INSUFFICIENT_EVIDENCE"; claim_check = "No NIH awards found for this organization name in NIH RePORTER."; }
  else if (amount) {
    if (amount <= total * 1.2) { status = "PARTIALLY_SUPPORTED"; claim_check = "NIH RePORTER shows " + fmtUSD(total) + " across " + res.length + " project records here, consistent with the claim being within federal research funding."; }
    else { status = "NEEDS_CONTEXT"; claim_check = "The claimed " + fmtUSD(amount) + " exceeds the " + fmtUSD(total) + " of NIH awards visible here. It may include NSF, other agencies, or multi-year totals beyond this view."; }
  } else { status = "ON_RECORD"; claim_check = "On the record: " + fmtUSD(total) + " in NIH awards across " + res.length + " project records."; }
  return {
    metric: "NIH research funding", status, claim_check,
    figures: [{ label: "NIH awards on record", value: fmtUSD(total) }, { label: "Project records", value: String((j && j.meta && j.meta.total) || res.length) }],
    records: recs, confidence: res.length ? "medium" : "low",
    coverage: ["NIH RePORTER project records (this query returns the first 50)."],
    limitations: ["NIH only; excludes NSF, DoD, and other research funders.", "Organization-name matching may miss campuses or affiliates."],
    sources: [{ name: "NIH RePORTER", url: "https://reporter.nih.gov/" }],
  };
}

// --- SEC financials -------------------------------------------------------
let SEC_TICKERS = null;
async function secLookup(entity) {
  if (!SEC_TICKERS) {
    const j = await getJSON("https://www.sec.gov/files/company_tickers.json");
    SEC_TICKERS = j ? Object.values(j).map(v => ({ cik: String(v.cik_str).padStart(10, "0"),
      ticker: (v.ticker || "").toUpperCase(), title: (v.title || "").toUpperCase() })) : [];
  }
  const e = entity.toUpperCase().trim(); if (!e) return null;
  let hit = SEC_TICKERS.find(x => x.ticker === e); if (hit) return hit;
  const tok = e.split(/\s+/)[0];
  const c = SEC_TICKERS.filter(x => x.title.includes(e) || x.title.startsWith(tok));
  c.sort((a, b) => a.title.length - b.title.length);
  return c[0] || null;
}
async function secConcept(cik, tags) {
  // Gather full-year (10-K, FY) values across ALL candidate tags and return the most
  // recent one, so a stale legacy tag never wins over the tag a company files under now.
  let best = null;
  for (const tag of tags) {
    const r = await getJSON("https://data.sec.gov/api/xbrl/companyconcept/CIK" + cik + "/us-gaap/" + tag + ".json");
    const units = r && r.units && r.units.USD;
    if (!units) continue;
    for (const u of units) {
      if (u.form !== "10-K" || u.fp !== "FY") continue;
      if (u.start && u.end) {
        const days = (new Date(u.end) - new Date(u.start)) / 86400000;
        if (days < 350 || days > 380) continue;   // full fiscal year only
      }
      if (!best || (u.end || "") > best.end) best = { val: u.val, end: u.end || "" };
    }
  }
  return best;
}
function insufficient(metric, msg, sources) {
  return { metric, status: "INSUFFICIENT_EVIDENCE", claim_check: msg, figures: [], records: [],
    confidence: "low", coverage: [], limitations: ["We report only what the queried public record contains; here it did not contain enough to judge."], sources: sources || [] };
}
async function financials(entity, amount, sub) {
  const co = await secLookup(entity);
  if (!co) return insufficient("company financials", "No SEC-registered public company matched that name. It may be private, foreign, or filed under a different legal name.",
    [{ name: "SEC EDGAR company search", url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=" + encodeURIComponent(entity) + "&type=10-K" }]);
  const rev = await secConcept(co.cik, ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet"]);
  const ni = await secConcept(co.cik, ["NetIncomeLoss"]);
  const rnd = await secConcept(co.cik, ["ResearchAndDevelopmentExpense", "ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost"]);
  const primary = sub === "rnd" ? rnd : sub === "netincome" ? ni : rev;
  const pl = sub === "rnd" ? "R&D expense" : sub === "netincome" ? "net income" : "annual revenue";
  const edgar = "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=" + co.cik + "&type=10-K";
  let status, claim_check;
  if (!primary) { status = "INSUFFICIENT_EVIDENCE"; claim_check = co.title + " is a public company, but its latest 10-K in EDGAR does not report a comparable " + pl + " figure under the standard tag."; }
  else if (amount) {
    const v = primary.val;
    if (Math.abs(v - amount) / Math.max(amount, 1) < 0.15) { status = "VERIFIED"; claim_check = "The latest 10-K reports " + pl + " of " + fmtUSD(v) + " (fiscal year ending " + primary.end + "), consistent with the claim."; }
    else if (amount <= v * 1.15) { status = "PARTIALLY_SUPPORTED"; claim_check = "The latest 10-K reports " + pl + " of " + fmtUSD(v) + " (FY ending " + primary.end + "); the claimed " + fmtUSD(amount) + " fits within that."; }
    else { status = "NEEDS_CONTEXT"; claim_check = "The claimed " + fmtUSD(amount) + " is larger than the " + fmtUSD(v) + " in " + pl + " on the latest 10-K (FY ending " + primary.end + "). It may be a multi-year total, a different line item (for example gross bookings vs. recognized revenue), or a non-GAAP figure."; }
  } else { status = "ON_RECORD"; claim_check = "On the record: " + co.title + " reported " + pl + " of " + fmtUSD(primary.val) + " (fiscal year ending " + primary.end + ")."; }
  return {
    metric: "SEC-reported financials (" + co.ticker + ")", status, claim_check,
    figures: [rev ? { label: "Reported annual revenue", value: fmtUSD(rev.val), note: "FY " + rev.end } : null,
      ni ? { label: "Net income", value: fmtUSD(ni.val), note: "FY " + ni.end } : null,
      rnd ? { label: "R&D expense", value: fmtUSD(rnd.val), note: "FY " + rnd.end } : null].filter(Boolean),
    records: [], confidence: "medium",
    coverage: ["SEC EDGAR XBRL company facts from audited 10-K filings (" + co.ticker + ", CIK " + co.cik + ")."],
    limitations: ["Uses standard US-GAAP tags; some firms report revenue or R&D under different line items.", "Latest fiscal year only; the claim may reference a different year or a non-GAAP figure."],
    sources: [{ name: "SEC EDGAR filings (10-K)", url: edgar }],
  };
}

// --- FDA drug approvals ---------------------------------------------------
async function fda(entity, amount) {
  const r = await getJSON("https://api.fda.gov/drug/drugsfda.json?search=sponsor_name:%22" + encodeURIComponent(entity.toUpperCase()) + "%22&limit=1");
  const total = r && r.meta && r.meta.results ? r.meta.results.total : 0;
  const searchUrl = "https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm";
  let status, claim_check;
  if (!total) { status = "INSUFFICIENT_EVIDENCE"; claim_check = "No approved drug applications found under this sponsor name in openFDA (Drugs@FDA). The sponsor may file under a subsidiary name."; }
  else if (amount) {
    if (Math.abs(total - amount) / Math.max(amount, 1) < 0.15) { status = "VERIFIED"; claim_check = "Drugs@FDA lists " + total + " approved drug applications under this sponsor, consistent with the claim."; }
    else { status = "NEEDS_CONTEXT"; claim_check = "Drugs@FDA lists " + total + " approved drug applications under this sponsor name, versus the claimed " + Math.round(amount) + ". Counts vary by whether you count applications, products, or active approvals, and by sponsor-name variants."; }
  } else { status = "ON_RECORD"; claim_check = "On the record: " + total + " approved drug applications under this sponsor name in Drugs@FDA. Superlatives like 'the most' would require ranking all sponsors, which this single lookup does not do."; }
  return {
    metric: "FDA drug approvals", status, claim_check,
    figures: [{ label: "Approved drug applications (Drugs@FDA)", value: String(total) }],
    records: [], confidence: total ? "medium" : "low",
    coverage: ["openFDA Drugs@FDA approved application records."],
    limitations: ["Counts applications under one sponsor name; subsidiaries and acquisitions may file separately.", "Does not distinguish still-marketed vs. discontinued products."],
    sources: [{ name: "Drugs@FDA", url: searchUrl }],
  };
}

// --- Cyber: CISA Known Exploited Vulnerabilities --------------------------
let KEV = null;
async function cyber(entity) {
  if (!KEV) {
    const j = await getJSON("https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json");
    KEV = (j && j.vulnerabilities) || [];
  }
  const tok = entity.toLowerCase().split(/\s+/)[0];
  const match = KEV.filter(v => ((v.vendorProject || "") + " " + (v.product || "")).toLowerCase().includes(tok));
  const ransom = match.filter(v => String(v.knownRansomwareCampaignUse || "").toLowerCase() === "known").length;
  const recent = match.slice().sort((a, b) => (b.dateAdded || "").localeCompare(a.dateAdded || "")).slice(0, 6);
  let status, claim_check;
  if (!match.length) { status = "INSUFFICIENT_EVIDENCE"; claim_check = "No entries for this name in CISA's Known Exploited Vulnerabilities catalog. That is not proof of security; it means none of its products are on the federal actively-exploited list under this name."; }
  else { status = "ON_RECORD"; claim_check = match.length + " of this vendor's vulnerabilities are on CISA's Known Exploited Vulnerabilities catalog (the U.S. government's actively-exploited, patch-now list)" + (ransom ? ", and " + ransom + " are tied to ransomware campaigns" : "") + "."; }
  return {
    metric: "known-exploited vulnerabilities (CISA KEV)", status, claim_check,
    figures: [{ label: "On CISA's actively-exploited list", value: String(match.length) }, { label: "Tied to ransomware", value: String(ransom) }],
    records: recent.map(v => ({ title: v.cveID, sub: (v.vulnerabilityName || v.product || "").slice(0, 80), amount: v.dateAdded || "",
      url: v.cveID ? "https://nvd.nist.gov/vuln/detail/" + v.cveID : null })),
    confidence: match.length ? "high" : "low",
    coverage: ["CISA Known Exploited Vulnerabilities Catalog (all entries to date)."],
    limitations: ["A high count reflects software ubiquity and attacker focus, not that a vendor is 'least secure'.", "Name matching is broad; verify each CVE at its link."],
    sources: [{ name: "CISA KEV catalog", url: "https://www.cisa.gov/known-exploited-vulnerabilities-catalog" }],
  };
}

const LABEL = { VERIFIED: "VERIFIED", PARTIALLY_SUPPORTED: "PARTIALLY SUPPORTED", NEEDS_CONTEXT: "NEEDS CONTEXT",
  CONTRADICTED: "CONTRADICTED", INSUFFICIENT_EVIDENCE: "INSUFFICIENT EVIDENCE", ON_RECORD: "ON THE RECORD" };

module.exports = async function handler(req, res) {
  const u = new URL(req.url, "http://x");
  const q = (u.searchParams.get("q") || "").slice(0, 240).trim();
  if (!q) { res.status(400).json({ error: "Enter a claim, a company, or a question." }); return; }
  const parsed = parseQuery(q);
  const entity = (u.searchParams.get("entity") || parsed.entity).trim();
  const metric = (u.searchParams.get("metric") || parsed.metric);
  const sub = u.searchParams.get("sub") || parsed.sub;
  const amount = u.searchParams.get("amount") ? Number(u.searchParams.get("amount")) : parsed.amount;
  if (!entity) { res.status(200).json({ q, error: "Could not find a company or organization in that. Try naming one (for example: 'Rocket Lab federal contracts')." }); return; }
  try {
    let r;
    if (metric === "lobbying") r = await lobbying(entity, amount);
    else if (metric === "grants") r = await grants(entity, amount);
    else if (metric === "financials") r = await financials(entity, amount, sub);
    else if (metric === "fda") r = await fda(entity, amount);
    else if (metric === "cyber") r = await cyber(entity);
    else r = await contracts(entity, amount);
    const receipt = {
      query: q, entity, claimed_amount: amount, metric: r.metric,
      status: r.status, status_label: LABEL[r.status] || r.status, verdict: r.claim_check,
      figures: r.figures, records: r.records, confidence: r.confidence,
      coverage: r.coverage, limitations: r.limitations, sources: r.sources,
      generated_at: new Date().toISOString().slice(0, 10),
      disclaimer: "This is what the public record shows, not a legal finding. Every figure links to its source. Disagree? Submit opposing evidence to mattbusel@gmail.com.",
    };
    receipt.share_x = "I put this under oath with @Tensorust:\n\n\"" + q + "\"\n\nVerdict: " + receipt.status_label + "\n" + r.claim_check.slice(0, 180);
    res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=86400");
    res.status(200).json(receipt);
  } catch (e) {
    res.status(500).json({ error: "Investigation failed, please try again.", detail: String(e).slice(0, 160) });
  }
};
