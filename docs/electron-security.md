# Electron security contract

The renderer runs with context isolation and sandboxing enabled, without Node integration. The
preload exposes only the five KML/KMZ library operations defined in `electron/security.cjs`; main
and preload share those constants so channel names cannot drift.

Packaged applications apply a strict Electron Fuse V1 set after packing:

- disable `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS`, and Node inspector CLI arguments;
- enable cookie encryption;
- require embedded ASAR integrity on Windows/macOS and load application code only from the ASAR
  on every platform. Linux explicitly disables the integrity fuse because electron-builder cannot
  embed the required executable resource there;
- retain `file:` protocol privileges because the packaged renderer currently uses
  `BrowserWindow.loadFile`, while disabling the browser-process-specific V8 snapshot;
- retain WebAssembly trap handlers.

`strictlyRequireAllFuses` makes an Electron upgrade fail packaging when a new fuse is introduced
until its intended state is reviewed. Focused regression tests pin the IPC surface, navigation
origin policy, path and payload validation, executable paths, and every security-relevant fuse.
The release checklist still requires packaged launch testing because a configuration test alone
does not prove a platform package starts successfully.
