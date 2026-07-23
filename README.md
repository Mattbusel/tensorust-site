# Tensorust site

Static site (no build step) for Tensorust: **Compete above your headcount.** Tensorust
gives challenger companies the evidence capacity of an enterprise research team.

Positioning, target segments and outreach material live in [`GTM.md`](GTM.md) — that file
is internal and must not be published to the site.

## Structure

| Path | What it is |
|---|---|
| `index.html` | Landing page. Self-contained: inline CSS, three vanilla JS blocks, no dependencies |
| `under-oath/` | Under Oath — live public-record claim investigator (calls `/api/oath`) |
| `public-money/` | Public Money Radar — lobbying vs federal contracts (reads `public-money/data.json`) |
| `sources/` | Sources & provenance: every dataset, its license, and how it is accessed |
| `library.html`, `kol/` | Research-leader maps across 59 therapeutic areas (life sciences / SEO surface) |
| `insights.html`, `insights/` | Research landscape decision pages |
| `samples/` | Downloadable cited example packets (PDF) |
| `api/` | Vercel serverless functions, CommonJS |
| `lib.css` | Shared stylesheet — used only by `library.html`, `insights*`, `kol/*` |
| `vercel.json` | Clean URLs + caching for sample PDFs |

`index.html`, `under-oath/`, `public-money/` and `sources/` each carry their own inline
`<style>` block with a duplicated copy of the design tokens. A color or spacing change
means editing each of those files.

### Landing page anchors

`#trust` `#asymmetry` `#build` `#who` `#proof` `#tools` `#work` `#pricing` `#sample`
`#method` `#lifesciences` `#founder` `#contact`

Other pages deep-link to `/#build`, `/#pricing`, `/#contact`, `/#sample` and
`/#lifesciences`. Renaming a section id means updating those links across `kol/`,
`insights/`, and the tool pages.

## API endpoints

| Endpoint | Does |
|---|---|
| `api/oath.js` | Parses a plain-language claim, queries USAspending / Senate LDA / NIH RePORTER / SEC EDGAR / openFDA / CISA KEV, returns an evidence receipt. Returns `INSUFFICIENT_EVIDENCE` rather than asserting a claim is false without a sourced record |
| `api/sample.js` | Live PubMed preview for the life-sciences widget on `/#lifesciences` |
| `api/lead.js` | Free evidence-sample requests. Forwards to `LEAD_WEBHOOK_URL` if set; otherwise the browser falls back to a prefilled `mailto:` |
| `api/counterfactual.js` | Counterfactual evidence finder. **Currently not wired to any page** |

### Environment variables

- `LEAD_WEBHOOK_URL` — optional. Where `/api/lead` forwards a validated request. If unset,
  the form degrades to `mailto:` rather than pretending the lead was captured.

## Preview locally

```
python -m http.server 8080     # then visit http://localhost:8080
```

Note that `/api/*` will 404 under a plain static server. Use `vercel dev` to exercise the
serverless functions.

## Deploy

```
npm i -g vercel
vercel            # first run links/creates the project
vercel --prod     # deploy to production
```

Nothing here deploys automatically. Deploy is a manual call from the owner's Vercel account.

## Adding content

- **New sample packet:** drop the PDF in `samples/`, add a card to the `#work` section of
  `index.html`.
- **New KOL page:** add the HTML to `kol/`, link it from `library.html`, add a `<loc>` to
  `sitemap.xml`.
- **Copy changes:** edit `index.html` directly. Check `GTM.md` first — the phrases listed
  under "Do not lead with" are deliberately kept off the site.
