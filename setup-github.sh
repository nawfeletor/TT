#!/usr/bin/env bash
# ============================================================
# Nawfy GitHub Setup Script
# Run this ONCE from inside your nawfy folder
# Usage: bash setup-github.sh YOUR_GITHUB_USERNAME
# ============================================================

set -e

USERNAME="${1:-}"
if [ -z "$USERNAME" ]; then
  echo "Usage: bash setup-github.sh YOUR_GITHUB_USERNAME"
  exit 1
fi

REPO="nawfy"
REPO_URL="https://github.com/$USERNAME/$REPO.git"

echo ""
echo "  Nawfy GitHub Setup"
echo "  Username : $USERNAME"
echo "  Repo     : $REPO_URL"
echo ""

# 1. Patch placeholders
echo "[1/5] Patching website links..."
sed -i "s/GITHUB_USERNAME/$USERNAME/g" docs/index.html
echo "      done"

echo "[2/5] Patching README..."
sed -i "s/YOUR_USERNAME/$USERNAME/g" README.md
echo "      done"

# 3. Git init & first commit
echo "[3/5] Initialising git repository..."
git init
git remote remove origin 2>/dev/null || true
git remote add origin "$REPO_URL"
git add .
git commit -m "feat: initial release - Nawfy v1.0.0"
echo "      done"

# 4. Push
echo "[4/5] Pushing to GitHub..."
git push -u origin main
echo "      done"

# 5. Tag
echo "[5/5] Creating release tag v1.0.0..."
git tag v1.0.0
git push origin v1.0.0
echo "      done"

echo ""
echo "  All done! What happens next:"
echo ""
echo "  GitHub Actions builds the app (~10 min):"
echo "    - Windows Installer (.exe)"
echo "    - Windows Portable (.exe)"
echo "    - Linux AppImage"
echo "    - Linux .deb"
echo "    - A GitHub Release with all 4 files"
echo ""
echo "  Enable GitHub Pages:"
echo "    1. Go to https://github.com/$USERNAME/$REPO/settings/pages"
echo "    2. Source: Deploy from a branch"
echo "    3. Branch: main / folder: /docs"
echo "    4. Save"
echo ""
echo "  Your site: https://$USERNAME.github.io/$REPO"
echo "  Releases:  https://github.com/$USERNAME/$REPO/releases"
echo ""
