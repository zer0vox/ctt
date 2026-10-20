; Token Pup additions to the electron-builder NSIS installer.

; Uninstalling the app (not updating it) puts Claude Code's status line back the way it was
; before Token Pup. This runs before the app's files are removed, so the app can do the work:
; with --uninstall-bridge it restores ~/.claude/settings.json and exits without opening windows.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --uninstall-bridge'
  ${endIf}
!macroend
