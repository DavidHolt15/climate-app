# Climate — tablet weather + indoor sensor display

A web app for the Samsung Tab S8+ with three pages: **Outdoor** (from
yr.no / MET Norway), **Indoor** (temperature + humidity from your STM32 board
over Wi-Fi) and **Workout** (a one-per-day training calendar).

The layout adapts to the screen: on the tablet in landscape there is a
navigation rail down the left side; in portrait (or on a phone) it becomes a
bar along the bottom. It follows the device's light or dark setting. The
outdoor card's background changes with the weather and with day or night.

## How it runs

It is a **hosted web app (PWA)**. The files sit on a static HTTPS host
(e.g. GitHub Pages). You open the address once in Chrome on the tablet and
**install** it; from then on it runs on the tablet by itself:

- **No PC or server needed.** The app's files are saved on the tablet, so it
  opens even with no internet. The workout log and settings are stored on the
  tablet too.
- **Weather** needs internet, but the last forecast is saved and shown (with
  its time) when the tablet is offline.
- **Updates are automatic.** Whenever the app is opened while the tablet is
  online it loads the newest published files. To update, just publish; see
  below.

### Install on the tablet

1. Open **https://davidholt15.github.io/climate-app/** in **Chrome** on the
   tablet.
2. Chrome menu (⋮) → **Add to Home screen** / **Install app**.
3. Open it from the new icon. It runs full-screen like a native app.
4. Tap **Settings** and check the place, latitude/longitude (default
   **Kongsberg**, 59.6689, 9.6502) and the sensor address.

### Publish / update

The app is published with GitHub Pages from the `main` branch of
[DavidHolt15/climate-app](https://github.com/DavidHolt15/climate-app). To
update it, commit and push to `main`; a minute or so later the tablet picks
the change up the next time the app is opened online. (`.claude/` is not
published; see `.gitignore`.) Any other static HTTPS host would work the same
way.

The whole app is public once published. It contains no personal data: your
workouts, settings and sensor address live only on the tablet.

### Try it on a PC

Serve the folder with any static file server and open it on `localhost`
(service workers work there). For example, with Node: `npx serve .`

## Settings

Tap **Settings** (bottom of the rail, or the bottom bar) to set:

- **Place name**: label on the outdoor card.
- **Latitude / longitude**: your home, or **Use my location**.
- **STM32 climate URL**: e.g. `http://192.168.1.50/climate` (see below).
- **Back up**: save a backup file, or restore one (see Workout log).

Settings are stored in the browser on the tablet. They survive restarts but
are specific to that device.

## Outdoor data (yr.no)

Uses MET Norway's free, public **Locationforecast** API directly from the
browser:

```
https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=..&lon=..
```

No API key needed. It refreshes every 10 minutes (their guidance is not to
poll more often than the forecast actually changes). Shows current temp, the
next-24-hours high and low, humidity with dew point, wind with a direction
arrow, pressure, next-hour rain, a weather icon, and a 12-hour strip whose
bars show the temperature trend. The last good forecast is kept on the
tablet and shown when yr.no can't be reached.

**Two things worth knowing:**

- **Attribution**: MET Norway requires crediting them when you use the
  data; the app already shows "Weather data: MET Norway / yr.no (CC BY
  4.0)" under the outdoor page.
- **User-Agent header**: MET Norway's terms ask every client to send an
  identifying `User-Agent` (e.g. `myclimateapp/1.0 me@example.com`), since
  browsers won't let JavaScript set that header itself. For a single
  personal tablet this is very unlikely to cause trouble in practice.

## Indoor data (STM32 over Wi-Fi)

The app polls a URL you give it every 10 seconds and expects a small JSON
body:

```json
{ "temperature": 21.4, "humidity": 45.2 }
```

Requirements on the STM32 side:

- Serve that JSON over plain HTTP from the board (a GET on whatever path
  you like, e.g. `/climate`) at a fixed address. Give the board a DHCP
  reservation in your router so its IP never changes.
