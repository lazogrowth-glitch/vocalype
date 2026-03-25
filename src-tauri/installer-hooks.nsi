!macro NSIS_HOOK_POSTINSTALL
  Sleep 2000
  ExecShell "open" "$INSTDIR\vocalype.exe"
!macroend
