# Kukatpally Drilldown

An interactive map that starts with India and zooms step by step into **Kukatpally, Hyderabad**, showing population statistics at each level.

```
India (36 states/UTs) → Telangana (33 districts) → Greater Hyderabad (GHMC wards) → Kukatpally (11 wards)
```

- One smooth, continuous zoom between levels: every level uses the same map projection, so moving from India to a ward is a single animated camera move. The "Fly to Kukatpally" button does the whole trip in one go.
- Each level's map is shaded by population density (people per km²).
- The side panel shows population, density, area, households, sex ratio and literacy, plus an age profile, mother-tongue split and a ranked list of the areas one level down.
- Hover over an area for a tooltip. Click an area with a glowing outline to zoom in; click any other area to see its stats. The breadcrumb and back button take you up a level.
- Each level has its own URL (`#india`, `#telangana`, `#ghmc`, `#kukatpally`), so you can bookmark or share one.
- Includes light and dark themes, a mobile layout and keyboard support.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build into dist/
```

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
  components/StatsPanel.tsx  KPIs, age chart, language bar, ranking
  App.tsx                header, breadcrumb, legend, routing
```

### Adding a level or feature

- **New drill level:** add a `ViewId` and an entry in `VIEWS` (`src/geo.ts`), set `drillTo` on the parent regions, and render the new layer in `MapView`.
- **Real ward data:** replace `wardStats()` in `src/data/stats.ts` with a lookup from your dataset, keyed by ward number, and set `source` to the right value.
- **New metrics:** add fields to `Stats`, then show them in `StatsPanel`.
