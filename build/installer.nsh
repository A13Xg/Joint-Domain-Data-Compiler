; electron-builder NSIS hook (picked up through package.json build.nsis.include).
;
; electron-builder points the Start menu and desktop shortcuts at the Electron
; executable. Starting that directly shows nothing until Windows has loaded and
; scanned ~190 MB of it, so the shortcuts are re-pointed at the small launcher
; ("Joint Domain Data Compiler.exe", see launcher/Launcher.cs), which shows the
; splash at once and then starts the app. customInstall runs after
; electron-builder has created both shortcuts, under the same names, so its
; uninstaller still removes them. The icon stays the app's own, and the
; AppUserModelID is re-applied so the shortcut, the launcher's splash and the
; app share one taskbar button.
!macro customInstall
  ${if} ${FileExists} "$INSTDIR\Joint Domain Data Compiler.exe"
    ${if} ${FileExists} "$newStartMenuLink"
      CreateShortCut "$newStartMenuLink" "$INSTDIR\Joint Domain Data Compiler.exe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
    ${endIf}
    ${if} ${FileExists} "$newDesktopLink"
      CreateShortCut "$newDesktopLink" "$INSTDIR\Joint Domain Data Compiler.exe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
    ${endIf}
  ${endIf}
!macroend
