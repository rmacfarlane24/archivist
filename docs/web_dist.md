# Web Distribution Setup Guide

This document contains all the instructions for setting up web-based distribution for Archivist, avoiding the need for code signing certificates.

## Overview

Web distribution allows you to distribute your Electron app directly to users without paying for code signing certificates. Users download unsigned packages and can bypass security warnings manually.

## Benefits

✅ **No signing certificates needed** - Save $99-400/year  
✅ **Automatic updates still work** - electron-updater functions normally  
✅ **Direct GitHub releases integration** - Automated build and release process  
✅ **Users get latest version automatically** - Via GitHub API  
✅ **No App Store fees or approval process** - Direct distribution  
✅ **Perfect choice for indie apps** - Professional auto-updates without certificates  

## Current Configuration

### GitHub Actions Setup
The build workflow (`.github/workflows/build.yml`) is configured to:
- Build unsigned packages for all platforms
- Skip code signing with `CSC_IDENTITY_AUTO_DISCOVERY: false`
- Create GitHub releases automatically when you push version tags

### Download Page
The `download.html` file provides:
- Auto-detection of latest releases via GitHub API
- Platform-specific download links
- Security warnings and installation instructions for each platform
- Professional-looking download interface

## Distribution Flow

1. **Create release**: `./release.sh patch`
2. **Push tags**: `git push origin main && git push origin v1.0.1`
3. **GitHub Actions builds** all platforms automatically
4. **Users download** from your website or GitHub releases
5. **Auto-updates work** once installed (via electron-updater)

## Installation Instructions for Users

### macOS
1. Download the .dmg file
2. Open the .dmg and drag Archivist to Applications
3. Right-click Archivist in Applications → "Open"
4. Click "Open" in the security dialog

### Windows
1. Download the .exe installer
2. Run the installer (click "More info" → "Run anyway" if prompted)
3. Follow the installation wizard

### Linux
1. Download the .AppImage file
2. Make it executable: `chmod +x Archivist-*.AppImage`
3. Run: `./Archivist-*.AppImage`

## Security Warnings Users Will See

### macOS
- **Gatekeeper warning**: "Cannot be opened because it is from an unidentified developer"
- **Solution**: Right-click → Open (bypasses Gatekeeper)

### Windows
- **SmartScreen warning**: "Windows protected your PC"
- **Solution**: Click "More info" → "Run anyway"

### Linux
- **No warnings** - Linux users expect to manage executable permissions

## Hosting the Download Page

### Option 1: GitHub Pages (Free)
1. Enable GitHub Pages in repository Settings
2. Select source: Deploy from a branch → `main` → `/ (root)`
3. Your download page will be at: `https://rmacfarlane24.github.io/archivist/download.html`

### Option 2: Custom Domain
1. Host `download.html` on your website
2. Point users to your custom download URL
3. The GitHub API integration will still work

### Option 3: Direct to GitHub Releases
- Simply link users to: `https://github.com/rmacfarlane24/archivist/releases/latest`
- No custom page needed, but less professional

## Testing the Setup

### Test Packaging (Unsigned)
```bash
npm run package
```
This creates unsigned builds in the `dist/` directory.

### Test Release Process
```bash
# Test the release script
./release.sh --help

# Create a test release (don't push yet)
./release.sh patch
git log --oneline -2  # Review changes
```

### Test Auto-Update Integration
The auto-updater is already integrated and will work with unsigned builds:
- Users get update notifications
- Downloads happen in background
- Installation requires user confirmation

## Upgrading to Signed Distribution Later

If you want to upgrade to signed distribution later:

### Add Code Signing Certificates
1. **macOS**: Apple Developer Program ($99/year)
2. **Windows**: SSL.com, DigiCert, or Sectigo (~$200-400/year)

### Update GitHub Secrets
Add these to repository Settings → Secrets:
```
CSC_LINK=<base64-encoded-certificate>
CSC_KEY_PASSWORD=<certificate-password>
APPLE_ID=<your-apple-id-email>           # macOS only
APPLE_APP_SPECIFIC_PASSWORD=<app-password>  # macOS only
```

### Update Build Configuration
Remove the `CSC_IDENTITY_AUTO_DISCOVERY: false` line from `.github/workflows/build.yml`

## Alternative Distribution Methods

### Microsoft Store (Windows)
- $19 one-time developer fee
- Microsoft handles signing
- Trusted distribution
- Revenue sharing required

### Homebrew (macOS)
- Create Homebrew Cask formula
- Users install via: `brew install --cask archivist`
- Community-trusted distribution
- Free but requires maintenance

### Package Repositories (Linux)
- Submit to Ubuntu/Debian repositories
- Create RPM packages for Fedora/CentOS
- AUR (Arch User Repository) for Arch Linux
- Free but requires packaging knowledge

## Troubleshooting

### Users Can't Install on macOS
**Problem**: "App is damaged and can't be opened"
**Solution**: User needs to run: `xattr -cr /Applications/Archivist.app`

### Users Can't Install on Windows
**Problem**: Windows Defender blocks installation
**Solution**: User needs to disable real-time protection temporarily

### Auto-Updates Not Working
**Problem**: Updates fail to download/install
**Check**: 
- GitHub releases are public
- App has internet connection
- User has write permissions to app directory

## Files Created/Modified

### New Files
- `download.html` - Download page template
- `web_dist.md` - This documentation file
- `.github/workflows/build.yml` - CI/CD pipeline
- `.github/workflows/test.yml` - Development testing
- `release.sh` - Version management script
- `/build/` directory with placeholder icons

### Modified Files
- `src/main.ts` - Added auto-updater integration
- `src/preload.ts` - Added updater IPC handlers
- `app/src/types/electron.d.ts` - Added updater type definitions

## Next Steps

1. **Replace placeholder icons** in `/build` directory with real app icons
2. **Test packaging**: `npm run package`
3. **Host download page** on GitHub Pages or your website
4. **Create first release** when ready for users
5. **Monitor user feedback** for installation issues

Remember: Web distribution is perfect for getting started quickly and testing user adoption before investing in code signing certificates.