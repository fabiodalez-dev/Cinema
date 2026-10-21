# Validation on LG webOS 5.6.2

Target: LG 43UN70006LA, firmware 04.64.00, ARM32, approximately 1 GB RAM.

- Upstream tests retained. 37 automated checks cover remote routing, app launching, focus, aerial stepping and the added Jellyfin client (Authorization headers, timeout/401 rejection and malformed metadata).
- IPK produced with the upstream packager. Archive file dates verified; transferred package SHA-256 compared before installation.
- On-device checks: genuine installed app icons load; film/series/resume/music data and artwork come from Jellyfin; all nine original settings categories remain, with Cinema added to Tools.
- Directional navigation moves between dock, media, hero actions and top navigation.
- Litefin accepts a selected music album through the optional adapter and uses its existing details route.
- Fallback checked on the TV by injecting Jellyfin request failures: cached titles remain and all eight dock tiles remain available. A separate launch without credentials or media cache verifies the local fallback.
- Home and boot use the original Launch Home hooks. Input Hook is not required for this installation. LG's default home setting is retained.

The original voice assistant, external aerial sources, USB media browsing and weather are preserved in source but were not end-to-end exercised with personal API credentials or removable media. Automated media tests use a DOM environment which cannot decode or play real media. Preserving a feature does not imply every external service was live-tested.

Device-only restore script: `/var/lib/launch-home-cinema/restore.sh`. It disables the fork's Home/boot hooks, restores Litefin's saved HTML, removes the adapter and requests removal of the launcher, then opens LG Home. It leaves the previously installed apps and debloat configuration intact.
