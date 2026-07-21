// Counterfactual evidence finder. It retrieves public PubMed sources for a topic
// and a checkable claim, then surfaces the highest-level evidence types and sources
// that explicitly discuss myths, misconceptions, beliefs, or controversies.
// It intentionally does not issue an automatic "true" or "disproven" verdict.

const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/";
const COMMON = "tool=tensorust-counterfactual&email=mattbusel@gmail.com";
const RETMAX = 60;

function clean(value, limit) {
  return (value || "").replace(/[\[\]{}<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
}

function decode(value) {
  return (value || "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"")
    .replace(/\s+/g, " ").trim();
}

function firstTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decode(match[1]) : "";
}

function allTags(block, tag) {
  const out = [];
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "gi");
  let match;
  while ((match = re.exec(block))) out.push(decode(match[1]));
  return out.filter(Boolean);
}

function evidenceTier(types) {
  const value = types.join(" ").toLowerCase();
  if (/meta-analysis/.test(value)) return { label: "Meta-analysis", score: 100 };
  if (/systematic review/.test(value)) return { label: "Systematic review", score: 90 };
  if (/practice guideline|guideline/.test(value)) return { label: "Guideline", score: 85 };
  if (/randomized controlled trial/.test(value)) return { label: "Randomized trial", score: 80 };
  if (/clinical trial/.test(value)) return { label: "Clinical trial", score: 70 };
  if (/review/.test(value)) return { label: "Review", score: 50 };
  return { label: "Primary or other record", score: 20 };
}

function extractRecords(xml) {
  return xml.split("<PubmedArticle>").slice(1).map(block => {
    const types = allTags(block, "PublicationType");
    const tier = evidenceTier(types);
    const abstract = allTags(block, "AbstractText").join(" ");
    const title = firstTag(block, "ArticleTitle");
    const year = firstTag(block, "Year") || firstTag(block, "MedlineDate").slice(0, 4);
    const journal = firstTag(block, "Title");
    return {
      pmid: firstTag(block, "PMID"), title, year, journal,
      publicationTypes: types.slice(0, 4), tier: tier.label, score: tier.score,
      excerpt: abstract.slice(0, 520),
    };
  }).filter(item => item.pmid && item.title);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`PubMed returned HTTP ${response.status}`);
  return response.json();
}

async function recordsFor(term) {
  const search = await fetchJson(`${EUTILS}esearch.fcgi?db=pubmed&term=${encodeURIComponent(term)}` +
    `&retmax=${RETMAX}&retmode=json&sort=relevance&${COMMON}`);
  const result = search.esearchresult || {};
  const ids = result.idlist || [];
  if (!ids.length) return { total: Number(result.count || 0), records: [] };
  const response = await fetch(`${EUTILS}efetch.fcgi?db=pubmed&id=${ids.join(",")}&retmode=xml&${COMMON}`);
  if (!response.ok) throw new Error(`PubMed fetch returned HTTP ${response.status}`);
  return { total: Number(result.count || 0), records: extractRecords(await response.text()) };
}

function claimTerm(topic, claim) {
  if (!claim) return topic;
  const words = claim.toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) || [];
  const stop = new Set(["the", "and", "that", "with", "from", "this", "these", "those", "does", "doesnt", "doesn", "about", "into", "than", "have", "will", "would", "should", "could", "true", "false"]);
  const terms = [...new Set(words.filter(word => !stop.has(word)))].slice(0, 8);
  return terms.length ? `(${topic}) AND (${terms.join(" OR ")})` : topic;
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, "http://tensorust.local");
  const topic = clean(url.searchParams.get("topic"), 160);
  const claim = clean(url.searchParams.get("claim"), 280);
  if (!topic) {
    res.status(400).json({ error: "Enter a topic or indication." });
    return;
  }
  try {
    const evidenceQuery = claimTerm(topic, claim);
    const misconceptionQuery = `(${topic}) AND (myth OR myths OR misconception OR misconceptions OR controversy OR controversies OR belief OR beliefs)`;
    const evidence = await recordsFor(evidenceQuery);
    const misconception = await recordsFor(misconceptionQuery);
    const ranked = evidence.records.sort((a, b) => b.score - a.score).slice(0, 8);
    const misconceptionSources = misconception.records.sort((a, b) => b.score - a.score).slice(0, 5);
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
    res.status(200).json({
      topic, claim, evidenceQuery, analyzed: evidence.records.length, total: evidence.total,
      records: ranked, misconceptionSources,
      verdict: "Source retrieval only. A claim is not labeled supported, contradicted, mixed, or insufficient until its cited sources are reviewed at claim level.",
      limits: "PubMed is the live v1 source. Search relevance and publication type do not establish truth, clinical applicability, causality, or consensus."
    });
  } catch (error) {
    res.status(500).json({ error: "Evidence lookup failed. Please try a narrower topic or claim.", detail: String(error).slice(0, 160) });
  }
};
