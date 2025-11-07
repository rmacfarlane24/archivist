# User Storage Isolation Implementation

## Overview

This document describes the implementation of user-specific storage isolation in the Archivist app, which ensures that multiple users on the same device have completely separate storage spaces.

## Problem Solved

**Before**: All users on the same device shared the same storage folder (`~/Library/Application Support/Archivist/storage/`), creating a major security vulnerability where:
- User A could see User B's drives and files
- User A could modify/delete User B's data
- No true multi-user support

**After**: Each user gets their own isolated storage directory, ensuring complete data separation.

## Implementation Details

### 1. Storage Directory Structure

```
~/Library/Application Support/Archivist/
├── storage/
│   ├── users/
│   │   ├── user1@email.com/
│   │   │   ├── catalog.db
│   │   │   └── drive_XXX.db
│   │   └── user2@email.com/
│   │       ├── catalog.db
│   │       └── drive_XXX.db
│   └── (legacy files for backward compatibility)
```

### 2. Code Changes

#### PerDriveStorage Class (`src/per-drive-storage.ts`)
- Added `userId` property to track current user
- Added `setUserId()` method to change users
- Added `getUserStorageDir()` method for user-specific paths
- Added `reinitializeForUser()` method for user switching
- Updated `initialize()` to use user-specific directories

#### StorageManager Interface (`src/storage-manager.ts`)
- Added `reinitializeForUser(userId: string | null)` method

#### Main Process (`src/main.ts`)
- Added `switch-storage-user` IPC handler
- Updated storage initialization to support user switching

#### Preload Script (`src/preload.ts`)
- Added `switchStorageUser()` method to electronAPI

#### Type Definitions (`app/src/types/electron.d.ts`)
- Added `switchStorageUser` type definition

#### AuthContext (`app/src/contexts/AuthContext.tsx`)
- Automatically switches storage when users sign in/out
- Calls `switchStorageUser()` on auth state changes

### 3. User Switching Flow

1. **User Signs In**:
   - AuthContext detects authentication
   - Calls `window.electronAPI.switchStorageUser(userId)`
   - Main process calls `storageManager.reinitializeForUser(userId)`
   - Storage switches to user-specific directory
   - User sees only their own drives and files

2. **User Signs Out**:
   - AuthContext detects sign out
   - Calls `window.electronAPI.switchStorageUser(null)`
   - Storage switches to anonymous/default directory
   - User data is completely isolated

3. **Multiple Users on Same Device**:
   - Each user gets their own `catalog.db` and drive databases
   - No data leakage between users
   - Complete isolation maintained

## Security Benefits

✅ **Complete Data Isolation**: Users cannot access each other's data
✅ **No Cross-User Contamination**: Each user's drives and files are separate
✅ **Secure Multi-User Support**: Multiple users can safely share the same device
✅ **Backward Compatibility**: Existing single-user setups continue to work

## Testing

Run the test script to verify the implementation:

```bash
node test-user-storage.js
```

This will:
- Check storage directory structure
- Verify user isolation
- Test storage path generation
- Confirm no data leakage

## Usage

The system works automatically:
- Users don't need to do anything special
- Storage isolation happens transparently
- Each user sees only their own data
- No configuration required

## Migration

**Existing Users**: 
- Will continue to work as before
- Data remains in the legacy storage location
- Can optionally migrate to user-specific storage

**New Users**:
- Automatically get user-specific storage
- No migration needed

## Future Enhancements

- **Data Migration Tool**: Help users move from legacy to user-specific storage
- **Storage Cleanup**: Remove orphaned user directories
- **Storage Quotas**: Limit storage per user
- **Backup/Restore**: User-specific backup management
