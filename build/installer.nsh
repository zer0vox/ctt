; On uninstall (not update), the app restores Claude Code's status line.
; Runs before the app's files are removed.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --uninstall-bridge'
  ${endIf}
!macroend