- **CORS header is required**: the browser will block the response
  otherwise. Add this response header on the STM32's HTTP server:
  ```
  Access-Control-Allow-Origin: *
  ```
- Temperature in °C, humidity in %RH, as plain numbers (not strings).

**Because the app is served over HTTPS and the board speaks plain HTTP**,
Chrome treats the request as one to your local network and asks for
permission ("Local network access") the first time. Allow it. If Indoor says
the sensor is unreachable, check Chrome's site settings for the app (lock
icon, or Settings → Site settings) and that **Local network access** is
allowed. The app marks these requests as local-network requests so Chrome
permits them; this needs a recent Chrome (141 or newer on Android). The
address must be a private IP (192.168.x.x, 10.x.x.x, 172.16–31.x.x) or a
`.local` name.

Until the sensor exists, you can see the indoor page work with simulated
data by opening the app with `?demo` added to the address (for example
`index.html?demo`); it animates fake readings so you can check
layout/behavior.

Each reading is shown on a ring gauge (temperature on a 10–35 °C scale,
humidity on 0–100 %) with a comfort label: temperature is *Cool* below 19 °C,
*Comfortable* up to 24 °C and *Warm* above; humidity is *Dry* below 30 %,
*Comfortable* up to 60 % and *Humid* above. A status pill shows whether the
sensor is live.

If a reading is older than 60 seconds (sensor off, Wi-Fi down, wrong IP),
the gauges dim and the pill says when the last good reading came in, rather
than silently freezing on stale numbers.

## Workout log

The **Workout** tab records **one workout per day, with no time of day**:
**Push, Pull, Legs, Upper, Lower** or **Full Body**. A calendar of the current
month (Monday first) shows each day's workout as a label (a dot on narrow
screens). Tap a day to select it (today is selected by default), then tap a
workout type to set that day's workout. Tapping a different type replaces it,
and **Clear this day** removes it. This also lets you fill in a day you forgot;
days still to come are disabled. Two counters show **Workouts this week**
(Monday to Sunday) and **Workouts this month** (calendar month).

- **Stored on the tablet**, in the app's browser storage (the newest 100
  days). The app asks Chrome to keep it permanently. Clearing the site's data,
  or uninstalling the app, deletes it.
- **Back up**: Settings → **Save backup file** writes a JSON file (workouts +
  settings) to Downloads. **Restore from file** loads one, on this or another
  device: days in the file replace the same days on the device and other days
  are kept. A line under the calendar shows when you last made a backup.
  Older backups in the earlier format (with times) are also accepted.
- `?workout` added to the address opens straight on the Workout page.
- `?demo` uses a separate fake history that is kept apart from the real one.
- The workout types are `WORKOUT_TYPES` in `app.js`; the storage cap is
  `WORKOUT_KEEP`.

## Files

- `index.html`: markup: navigation, three pages (Outdoor / Indoor / Workout) + settings dialog
- `styles.css`: design tokens (colours, light/dark), layout for landscape, portrait and phone
- `app.js`: all logic: yr.no fetch/render, sensor polling, workout log, backup, settings
- `sw.js`: service worker: offline support and automatic updates (network first)
- `manifest.webmanifest`, `icon.svg`, `icons/`: install name and icons
- `.gitignore`: keeps local tooling out of the published site

## Customizing

- Poll intervals, staleness threshold, and the demo toggle are constants
  at the top of `app.js` (`OUTDOOR_EVERY_MS`, `INDOOR_EVERY_MS`,
  `STALE_AFTER_MS`).
- Comfort thresholds for the temperature and humidity labels are in
  `renderIndoor()` in `app.js`. Colours (including one colour per workout
  type) are the variables at the top of `styles.css`.
- If you ever add a new file the app needs offline, add it to `SHELL` in
  `sw.js`.
