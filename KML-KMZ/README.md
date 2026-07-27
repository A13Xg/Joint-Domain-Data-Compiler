# Persistent KML/KMZ Library

This directory is the desktop app's development-time persistent library for KML and KMZ overlays/tracks.

- Files uploaded from the KML/KMZ tab are copied here when running the Electron app in development.
- Stored files can be selected from the UI and imported as normal datasets for map, table, chart, 3D and export workflows.
- Production packaged builds use the app user-data directory instead of the repository checkout.
- Keep only representative, non-sensitive sample overlays in git.
