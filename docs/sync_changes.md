# Sync Process Changes Implementation Plan

## ✅ COMPLETED FIXES

### 1. Catalog Backup Cleanup Issue - FIXED ✅
**Problem:** Catalog backup cleanup was failing because `getAvailableBackups()` method only looked for drive backup patterns (`backup_*.db`) but not catalog backup patterns (`catalog_backup_*.db`).

**Solution:** Added catalog backup detection to `BackupManager.getAvailableBackups()`:
- Added pattern matching for `/^catalog_backup_(\d+)\.db$/`
- Creates proper `BackupInfo` objects with `type: 'catalog'`
- Catalog cleanup now works correctly after successful sync

**Files Modified:**
- `src/backup-manager.ts` - Added catalog backup pattern detection
- `lib/backup-manager.js` - Compiled version updated

### 2. Old Database Cleanup During Sync - FIXED ✅
**Problem:** During each sync, old databases accumulated because previous databases weren't deleted after creating backups. For example, starting with `driveid_sync6.db` and creating `driveid_sync7.db` would leave `driveid_sync6.db` in place.

**Solution:** Enhanced `createNewScanDatabase()` method to:
1. Check for existing database before creating new one
2. Close current database connection if open  
3. Create backup of current database (if backup manager available)
4. Delete the previous database file
5. Then create the new database

**Files Modified:**
- `src/per-drive-storage.ts` - Updated `createNewScanDatabase()` method
- `lib/per-drive-storage.js` - Compiled version updated

**Expected Behavior Now:**
- When starting sync with `driveid_sync6.db`, system will:
  1. Create backup: `backup_driveid_sync6.db` 
  2. Delete: `driveid_sync6.db`
  3. Create new: `driveid_sync7.db`
  4. After successful sync: cleanup catalog backups

### Testing the Fixes 🧪
To verify these fixes work:

1. **Catalog Backup Cleanup Test:**
   - Start a sync operation
   - Check logs for: `[CATALOG-CLEANUP] Catalog backups found: 1` (not 0)
   - Verify catalog backup files are deleted after successful sync

2. **Old Database Cleanup Test:**
   - Note current database file (e.g., `by57xx9ie9lmgw3ufc2_sync6.db`)
   - Start sync operation  
   - Check logs for: `Found existing database to cleanup` and `Previous database deleted successfully`
   - Verify old database file no longer exists
   - Verify new database file exists (e.g., `by57xx9ie9lmgw3ufc2_sync7.db`)
   - Verify backup was created (e.g., `backup_by57xx9ie9lmgw3ufc2_sync6.db`)

## Current State
- Per-drive database backups already exist in user's backup folder
- Backup folder location: `~/Library/Application Support/archivist/storage/users/{userId}/backups/`
  - Per-drive backups: `backup_{driveId}.db`
  - Catalog backups will be: `catalog_backup_{timestamp}.db`
- No current catalog.db backup system
- ✅ **Database naming scheme already implemented:**
  - Initial database: `driveid_init.db`
  - First sync: `driveid_sync1.db`
  - Subsequent syncs: `driveid_sync(n+1).db`
- Per-drive database schema remains unchanged:
  - `files` table with existing structure (id, name, path, etc.)
  - Performance indexes for parent path and path lookups
  - No FTS table (FTS remains in catalog.db only)

## Implementation Steps

### 1. Catalog Backup System
- Add catalog.db backup function to storage manager
  - Use existing backup folder structure
  - Format: `catalog_backup_{timestamp}.db`
  - Add to existing backup rotation system

### 2. Recovery Functions
- Review existing per-drive database restore functions
- Add proper recovery functions if missing:
  - Restore specific backup for a drive
  - List available backups for a drive
  - Verify backup integrity
  - if multiple backups for one driveid exist, make sure to use the correct one. this will likely be the most recent one, identifiable by timestamp. however it might make a more robust system to find the backup that matches the per-drive database that will be overwritten by the sync.

### 3. UI Changes Required
No UI changes needed for sync modal - existing UI already handles drive info display.

Error Recovery UI:
- Add error states for backup failures
- Show recovery options if available
- Add info about which database version was restored in case of recovery

### 4. Core Logic Changes

#### Phase 1: Pre-Sync
1. Get current sync number for drive
   - Check for `_init.db` or highest `_sync{n}.db`
   - Determine next database name
2. Create new per-drive database with proper name
3. Get drive info and file count
4. Show preview in modal (UI already handles this)

#### Phase 2: Sync Process
1. Create catalog.db backup
2. Verify backup exists for current database
   - Example: if current is `drive_sync2.db`, verify backup exists before proceeding
   - Create backup if missing
   - delete old database file once backup is confirmed
3. Begin file scan to new database (will be `_sync1` if current is `_init`, or `_sync(n+1)` if current is `_sync(n)`)
   - Create new database with existing schema (files table, indexes)
   - Add drive info to new per-drive database (name, capacity, etc)
   - Build file index in new per-drive database
   - Complete all per-drive database operations
4. Once per-drive database is complete, update catalog.db:
   - Delete old drive's entries from files_fts table
   - Add sync drive info to catalog.db
   - Add new file entries to files_fts table
5. Create backup of new per-drive database
6. Delete temporary catalog.db backup
7. Show success message

#### Phase 3: Recovery Scenarios
- Define recovery steps for:
  - User cancellation
  - Scan failure
  - App crash
  - Backup failure
  - Database corruption

### 5. Testing Requirements
1. Database Naming:
   - Test correct database name generation
   - Test sync number incrementation
   - Test transition from _init to _sync1
   - Test incremental sync numbering

2. Backup System:
   - Test catalog.db backup creation
   - Test backup rotation
   - Test backup integrity
   - Test correct backup matching for database versions

3. Recovery System:
   - Test per-drive database restore with correct versions
   - Test handling of corrupted backups
   - Test crash recovery with different database versions
   - Verify proper version selection during recovery

4. Error States:
   - Test cancellation at different stages
   - Test app crash recovery
   - Test backup verification failures
   - Test database corruption scenarios

### 6. Future Considerations
- Add catalog.db restore functionality
- Improve backup rotation policies
- Add backup compression
- Add backup verification steps

## Implementation Order
1. Add catalog backup functionality
2. Review/implement recovery functions
3. Update sync UI
4. Modify core sync logic
5. Add new tests
6. Update documentation

## Files to Modify
- `storage-manager.ts`
- `backup-manager.ts`
- `App.tsx` (sync modal)
- Related test files

# Extreme failure scenarios

if creating catalog.db backup fails, we should proceed with the sync. but if the user cancels, we will need to call a more complicated process to restore catalog.db.
we will need to first restore the backed-up per drive database to the user's active storage folder. 
then we should delete catalog.db entirely and recreate it using the per drive databases. get drive info from each of them to recreate the drive-info table in catalog.db
and then rebuild the files_fts search index by going through each of the per drive databases
or
perhaps we would be better off to have more regular backups of catalog.db. it doesn't change that often, probably
could backup catalog.db each time a drive is added or synced successfully
just keep one or two backups incase something goes wrong

because my bigger concern is what if the app crashes mid-sync? catalog.db could be in a real state.
it would be handy to just roll back to the most recent complete state if the app crashes
how can we know the app has crashed?
can we check for catalog.db integrity?
i'm confused