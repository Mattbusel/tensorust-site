# Tensorust site

Static one-page site: what Tensorust does, example cited briefs (downloadable PDFs),
industries served, offerings, method, and a Contact button that opens an email to
mattbusel@gmail.com.

## Files
- `index.html` - the whole site (self-contained, inline CSS, no build step)
- `samples/` - the downloadable example briefs (battery, GLP-1 KOL, graphene)
- `vercel.json` - clean URLs + caching for the sample PDFs

## Preview locally
Open `index.html` in a browser, or:
```
cd C:\autocoder\datasite
python -m http.server 8080
# then visit http://localhost:8080
```

## Deploy to Vercel ($0)
Option A - Vercel CLI:
```
npm i -g vercel
cd C:\autocoder\datasite
vercel            # first run links/creates the project
vercel --prod     # deploy to production
```
Option B - GitHub -> Vercel: push this folder to a GitHub repo, then "Import Project"
at vercel.com and point it at the repo (framework preset: Other / static).

## To update
- Add new sample PDFs to `samples/` and add a matching card in the "Example briefs"
  section of `index.html`.
- Rename brand or edit copy directly in `index.html`.
- LinkedIn: add your Tensorust LinkedIn URL to the footer (a placeholder note is there).

Nothing here is deployed automatically. Deploy is your call, from your Vercel account.
