; Nawfy Custom NSIS Installer Script
; Included by electron-builder during build

; ── Welcome page customization ────────────────────────────────
!define MUI_WELCOMEPAGE_TITLE "Welcome to Nawfy"
!define MUI_WELCOMEPAGE_TEXT "Nawfy is your personal music player powered by YouTube.$\r$\n$\r$\nThis will install Nawfy ${VERSION} on your computer.$\r$\n$\r$\nClick Next to continue."

; ── Finish page ────────────────────────────────────────────────
!define MUI_FINISHPAGE_TITLE "Nawfy is ready"
!define MUI_FINISHPAGE_TEXT "Nawfy has been installed.$\r$\n$\r$\nClick Finish to launch Nawfy."
!define MUI_FINISHPAGE_RUN "$INSTDIR\Nawfy.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Launch Nawfy now"

; ── Registry entries ───────────────────────────────────────────
!macro customInstall
  ; Add to Programs and Features (Add/Remove Programs)
  WriteRegStr HKCU "Software\Nawfy" "InstallPath" "$INSTDIR"
  WriteRegStr HKCU "Software\Nawfy" "Version" "${VERSION}"

  ; Add Nawfy to Windows startup (optional — commented out by default)
  ; WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Nawfy" '"$INSTDIR\Nawfy.exe"'

  ; Register app for media key handling in Windows
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\App Paths\Nawfy.exe" "" "$INSTDIR\Nawfy.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\App Paths\Nawfy.exe" "Path" "$INSTDIR"
!macroend

!macro customUnInstall
  ; Clean up registry on uninstall
  DeleteRegKey HKCU "Software\Nawfy"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\App Paths\Nawfy.exe"
!macroend
