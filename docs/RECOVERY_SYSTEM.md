# Recovery System

## Overview
A comprehensive backup and recovery system to protect user data from loss or corruption.

## Menu Integration
- **New menu item:** "Recover" 
- **Position:** Below "Contact" in the main menu
- **Icon:** Simple recovery symbol consistent with app style
- **Route:** `/recover` - dedicated recovery page

## Page Design

### Recovery Page Layout

- **Clean, minimal interface** matching app aesthetic
- **Simple recovery symbol** as page header
- **Clear sections** for different recovery options

### Page Sections

#### 1. Available Backups
- **List of backup files** with timestamps
- **Drive names** and backup dates
- **File sizes** for storage management
- **Restore buttons** for each backup

#### 2. Restore Options
- **Restore individual drive** - from specific backup
- **Restore entire storage** - from catalog backup
- **Rebuild search index** - recreate from per-drive databases

#### 3. Backup Management
- **Storage usage** - total backup space consumed
- **Cleanup options** - remove old backups
- **Backup status** - when last backup was created

## Implementation Structure

### New Files
- `app/src/pages/RecoverPage.tsx` - main recovery page
- `app/src/components/BackupList.tsx` - backup file listing
- `app/src/components/RestoreConfirmation.tsx` - restore confirmation modal
- `src/backup-manager.ts` - backup/restore logic

### Menu Integration
- Add "Recover" option to existing menu system
- Position below "Contact" 
- Route to `/recover` page
- Simple recovery icon

## Backup Strategy

### Backup Triggers
- **Before drive deletion** - backup per-drive database
- **After drive addition** - backup new per-drive database
- **Before catalog changes** - backup catalog.db

### Storage Structure
```
/storage/
  /users/[userId]/
    /backups/
      /drives/
        drive_abc123.db  (backup of deleted drive)
        drive_xyz789.db  (backup of deleted drive)
      catalog_backup.db  (backup of catalog before changes)
```

### No Daily Snapshots
- Only backup when drives change
- Users cannot modify drive data in app
- Drive data is immutable once scanned

## Recovery Features

### Restore Options
1. **Restore deleted drive** - from backup file
2. **Restore entire storage** - from catalog backup
3. **Rebuild search index** - recreate from per-drive databases
4. **Re-add drive** - simple option for users who prefer to rescan

### User Flow
1. **User opens menu** → clicks "Recover"
2. **Recovery page loads** → shows available backups
3. **User selects restore option** → confirmation modal appears
4. **User confirms** → restore process begins with progress
5. **Restore completes** → user returns to main interface

## Technical Implementation

### Backup Manager
- **Automatic backup** before destructive operations
- **Manual backup** for user-initiated operations
- **Backup validation** to ensure integrity
- **Storage cleanup** to manage disk usage

### Recovery Manager
- **Restore validation** before operations
- **Progress tracking** during restore
- **Error handling** for failed restores
- **Rollback capability** if restore fails

## Benefits

### Data Protection
- **Prevents data loss** from corruption or bugs
- **User-controlled recovery** - no automatic decisions
- **Multiple recovery options** - flexible restoration

### User Experience
- **Hidden from main interface** - clean separation
- **Simple to use** - one-click restore
- **Non-destructive** - backups are separate from live data
- **Flexible** - restore individual drives or entire storage

### System Reliability
- **Addresses all data loss scenarios** we've discussed
- **Simple backup strategy** - only backup what changes
- **Minimal storage overhead** - efficient backup management
- **Easy to maintain** - clear backup/recovery logic

## Future Enhancements

### Advanced Features
- **Backup scheduling** - optional automatic backups
- **Backup compression** - reduce storage usage
- **Backup encryption** - secure backup files
- **Cloud backup** - optional cloud storage integration

### Monitoring
- **Backup health checks** - validate backup integrity
- **Storage monitoring** - track backup storage usage
- **Recovery analytics** - track recovery success rates
- **Error reporting** - log backup/recovery issues
