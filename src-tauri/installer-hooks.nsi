!macro NSIS_HOOK_POSTINSTALL
  Sleep 1500
  ExecShell "open" "$INSTDIR\vocalype.exe"
!macroend
