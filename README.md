# Kukatpally Drilldown

An interactive map that starts with India and zooms step by step into two assembly constituencies, **Kukatpally (AC 46, Hyderabad)** and **Gadwal (AC 79, Jogulamba Gadwal)**. It then drills down to polling stations and each station's voter list.

```
India → Telangana → Greater Hyderabad → Kukatpally (11 wards) → polling station → voters
India → Telangana → Gadwal (4 mandals)                        → polling station → voters
```

- One smooth, continuous zoom between levels: every level uses the same map projection. The "Kukatpally ✈" and "Gadwal ✈" buttons do the whole trip in one go.
- Each level's map is shaded by population density. In a constituency you can colour polling stations by turnout, electors, first-time voters, women, electors aged 80+, or social-category share, as below, around or above the constituency average.
- The side panel shows population figures, voter statistics (gender, age, turnout, households) and a caste-share dashboard (SC, ST, BC, OC, with the difference from the constituency average) for the constituency, a ward or mandal, and each station.
- Click a ward or mandal to zoom in on it. Click a station for its details. **View voter list** opens that station's voters, with search, gender and age filters, pages, and a card per voter showing their household.
- **Find voter** (header button): type a name and see which polling station each matching voter is at, across both constituencies. Spelling variants match (Santhosh / Santosh / Santhos, Lakshmi / Laxmi, Sreenivas / Srinivas), and an initial can stand for a full word ("R. Santosh" finds "Santhosh Rote"). Narrow it down by father's or husband's name, age (±2), gender or constituency, or paste a sample voter ID. Click a match to fly to the station and open its voter list at that person.
- **Duplicates** (header button): scans every voter in both constituencies for records that are probably the same person written differently. That covers spelling variants, an initial vs a full family name ("R. Santosh" / "Rote Santhosh"), words in a different order, age off by a year or two, and a relative's name spelled differently. Each pair shows a confidence level (High / Medium / Possible), where the two records are (same station, different stations, different constituencies), and the reasons. You can open either record in its station list, or export the pairs as a CSV file for a Form 7 submission. Nothing is ever removed automatically.
- The search box finds a station in either constituency by number, building, street, ward or mandal (for example "gadwal 12" or "ghattu school").
- Each level has its own URL (`#india`, `#telangana`, `#ghmc`, `#kukatpally`, `#gadwal`).
- Includes light and dark themes, a mobile layout and keyboard support.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build into dist/
```

## Polling stations and voters

At the Kukatpally level, the map can show polling station pins. Click a pin to see the station number, building, address, number of electors, ward, and a link to Google Maps. The side panel lists the stations, either for the whole area or for the selected ward, with a search box.

**Voter statistics.** Each station can carry an elector breakdown: men, women and third gender, eight age bands from 18–19 to 80+, households, broad social category (SC, ST, BC, OC), and turnout at the last assembly election. The Kukatpally, ward and station panels show these as totals (electors, turnout with approximate votes polled, first-time voters, gender ratio, households, electors aged 80+), plus charts by gender, social category and age and the five lowest-turnout stations. These are aggregate counts only. The app holds no individual voter records. Electoral rolls don't record caste, so real social-category figures would have to come from a survey, such as Telangana's 2024 caste survey.

For now, `src/data/booths.json` holds **synthetic stations** made by `npm run sample:booths`: 417 for Kukatpally and 295 for Gadwal. They are random points inside the wards with generic names and synthetic voter statistics. The app labels them "Sample data · not real polling stations" and hides the Google Maps link. To load the real list instead:

1. Download the AC 46 Kukatpally polling station list from the Chief Electoral Officer, Telangana (ceotelangana.nic.in).
2. Convert the table to CSV with the columns in `data/booths-template.csv`: `ps_no,name,address,lat,lng,voters`. If the list is a PDF, Tabula works well, or you can open it in Excel or Google Sheets. `lat`, `lng` and `voters` are optional.
3. Run `npm run import:booths -- path/to/stations.csv --source "CEO Telangana PS list, <year>"`.
   - Rows without coordinates are looked up on OpenStreetMap (Nominatim), about 1 per second, so 417 stations take roughly 8 to 15 minutes. Results are cached in `scripts/.geocode-cache.json`.
   - The script lists the stations it could only place approximately (by locality) and any it couldn't find. Add `lat,lng` for those in the CSV and run it again. Rows that already have coordinates are kept exactly as given.
4. Commit `src/data/booths.json` and push. Netlify redeploys automatically.

Each station is assigned to a ward automatically by its position. Stations outside the 11 mapped wards still appear, with the ward shown as "—".

**How the duplicate scan works.** Comparing every voter with every other would take about 2×10¹¹ comparisons, so the scan only compares voters who could plausibly be the same person. They must share the same gender, a name word and a relative-name word with the same phonetic key (in any order), and an age within 2 years. That comes to about 19 lakh comparisons, roughly 6 seconds in a background thread, and the results are kept for the session. Each pair is scored on name (50%), relative's name (35%) and age (15%), using stricter matching rules than search: spelling variants match by sound, but extra typos are only forgiven in long words, and an initial standing in for a whole word counts for less.

The sample data includes about 1,500 deliberately planted duplicate pairs (15% in the same station, 10% across the two constituencies). The scan finds 99% of them. All planted pairs land in High or Medium, and the remaining High/Medium pairs are coincidental look-alike records, the kind a real check should flag anyway.

**Voter lists.** Each station's voter list is generated in the browser from that station's own totals, so the list always matches the dashboard (same counts by gender and age band, grouped into its households). Each voter has a serial number, a name, a relative, age, gender, house number and a **sample** voter ID (`SMP` + 7 digits, never a real ID number). The list is labelled "made-up people".

> Caste is deliberately **not** attached to individual voters. Electoral rolls don't record it, and pairing caste with named people would make the tool usable for caste-based targeting, which India's election law treats as a corrupt practice. Caste appears only as percentages for a station, ward or mandal, or a whole constituency. Family names in the sample are made up from syllables (and checked against a blocklist), so no real, caste-linked surname appears.

**Importing real stations for one constituency** (the other one is left untouched):

```bash
npm run import:booths -- kukatpally.csv --ac 46 --source "CEO Telangana PS list, 2025"
npm run import:booths -- gadwal.csv --ac 79 --name Gadwal --source "CEO Telangana PS list, 2025"
```

## Sign-in

Sign-in is checked on the server, so signed-out visitors never receive the app or its data.

- `netlify/edge-functions/guard.ts` runs before **every** request. Without a valid session cookie it returns only `/login.html`: page visits are redirected there, and any other file gets a 401.
- `POST /api/login` (`netlify/functions/login.mts`) checks the password against a PBKDF2-SHA256 hash (210,000 iterations). On success it sets a signed (HMAC-SHA256), `HttpOnly`, `Secure`, `SameSite=Lax` cookie that lasts 12 hours. Failed attempts are slowed down.
- `GET /api/me` returns the signed-in user and `POST /api/logout` clears the cookie.
- Passwords and the signing secret live in Netlify environment variables, never in this repo.

### Setting it up (once)

1. On your computer, run `npm run add-user -- admin "Admin" --secret`. Type a password of at least 10 characters (twice, hidden). It prints an `AUTH_USERS` value and a `SESSION_SECRET`.
2. In Netlify, go to **Site configuration → Environment variables** and add both:
   - `SESSION_SECRET`: the printed secret.
   - `AUTH_USERS`: the printed JSON array.
3. Redeploy: **Deploys → Trigger deploy → Deploy site**. Until both variables exist, the login page says sign-in isn't set up, and nobody can get in.

**Adding a user:** run `npm run add-user -- <username> "<Display name>"` and add the printed object to the `AUTH_USERS` array, then redeploy.

**Removing a user:** delete them from `AUTH_USERS` and redeploy.

**Signing everyone out:** change `SESSION_SECRET` and redeploy.

### Local development

`npm run dev` runs plain Vite without the Netlify functions, so it signs you in automatically as "Developer". To test the real sign-in locally, use the Netlify CLI (`npx netlify-cli dev`) with the same two variables set.

## Deploy to Netlify

The repo already includes `netlify.toml` (build command `npm run build`, publish folder `dist`, Node 22), so there is nothing to configure by hand:

1. In Netlify choose **Add new site → Import an existing project**, then pick this GitHub repo and branch.
2. Leave the build settings as Netlify detects them from `netlify.toml`, then click **Deploy**.

Or use the CLI: `npx netlify-cli deploy --build --prod`.

## Data

| Level | Boundaries | Statistics |
|---|---|---|
| India states | [udit-001/india-maps-data](https://github.com/udit-001/india-maps-data) (districts merged into states) | Census of India 2011 |
| Telangana districts | same source (33 districts) | Census 2011, regrouped into the post-2016 districts |
| Gadwal mandals (Gadwal, Dharur, Maldakal, Ghattu; pre-2016 boundaries) | [gggodhwani/telangana_boundaries](https://github.com/gggodhwani/telangana_boundaries) | **Sample data** |
| GHMC wards | [DataMeet Municipal_Spatial_Data](https://github.com/datameet/Municipal_Spatial_Data) (based on OpenStreetMap) | **Sample data** |
| Kukatpally wards 114–124 | same | **Sample data** |

> ⚠ **Ward-level numbers are made-up sample values.** They are generated from a fixed seed in `src/data/stats.ts`, and the app labels them "Sample data". Swap them for official GHMC or Census ward figures before relying on them.

To rebuild the simplified boundary files, run `./scripts/build-geo.sh`. It downloads the sources and simplifies them with mapshaper.

## Project layout

```
src/
  data/geo/*.json        simplified GeoJSON boundaries
  data/stats.ts          statistics + ward sample generator (replace with real data here)
  geo.ts                 projection, regions, and the level (view) definitions
  format.ts              number formatting + density colour scale
  components/MapView.tsx SVG map, camera animation, tooltip, labels
  measures.ts            "colour stations by" measures and their below/around/above-average classes
  session.ts             asks the server who is signed in; logout
  components/StatsPanel.tsx  KPIs, age chart, ranking, station list
  components/ElectorStats.tsx voter statistics and caste-share dashboard
  components/VoterList.tsx    a station's voter list, filters and voter card
  voters.ts              synthetic voter generator (matches each station's totals)
  nameMatch.ts           fuzzy matching for Indian name spellings (voter search, duplicates)
  components/DuplicateReview.tsx  duplicate pairs: tiers, filters, reasons, CSV export
  voterSearch.worker.ts  background index + search over every voter
  components/VoterFinder.tsx  the Find voter panel
  App.tsx                header, breadcrumb, legend, routing
public/login.html        stand-alone sign-in page (the only page signed-out visitors get)
netlify/
  edge-functions/guard.ts  blocks every request without a valid session
  functions/*.mts          /api/login, /api/logout, /api/me
  lib/session.ts           password hashing, signed cookies, settings
```

### Adding a level or feature

- **New drill level:** add a `ViewId` and an entry in `VIEWS` (`src/geo.ts`), set `drillTo` on the parent regions, and render the new layer in `MapView`.
- **Real ward data:** replace `wardStats()` in `src/data/stats.ts` with a lookup from your dataset, keyed by ward number, and set `source` to the right value.
- **New metrics:** add fields to `Stats`, then show them in `StatsPanel`.
