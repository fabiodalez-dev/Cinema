# Validation on LG webOS 5.6.2

Target: LG 43UN70006LA, firmware 04.64.00, ARM32, approximately 1 GB RAM.

- Upstream tests retained. 42 automated checks cover remote routing, app launching, focus, aerial stepping and the added Jellyfin client (Authorization headers, timeout/401 rejection and malformed metadata), plus native Live source validation, lifecycle cleanup, stale callbacks, error/desktop fallback, early input discovery and remote-key routing.
- IPK produced with the upstream packager. Archive file dates verified; transferred package SHA-256 compared before installation.
- On-device checks: genuine installed app icons load; film/series/resume/music data and artwork come from Jellyfin; all nine original settings categories remain, with Cinema added to Tools.
- Directional navigation moves between dock, media, hero actions and top navigation.
- Live opens the native TV pipeline (`tv://`, readyState 4, 1920×1080, no player error). HDMI 1 switches to `ext://hdmi:1` with readyState 4 and no error. Remote Down moves source → full-screen action → dock. Returning to Home or classic mode leaves zero Live video elements; returning to Cinema recreates exactly one TV source. The user confirmed actual programme video and audio work behind the launcher controls. CDP screenshots omit the hardware video plane; HDMI input readiness was checked, but a connected HDMI device’s programme content was not independently confirmed.
- Litefin accepts a selected music album through the optional adapter and uses its existing details route.
- Fallback checked on the TV by injecting Jellyfin request failures: cached titles remain and all eight dock tiles remain available. A separate launch without credentials or media cache verifies the local fallback.
- The original boot hook launches Cinema after a TV restart. The original Home watcher failed the physical remote test on webOS 5; LG Input Hook 1.5.1 now maps Home (773) directly to Cinema, confirmed by the user. LG's default home setting is retained.
- Litefin companion plugin 1.12.0.4 is active on Jellyfin 12; its Seerr Status reports configured/available. Discovery and search both return HTTP 200 with 20 results. No media request/download was created for testing.

The original voice assistant, external aerial sources, USB media browsing and weather are preserved in source but were not end-to-end exercised with personal API credentials or removable media. Automated media tests use a DOM environment which cannot decode or play real media. Preserving a feature does not imply every external service was live-tested.

Device-only restore script: `/var/lib/launch-home-cinema/restore.sh`. It disables the fork's Home/boot hooks, restores Litefin's saved HTML, removes the adapter and requests removal of the launcher, then opens LG Home. It leaves the previously installed apps and debloat configuration intact.
