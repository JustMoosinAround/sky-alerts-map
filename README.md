# Sky Alerts Map (public)

This repository publishes the public forecast map for Tyler M Yates Photography. It holds only the web page (`site/`), its tests, and one automatic job (`.github/workflows/publish.yml`). The forecast numbers are calculated by the private `sky-alerts` repository and published here three times a day.

Nothing secret lives in this repo. Only spots you mark `public: true` ever appear on the map (name and position rounded to about 100 m).

Files here are copied from the `public_site/` folder of the private repo. If you change the page, change it there and copy it over.

## One-time setup

Do these in order. Step 3 can only be done after step 6 has run once.

### 1. Create this repository

1. On github.com click **New repository**.
2. Owner: JustMoosinAround. Name: `sky-alerts-map`. Choose **Public**. Leave everything else empty.
3. Ask Claude to push the page and workflow files into it (Claude needs access to this repo for that).

### 2. Create the read-only token

The job needs permission to read the private repo. Give it the smallest permission possible.

1. On GitHub click your profile picture, then **Settings > Developer settings > Personal access tokens > Fine-grained tokens > Generate new token**.
2. Token name: `sky-alerts-map`.
3. Expiration: choose the longest (1 year). **Write the expiry date in the box below.**
4. Resource owner: JustMoosinAround.
5. Repository access: **Only select repositories**, then pick `sky-alerts` and nothing else.
6. Repository permissions: **Contents: Read-only**. (GitHub adds "Metadata: Read-only" by itself; that is expected.) Leave everything else as "No access".
7. Click **Generate token** and copy it now. GitHub shows it only once.
8. Open this repo (`sky-alerts-map`) > **Settings > Secrets and variables > Actions > New repository secret**.
9. Name: `SKY_ALERTS_READ_TOKEN`. Secret: paste the token. Save.

**Token expires on: ____ (renew a week before).** To renew, repeat steps 1 to 9 (or open the token and use **Regenerate**), then paste the new value over the old secret. If it lapses, the job fails and the map stops updating (the page then shows an "out of date" notice); nothing breaks otherwise.

### 3. Turn on GitHub Pages (after step 6)

The `gh-pages` branch does not exist until the workflow has run once, so do this after step 6.

1. In this repo open **Settings > Pages**.
2. Source: **Deploy from a branch**.
3. Branch: `gh-pages`, folder `/ (root)`. Save.
4. After a minute the page is live at `https://justmoosinaround.github.io/sky-alerts-map/`.

### 4. Add your logo and confirm the Contact link

1. Prepare a logo: PNG or SVG, transparent background, about 200 px wide is plenty.
2. In this repo open the `site` folder, click **Add file > Upload files**, and upload it named exactly `logo.png`. (If it is an SVG, name it `logo.svg` and set `logo: logo.svg` under `public_map:` in the private repo's `settings.yaml`.)
3. In the private repo's `settings.yaml`, check `public_map: contact_url:` is the page you want the **Contact me** button to open.
4. The file `site/index.html` here also has a fallback Contact me address, used only if the forecast data fails to load. Make sure it matches `public_map.contact_url` in `settings.yaml`; they are two copies of the same address, so change both if it ever changes.

### 5. Choose which spots are public

In the private repo's `settings.yaml`, add `public: true` to each spot you want on the map, and make sure the `public_map:` block has `enabled: true` and `site_url: https://justmoosinaround.github.io/sky-alerts-map/`. Commit and push. Spots without `public: true` stay private. See the private README, "Public map".

### 6. Run it once by hand

1. In this repo open the **Actions** tab, choose **publish-map**, click **Run workflow**.
2. Wait about 5 minutes. A green tick means it worked; the `gh-pages` branch now exists, so do step 3 now.
3. If it is red, open the run and read the red step. Most often: the secret name is mistyped, the token has no access to `sky-alerts`, or `settings.yaml` has `public_map.enabled: false` or no `public: true` spots.
4. Open the page address from step 3 on your phone and on a computer and check the map, tabs, and Contact me button.

After this, it refreshes by itself three times a day.

**If the refreshes stop:** GitHub switches off scheduled workflows in a public repo after 60 days without repository activity. The map then stops updating and shows its "out of date" notice. Your weekly health message from the private repo will show it as "⚠️ public map last updated N h ago". To turn it back on: open this repo's **Actions** tab, choose **publish-map** on the left, and click **Enable workflow** (then **Run workflow** to refresh at once).

### 7. Put the map on your Wix site

Wix menu names may differ slightly from these; look for the same idea.

1. Open the Wix editor for **Tyler M Yates Photography** and add a new page (or pick the page where the map should go).
2. Click **Add Elements** (the **+**), then **Embed Code**, then **Embed a site**.
3. Click the new element, choose **Enter Website Address** (also called **Change Website Address**), and paste `https://justmoosinaround.github.io/sky-alerts-map/`.
4. Stretch the element to full width and make it about 700 px tall.
5. Switch to the **mobile view** in the editor, check it, and set the height there too so nothing is cut off.
6. Click **Publish**.

## Open-Meteo terms (please read)

Forecasts come from Open-Meteo's free service, which is for **non-commercial use**. The map is run as a free public service: no ads, nothing behind a paywall, nothing sold through it. Keep it that way, or switch to Open-Meteo's paid commercial plan (only an API key setting would need adding).

Map tiles are from OpenStreetMap, which allows light use with credit (the page shows "© OpenStreetMap contributors"). If the page becomes very busy, a paid tile provider is a one-line change in `site/app.js`.
