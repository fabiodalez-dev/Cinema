# Launch Home Cinema

A fork of [gprot42/webos-launch-home](https://github.com/gprot42/webos-launch-home), based on commit `51b901508dfc69e6fed492d61c2aeb1d4ef5f595`.

The original application controllers, full settings, backgrounds (including aerials), ambient music, forecast, TV channels, app scanning, profiles, backup/restore, screensaver, root hooks and optional voice assistant remain. Cinema is an additional presentation layer. The yellow remote key switches between Cinema and the original interface. Settings → Tools also contains the Cinema switches.

The design follows a user-provided TV Home prototype, refined towards Google TV: a cinematic backdrop, plain controls, genuine app icons and a bottom dock. There is no additional frontend framework.

## Jellyfin

Film, series, resume and music album lists are fetched asynchronously, using bounded thumbnails and a single hero backdrop. Search also includes music. Existing app/HDMI launching never waits for Jellyfin. Cached metadata and artwork provide a fallback; without any cache the Home presents local app shortcuts and a bundled static background.

On a rooted TV provision `/var/lib/launch-home-cinema/jellyfin.json`, mode 0600, with `server`, `userId`, `token`, and optional `userName`. The Homebrew Channel service must already run elevated. Credentials are device-local; they are never included in this repository or the IPK and never added to artwork URLs. Jellyfin requests use the Authorization header supported by current Jellyfin.

Settings → Tools can disable Jellyfin or its backdrop without changing the original background settings. Original music/weather remain available, but new installs start them disabled rather than fetching a forecast for a default city or auto-playing ambient music.

## Litefin adapter

`scripts/cinema-litefin-bridge.js` is optional. On the TV it can be copied into the installed Litefin folder and referenced by its `index.html`, after keeping a backup. It translates only the explicit `cinemaItemId` and `cinemaAction` parameters into Litefin's own router. Removing the script reference restores stock Litefin behavior. Reinstalling/updating Litefin also removes this adapter; the launcher still opens Litefin normally if the adapter is absent.

## Build

```
npm ci
npm test
npm run pack
```

The upstream packager and epoch timestamp verification are preserved. The app ID is unchanged so the original Home/boot/voice hooks continue to work. Do not install an upstream update over this fork if you want to keep Cinema.

## Assets

Geist is bundled under its SIL Open Font License (see assets/fonts). Native app icons are a small snapshot from the target TV used as a fallback; a runtime scan still reads installed icons and caches them. App trademarks and artwork belong to their owners. Jellyfin library metadata and artwork are never bundled.
