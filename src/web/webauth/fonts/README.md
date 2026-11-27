# WebAuth fonts (self-hosted)

The standalone WebAuth pages authenticate every visitor, so they must not leak
the visitor's IP to a third-party font CDN. This directory holds the IBM Plex
Sans / IBM Plex Sans JP woff2 files that used to be loaded from
`fonts.googleapis.com` / `fonts.gstatic.com`, plus the generated `fonts.css`
with the original `@font-face` rules (same family names, weights and
unicode-ranges) pointing at the local copies.

- Served by `src/web/routes/webauth.ts` at `/webauth/fonts/fonts.css` and
  `/webauth/fonts/<file>.woff2` with
  `Cache-Control: public, max-age=31536000, immutable`.
- Weights: 400, 500, 600, 700. `font-display: swap` as before.
- IBM Plex Sans (Latin/Greek/Cyrillic/Vietnamese) is delivered by Google as one
  file per subset shared by all four weight rules, so those files appear once.
- IBM Plex Sans JP keeps Google's Japanese unicode-range slicing
  (`plex-jp-slice-<n>-<weight>.woff2`), which is what makes Japanese text render
  from small per-range files instead of one huge font.

Regenerate after a Google Fonts update:

```sh
node src/web/webauth/fonts/build-fonts.mjs
```

Licensing: IBM Plex is licensed under the SIL Open Font License 1.1; see
`OFL.txt` (identical for both families).
