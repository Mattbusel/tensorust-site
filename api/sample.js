// Tensorust live sample endpoint. Given a topic/indication, queries recent PubMed
// (free E-utilities, server-side so no CORS), and returns a mini KOL/landscape
// preview: top research leaders, institutions, subtopics, momentum, sample papers.
// This is a LIVE PREVIEW; the full paid brief adds citation weighting, name
// disambiguation, and a cited PDF. No private data - public authorship only.

const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/";
const COMMON = "tool=tensorust&email=mattbusel@gmail.com";
const MINYEAR = 2021, MAXYEAR = 2026, RETMAX = 200;

function shortAffil(aff) {
  if (!aff) return "";
  const parts = aff.split(",").map(s => s.trim()).filter(Boolean);
  const strong = /(University|Universit\w+|Institute of Technology|College|Hospital|Clinic|NIH|Mayo|Cleveland|Karolinska|Pharma\w*|Therapeutics|Biosciences|Inc\.?|Ltd\.?|GmbH|Novo Nordisk|Eli Lilly|Pfizer|AstraZeneca|Novartis|Roche|Merck|Amgen|Sanofi)/i;
  const generic = /^(Department|Dept|Division|School of|Faculty|Institute of|Center for|Centre for|Laboratory of|Section of|Unit|Program)\b/i;
  for (const p of parts) if (strong.test(p) && !generic.test(p)) return p.slice(0, 58);
  for (const p of parts) if (strong.test(p)) return p.slice(0, 58);
  for (const p of parts) if (!generic.test(p)) return p.slice(0, 58);
  return parts[0] ? parts[0].slice(0, 58) : "";
}

function rankable(name) {
  const p = name.trim().split(/\s+/);
  return p.length >= 2 && p[p.length - 1].length >= 2 &&
    p[p.length - 1] !== p[p.length - 1].toUpperCase();
}

function topN(counter, n) {
  return Object.entries(counter).sort((a, b) => b[1] - a[1]).slice(0, n);
}

async function jget(url) {
  const r = await fetch(url);
  return r.json();
}

module.exports = async function handler(req, res) {
  const u = new URL(req.url, "http://x");
  const q = (u.searchParams.get("q") || "").slice(0, 200).trim();
  if (!q) { res.status(400).json({ error: "Enter a topic or indication." }); return; }
  try {
    const es = await jget(`${EUTILS}esearch.fcgi?db=pubmed&term=${encodeURIComponent(q)}` +
      `&datetype=pdat&mindate=${MINYEAR}&maxdate=${MAXYEAR}&retmax=${RETMAX}&retmode=json&${COMMON}`);
    const ids = (es.esearchresult && es.esearchresult.idlist) || [];
    const total = Number((es.esearchresult && es.esearchresult.count) || 0);
    if (!ids.length) {
      res.status(200).json({ q, total: 0, message: "No recent PubMed records matched. Try broader terms (e.g. a drug name or disease)." });
      return;
    }
    const ef = await fetch(`${EUTILS}efetch.fcgi?db=pubmed&id=${ids.join(",")}&retmode=xml&${COMMON}`);
    const xml = await ef.text();

    const authors = {}, affils = {}, insts = {}, mesh = {}, journals = {}, years = {};
    const titles = [];
    const arts = xml.split("<PubmedArticle>").slice(1);
    const stop = new Set(["Humans", "Male", "Female", "Animals", "Adult", "Middle Aged",
      "Aged", "Adolescent", "Child", "Young Adult", "Aged, 80 and over", "Retrospective Studies"]);
    for (const a of arts) {
      const ym = a.match(/<Year>(\d{4})<\/Year>/);
      const yr = ym ? ym[1] : null;
      if (yr) years[yr] = (years[yr] || 0) + 1;
      const jm = a.match(/<Journal>[\s\S]*?<Title>([^<]+)<\/Title>/);
      if (jm) journals[jm[1]] = (journals[jm[1]] || 0) + 1;
      const seen = new Set();
      const authBlocks = a.match(/<Author[\s>][\s\S]*?<\/Author>/g) || [];
      for (const ab of authBlocks) {
        const last = (ab.match(/<LastName>([^<]+)<\/LastName>/) || [])[1];
        const fore = (ab.match(/<ForeName>([^<]+)<\/ForeName>/) || [])[1];
        if (!last) continue;
        const name = fore ? `${last} ${fore}` : last;
        authors[name] = (authors[name] || 0) + 1;
        const affRaw = (ab.match(/<Affiliation>([^<]+)<\/Affiliation>/) || [])[1];
        const aff = shortAffil(affRaw || "");
        if (aff) {
          affils[name] = affils[name] || {};
          affils[name][aff] = (affils[name][aff] || 0) + 1;
          if (!seen.has(aff)) { insts[aff] = (insts[aff] || 0) + 1; seen.add(aff); }
        }
      }
      const md = a.match(/<DescriptorName[^>]*>([^<]+)<\/DescriptorName>/g) || [];
      for (const m of md) {
        const t = m.replace(/<[^>]+>/g, "");
        if (!stop.has(t)) mesh[t] = (mesh[t] || 0) + 1;
      }
      if (titles.length < 4) {
        const tm = a.match(/<ArticleTitle>([\s\S]*?)<\/ArticleTitle>/);
        const pm = a.match(/<PMID[^>]*>(\d+)<\/PMID>/);
        if (tm) titles.push({ title: tm[1].replace(/<[^>]+>/g, "").slice(0, 130), year: yr, pmid: pm ? pm[1] : null });
      }
    }
    const kols = [];
    for (const [name, papers] of topN(authors, 60)) {
      if (!rankable(name)) continue;
      if (kols.length >= 8) break;
      const aff = affils[name] ? topN(affils[name], 1)[0] : null;
      kols.push({ name, papers, affiliation: aff ? aff[0] : "" });
    }
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
    res.status(200).json({
      q, total, analyzed: ids.length,
      kols,
      institutions: topN(insts, 8).map(([name, n]) => ({ name, n })),
      subtopics: topN(mesh, 10).map(([name, n]) => ({ name, n })),
      byYear: Object.fromEntries(Object.entries(years).sort()),
      titles
    });
  } catch (e) {
    res.status(500).json({ error: "Lookup failed, please try again.", detail: String(e).slice(0, 160) });
  }
};
