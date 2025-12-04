#!/bin/bash

# Version management helper script for Archivist
# This script helps manage version numbers and create releases

set -e

current_version=$(node -p "require('./package.json').version")
echo "📋 Current version: $current_version"

if [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
    echo ""
    echo "Usage: ./release.sh [patch|minor|major]"
    echo ""
    echo "Commands:"
    echo "  patch   - Increment patch version (1.0.0 -> 1.0.1)"
    echo "  minor   - Increment minor version (1.0.0 -> 1.1.0)"
    echo "  major   - Increment major version (1.0.0 -> 2.0.0)"
    echo ""
    echo "This script will:"
    echo "  1. Update version in package.json"
    echo "  2. Create a git tag"
    echo "  3. Push to trigger GitHub Actions build"
    echo ""
    exit 0
fi

if [ -z "$1" ]; then
    echo "❌ Error: Please specify version increment type"
    echo "Usage: ./release.sh [patch|minor|major]"
    echo "Run ./release.sh --help for more information"
    exit 1
fi

version_type="$1"

if [ "$version_type" != "patch" ] && [ "$version_type" != "minor" ] && [ "$version_type" != "major" ]; then
    echo "❌ Error: Invalid version type '$version_type'"
    echo "Must be one of: patch, minor, major"
    exit 1
fi

echo "🔍 Checking git status..."
if ! git diff-index --quiet HEAD --; then
    echo "❌ Error: You have uncommitted changes"
    echo "Please commit or stash your changes before creating a release"
    exit 1
fi

echo "🏗️  Running tests and build..."
if ! npm run build; then
    echo "❌ Error: Build failed"
    exit 1
fi

echo "📝 Updating version..."
new_version=$(npm version $version_type --no-git-tag-version)
echo "✅ Version updated to: $new_version"

echo "💾 Committing version change..."
git add package.json package-lock.json
git commit -m "Release $new_version"

echo "🏷️  Creating git tag..."
git tag -a "$new_version" -m "Release $new_version"

echo "🚀 Ready to push release"
echo ""
echo "📋 Next steps:"
echo "1. Review the changes: git log --oneline -5"
echo "2. Push the release: git push origin main && git push origin $new_version"
echo "3. This will trigger GitHub Actions to build and create a release"
echo ""
echo "⚠️  Note: Make sure you have:"
echo "   - Proper app icons in /build directory"
echo "   - Code signing certificates configured (for production)"
echo "   - GitHub repository settings configured for releases"