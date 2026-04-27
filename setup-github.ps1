# ============================================================
# Nawfy GitHub Setup Script
# Run this ONCE from inside your nawfy folder
# Usage: .\setup-github.ps1 -Username YOUR_GITHUB_USERNAME
# ============================================================

param(
    [Parameter(Mandatory=$true)]
    [string]$Username
)

$ErrorActionPreference = "Stop"
$Repo = "nawfy"
$RepoUrl = "https://github.com/$Username/$Repo.git"

Write-Host ""
Write-Host "  Nawfy GitHub Setup" -ForegroundColor Red
Write-Host "  Username : $Username" -ForegroundColor DarkGray
Write-Host "  Repo     : $RepoUrl" -ForegroundColor DarkGray
Write-Host ""

# 1. Replace placeholders in docs/index.html
Write-Host "[1/5] Patching website links..." -ForegroundColor Cyan
(Get-Content "docs\index.html" -Raw) -replace "GITHUB_USERNAME", $Username | Set-Content "docs\index.html" -NoNewline
Write-Host "      done" -ForegroundColor Green

# 2. Replace placeholders in README.md
Write-Host "[2/5] Patching README..." -ForegroundColor Cyan
(Get-Content "README.md" -Raw) -replace "YOUR_USERNAME", $Username | Set-Content "README.md" -NoNewline
Write-Host "      done" -ForegroundColor Green

# 3. Git init & first commit
Write-Host "[3/5] Initialising git repository..." -ForegroundColor Cyan
git init
git remote remove origin 2>$null
git remote add origin $RepoUrl
git add .
git commit -m "feat: initial release - Nawfy v1.0.0"
Write-Host "      done" -ForegroundColor Green

# 4. Push to GitHub
Write-Host "[4/5] Pushing to GitHub..." -ForegroundColor Cyan
Write-Host "      (A browser window may open for authentication)" -ForegroundColor DarkGray
git push -u origin main
Write-Host "      done" -ForegroundColor Green

# 5. Tag v1.0.0 to trigger the build
Write-Host "[5/5] Creating release tag v1.0.0..." -ForegroundColor Cyan
git tag v1.0.0
git push origin v1.0.0
Write-Host "      done" -ForegroundColor Green

Write-Host ""
Write-Host "  All done! What happens next:" -ForegroundColor Green
Write-Host ""
Write-Host "  GitHub Actions will now build the app (~10 min):" -ForegroundColor White
Write-Host "    - Windows Installer (.exe)"
Write-Host "    - Windows Portable (.exe)"
Write-Host "    - Linux AppImage"
Write-Host "    - Linux .deb"
Write-Host "    - A GitHub Release with all 4 files"
Write-Host ""
Write-Host "  Enable GitHub Pages:" -ForegroundColor White
Write-Host "    1. Go to https://github.com/$Username/$Repo/settings/pages"
Write-Host "    2. Source: Deploy from a branch"
Write-Host "    3. Branch: main / folder: /docs"
Write-Host "    4. Save"
Write-Host ""
Write-Host "  Your site: https://$Username.github.io/$Repo" -ForegroundColor Cyan
Write-Host "  Your release: https://github.com/$Username/$Repo/releases" -ForegroundColor Cyan
Write-Host ""
