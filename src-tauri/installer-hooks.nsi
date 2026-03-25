!macro NSIS_HOOK_POSTINSTALL
  ExecShell "" "$INSTDIR\vocalype.exe"
!macroend
