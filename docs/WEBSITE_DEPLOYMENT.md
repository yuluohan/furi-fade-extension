# Website Deployment

The public Fading Furigana website lives in `site/` and is designed for Cloudflare Pages Direct Upload from GitHub Actions.

## Public URLs

Default Cloudflare Pages project name:

```text
fading-furigana
```

Canonical production URLs:

```text
Marketing URL: https://fading-furigana.japanstudylab.com/
Privacy Policy URL: https://fading-furigana.japanstudylab.com/privacy/
Support URL: https://fading-furigana.japanstudylab.com/support/
Acknowledgements URL: https://fading-furigana.japanstudylab.com/acknowledgements/
```

Default Cloudflare Pages preview URLs:

```text
Marketing URL: https://fading-furigana.pages.dev/
Privacy Policy URL: https://fading-furigana.pages.dev/privacy/
Support URL: https://fading-furigana.pages.dev/support/
Acknowledgements URL: https://fading-furigana.pages.dev/acknowledgements/
```

`site/robots.txt` and `site/sitemap.xml` use the custom domain as the canonical production domain.

## One-Time Cloudflare Setup

The GitHub Action will try to create a Cloudflare Pages project named `fading-furigana` before deploying. You can also create it manually in Cloudflare Dashboard under Workers & Pages, or set the GitHub repository variable `CLOUDFLARE_PAGES_PROJECT_NAME` to a different project name.

Add these GitHub Actions repository secrets:

```text
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_API_TOKEN
```

The API token needs `Account > Cloudflare Pages > Edit` permission for the account. A token that only deploys Workers will fail the website workflow with `Authentication error [code: 10000]`.

If you want to keep the existing Worker deploy token separate, add this optional secret and give it Pages permissions:

```text
CLOUDFLARE_PAGES_API_TOKEN
```

The website workflow uses `CLOUDFLARE_PAGES_API_TOKEN` first, then falls back to `CLOUDFLARE_API_TOKEN`.

## GitHub Actions

`.github/workflows/deploy-site-cloudflare-pages.yml` deploys `site/` on pushes to `dev` that touch the website files, and can also be run manually with `workflow_dispatch`.

The existing `.github/workflows/deploy-cloudflare.yml` Worker demo deployment is left unchanged.
