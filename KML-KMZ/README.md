# Persistent KML/KMZ Library

This directory supplies the Electron desktop app's development-time KML/KMZ library and packaged seed content.

- In the Electron app, open **Map** to upload, browse, and manage stored KML/KMZ files. The Map tab is available even before importing a normal dataset.
- **Import as data** reads a stored KML/KMZ as a normal immutable trajectory dataset for table, chart, 3D, comparison, and export workflows.
- **Add overlay** renders KML/KMZ geometry as a separate, non-dataset Map layer. Its visibility and opacity are persisted with the workspace; missing library files remain as disabled, auditable references until removed.
- `Special_Use_Airspace.kml` is packaged as an immutable application resource. On first run, it is copied into the user-writable library only when absent; existing user copies are never overwritten.
- Packaged builds use the Electron user-data directory for the writable library rather than this repository checkout.
- Keep only representative, non-sensitive sample overlay files in git.
