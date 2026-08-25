# TierFlow on GitHub Pages

This folder contains a static GitHub Pages frontend plus a small Cloudflare Worker used only to import public TierMaker template pages.

## Files to upload to your GitHub repository

Upload these to the repository root:

- `index.html`
- `styles.css`
- `app.js`
- `config.js`

Then enable **Settings → Pages → Deploy from a branch**, using your main branch and `/ (root)`.

## Why there is also `worker.js`

GitHub Pages is static hosting. A browser page hosted there cannot reliably fetch and parse `tiermaker.com` pages directly because of cross-origin restrictions. The Worker acts as a very small importer proxy.

## Deploy the importer on Cloudflare Workers

1. Create a free Cloudflare account if needed.
2. Go to **Workers & Pages → Create → Worker**.
3. Replace the generated Worker code with the contents of `worker.js`.
4. Deploy it.
5. Copy the resulting Worker URL, for example:
   `https://tierflow-importer.example.workers.dev`
6. Open `config.js` and set:

```js
window.TIERFLOW_CONFIG = {
  API_BASE: "https://tierflow-importer.example.workers.dev"
};
```

7. Commit/push that change to GitHub.

Your GitHub Pages site can then paste a public `tiermaker.com/create/...` URL and call:

`https://YOUR-WORKER.workers.dev/api/import`

## Notes

- This importer relies on TierMaker's public page markup and is therefore inherently somewhat fragile if TierMaker changes its HTML.
- The frontend intentionally does not use TierMaker branding or copy the site pixel-for-pixel. It implements the focused one-item-at-a-time ranking workflow.
- If imported images are blocked from hotlinking by their host, an additional image proxy would be needed. The current build does not proxy images.
