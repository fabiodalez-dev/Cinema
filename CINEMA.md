# Cinema

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

## webOS 5 Home button and Seerr

On the target webOS 5 TV, LG Home is an overlay and the stock foreground watcher does not reliably see it. LG Input Hook 1.5.1 is therefore installed separately and maps remote Home key 773 directly to this app. The user confirmed the physical Home button opens Cinema. The original boot-on-start hook is retained and was verified after a TV restart.

Scopri opens Litefin’s Discover page. Seerr integration is handled by the official Litefin companion plugin on the Jellyfin server, with its Seerr URL and API key stored only on that server. No Seerr admin key is sent to the TV or bundled with this fork.

## Live TV and external inputs

Selecting Live immediately embeds `tv://` with webOS' broadcast service behind the launcher. Its source row offers TV first, then all detected inputs (including HDMI, AV and Component), retaining custom input labels. The list updates if input discovery completes after opening Live. Choosing a supported source changes the single embedded native pipeline; Schermo intero opens the selected source through the original input controller. Riprova recreates the preview, and Canali opens the channel picker, which changes the channel inside the preview.

The native video pipeline is released when leaving Live, switching to the original interface, hiding the app or opening another app. Source changes remove the old pipeline before creating a new one. Ambient wallpaper motion/music and the in-app idle screensaver do not compete with Live viewing. Volume keys are left to webOS during Live. CH+/CH− (which the LG remote reports to a web app as PageUp/PageDown) and the number keys change channel inside the preview, as on LG's Live TV, and a banner shows the channel number, name and programme: the channel becomes the TV's last channel (`utp.channel/setLastChannelId`, through `scripts/channels.sh` as root) and `tv://` reopens on it, so LG's Live TV never comes to the front. Quick CH presses are gathered into one change; a number is taken when no longer channel number can follow it, on OK, or after a short pause. On an HDMI source the channel keys go back to TV. A desktop preview explains that live video is TV-only; it never pretends to show a broadcast. Errors and missing signals retain source selection and the full-screen fallback.

This uses the [webOS Homebrew input embedding mechanism](https://www.webosbrew.org/develop/guides/web-app/#inputtv-embedding). It does not change the launcher's window type or replace LG's native input applications.

## TV settings and motion

The application is displayed as **Cinema**. A full-screen settings surface uses a large category menu, independent content scrolling, 92 px rows, readable labels and native switches. All previous categories remain accessible, with a new Cinema page for Jellyfin, Seerr discovery/status, Home mapping status, boot, Live title shadows and lightweight animation preferences. The Home status reads LG Input Hook’s existing mapping; opening its configurator never rewrites that mapping automatically.

Preferences apply with Salva, while Chiudi discards unsaved Cinema changes. The five boolean Cinema preferences are included in ordinary settings backups; Jellyfin/Seerr credentials are excluded. Existing app, voice, USB, weather, profile and backup controllers remain. Heavy performance effects stay disabled, with a small whitelist for 160–220 ms transform/opacity feedback. Reduced motion and the Cinema motion switch disable those effects. Upstream authorship and licence remain in repository documentation.
