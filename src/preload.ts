import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Folder operations
  scanFolder: (folderPath: string) => ipcRenderer.invoke('scan-folder', folderPath),
  getStoredMetadata: (folderPath: string) => ipcRenderer.invoke('get-stored-metadata', folderPath),
  
  // Folder picker
  openFolderPicker: (opts?: any) => ipcRenderer.invoke('open-folder-picker', opts),
  
  // Drive operations
  addDrive: (drivePath: string) => ipcRenderer.invoke('add-drive', drivePath),
  startDriveScan: (driveId: string) => ipcRenderer.invoke('start-drive-scan', driveId),
  startSyncScan: (driveId: string) => ipcRenderer.invoke('start-sync-scan', driveId),
  getDrives: () => ipcRenderer.invoke('get-drives'),
  getAllDrives: () => ipcRenderer.invoke('get-all-drives'),
  getDriveFiles: (driveId: string) => ipcRenderer.invoke('get-drive-files', driveId),
  listRoot: (driveId: string) => ipcRenderer.invoke('list-root', driveId),
  listChildren: (driveId: string, parentPath: string, limit?: number, offset?: number) => ipcRenderer.invoke('list-children', driveId, parentPath, limit, offset),
  listChildrenBatch: (driveId: string, parentPaths: string[]) => ipcRenderer.invoke('list-children-batch', driveId, parentPaths),
  getDriveFileCount: (driveId: string) => ipcRenderer.invoke('get-drive-file-count', driveId),
  deleteDrive: (driveId: string) => ipcRenderer.invoke('delete-drive', driveId),
  // New sync functionality
  syncDrive: (driveId: string, folderPath: string) => ipcRenderer.invoke('sync-drive', driveId, folderPath),
  createBackupBeforeSync: (driveId: string) => ipcRenderer.invoke('create-backup-before-sync', driveId),
  checkBackupStatus: (driveId: string) => ipcRenderer.invoke('check-backup-status', driveId),
  // Recovery functionality removed for MVP
  hydrateFolder: (driveId: string, folderPath: string) => ipcRenderer.invoke('hydrate-folder', driveId, folderPath),
  
  // Drive status operations
  // (Removed) drive status / identification operations
  
  // Search operations
  searchFiles: (query: string) => ipcRenderer.invoke('search-files', query),
  searchFilesPaged: (query: string, offset: number, limit: number, hideSystemFiles?: boolean) => {
    console.log(`[Preload] searchFilesPaged called with:`, { query, offset, limit, hideSystemFiles });
    return ipcRenderer.invoke('search-files-paged', query, offset, limit, hideSystemFiles);
  },
  getFileDetailsForNavigation: (fileName: string, driveId: string, filePath: string) => ipcRenderer.invoke('get-file-details-for-navigation', fileName, driveId, filePath),
  buildSearchIndex: () => ipcRenderer.invoke('build-search-index'),
  populateSearchIndex: () => ipcRenderer.invoke('populate-search-index'),
  getSearchIndexStatus: () => ipcRenderer.invoke('get-search-index-status'),
  checkSearchIndexHealth: () => ipcRenderer.invoke('check-search-index-health'),
  testSearch: (query: string) => ipcRenderer.invoke('test-search', query),
  
  // File deletion functions
  softDeleteFile: (fileId: string, reason: string) => ipcRenderer.invoke('soft-delete-file', fileId, reason),
  softDeleteFilesByPath: (driveId: string, filePath: string, reason: string) => ipcRenderer.invoke('soft-delete-files-by-path', driveId, filePath, reason),
  // Recovery functionality removed for MVP
  getDeletedFiles: (driveId?: string) => ipcRenderer.invoke('get-deleted-files', driveId),
  permanentlyDeleteFile: (fileId: string) => ipcRenderer.invoke('permanently-delete-file', fileId),
  cleanupSoftDeletedRecords: () => ipcRenderer.invoke('cleanup-soft-deleted-records'),
  cancelScan: () => ipcRenderer.invoke('cancel-scan'),
  getActiveScanInfo: () => ipcRenderer.invoke('get-active-scan-info'),
  checkScanConflicts: (driveId: string) => ipcRenderer.invoke('check-scan-conflicts', driveId),
  getScanStatus: (driveId?: string) => ipcRenderer.invoke('get-scan-status', driveId),
  getScanQueue: () => ipcRenderer.invoke('get-scan-queue'),
  clearScanQueue: () => ipcRenderer.invoke('clear-scan-queue'),
  getStreamingStatus: (driveId?: string) => ipcRenderer.invoke('get-streaming-status', driveId),
  getMemoryUsage: () => ipcRenderer.invoke('get-memory-usage'),
  forceGarbageCollection: () => ipcRenderer.invoke('force-garbage-collection'),
  getStreamingConfig: () => ipcRenderer.invoke('get-streaming-config'),
  debugScanMethods: () => ipcRenderer.invoke('debug-scan-methods'),
  startWatchingDrive: (drivePath: string, driveId: string) => ipcRenderer.invoke('start-watching-drive', drivePath, driveId),
  stopWatchingDrive: (driveId: string) => ipcRenderer.invoke('stop-watching-drive', driveId),
  getWatcherStatus: (driveId: string) => ipcRenderer.invoke('get-watcher-status', driveId),
  
  // Admin operations (Service Role Key Required)
  adminGetUser: (userId: string) => ipcRenderer.invoke('admin-get-user', userId),
  adminUpdateUser: (userId: string, updates: any) => ipcRenderer.invoke('admin-update-user', userId, updates),
  adminDeleteUser: (userId: string) => ipcRenderer.invoke('admin-delete-user', userId),
  adminGetUserData: (userId: string) => ipcRenderer.invoke('admin-get-user-data', userId),
  adminDeleteUserData: (userId: string) => ipcRenderer.invoke('admin-delete-user-data', userId),
  adminMigrateUserData: (fromUserId: string, toUserId: string) => ipcRenderer.invoke('admin-migrate-user-data', fromUserId, toUserId),
  adminGetSystemStats: () => ipcRenderer.invoke('admin-get-system-stats'),
  adminCleanupOrphanedData: () => ipcRenderer.invoke('admin-cleanup-orphaned-data'),
  adminBackupUserData: (userId: string) => ipcRenderer.invoke('admin-backup-user-data', userId),
  
  // Cache operations
  clearSizeCache: () => ipcRenderer.invoke('clear-size-cache'),
  clearMemoryCache: () => ipcRenderer.invoke('clear-memory-cache'),
  
  // Progress reporting
  onScanProgress: (callback: (progress: any) => void) => {
    ipcRenderer.on('scan-progress', (event, progress) => callback(progress));
  },
  removeScanProgressListener: () => {
    ipcRenderer.removeAllListeners('scan-progress');
  },
  
  // Utility functions
  formatBytes: (bytes: number) => ipcRenderer.invoke('format-bytes', bytes),
  formatDate: (dateString: string) => ipcRenderer.invoke('format-date', dateString),

  // Auth functions
  authSignIn: (email: string, password: string) => ipcRenderer.invoke('auth-signin', email, password),
  authSignUp: (email: string, password: string, name?: string) => ipcRenderer.invoke('auth-signup', email, password, name),
  authSignOut: () => ipcRenderer.invoke('auth-signout'),
  authGetSession: () => ipcRenderer.invoke('auth-get-session'),
  authGetUser: () => ipcRenderer.invoke('auth-get-user'),
  authUpdateUser: (updates: any) => ipcRenderer.invoke('auth-update-user', updates),
  authResetPassword: (email: string) => ipcRenderer.invoke('auth-reset-password', email),
  authUpdatePassword: (password: string) => ipcRenderer.invoke('auth-update-password', password),
  authVerifyOtp: (params: any) => ipcRenderer.invoke('auth-verify-otp', params),
  checkTrialStatus: () => ipcRenderer.invoke('check-trial-status'),
  authOnAuthStateChange: (callback: (event: string, session: any) => void) => {
    ipcRenderer.on('auth-state-change', (event, authEvent, session) => callback(authEvent, session));
  },
  removeAuthStateChangeListener: () => {
    ipcRenderer.removeAllListeners('auth-state-change');
  },
  switchStorageUser: (userId: string | null) => ipcRenderer.invoke('switch-storage-user', userId),
  
  // Storage readiness functions
  checkStorageReady: () => ipcRenderer.invoke('check-storage-ready'),
  getStorageStatus: () => ipcRenderer.invoke('get-storage-status'),
  notifyStorageReady: () => ipcRenderer.invoke('notify-storage-ready'),
  recoverStorageError: (operation: string) => ipcRenderer.invoke('recover-storage-error', operation),
  checkStorageHealth: () => ipcRenderer.invoke('check-storage-health'),
  
  // Storage event listeners
  onStorageReady: (callback: (data: any) => void) => {
    ipcRenderer.on('storage-ready', (event, data) => callback(data));
  },
  onStorageError: (callback: (data: any) => void) => {
    ipcRenderer.on('storage-error', (event, data) => callback(data));
  },
  onStorageRecoveryAttempt: (callback: (data: any) => void) => {
    ipcRenderer.on('storage-recovery-attempt', (event, data) => callback(data));
  },
  
  // Drive restoration event listener
  onDriveRestored: (callback: (data: any) => void) => {
    ipcRenderer.on('drive-restored', (event, data) => callback(data));
  },
  removeDriveRestoredListener: () => {
    ipcRenderer.removeAllListeners('drive-restored');
  },
  
  // Backup and recovery functions
  getAvailableBackups: () => ipcRenderer.invoke('get-available-backups'),
  getGroupedBackups: () => ipcRenderer.invoke('get-grouped-backups'),
  restoreDriveFromBackup: (backupId: string, targetDriveId: string) => ipcRenderer.invoke('restore-drive-from-backup', backupId, targetDriveId),
  restoreCatalogFromBackup: (backupId: string) => ipcRenderer.invoke('restore-catalog-from-backup', backupId),
  getBackupStorageUsage: () => ipcRenderer.invoke('get-backup-storage-usage'),
  cleanupOldBackups: (maxAgeDays?: number) => ipcRenderer.invoke('cleanup-old-backups', maxAgeDays),
  validateBackup: (backupId: string) => ipcRenderer.invoke('validate-backup', backupId),
  createBackup: (driveId: string) => ipcRenderer.invoke('create-backup', driveId),
  deleteBackup: (backupId: string) => ipcRenderer.invoke('delete-backup', backupId),
  getBackupFileTree: (backupId: string) => ipcRenderer.invoke('get-backup-file-tree', backupId),
  listBackupRoot: (backupId: string) => ipcRenderer.invoke('list-backup-root', backupId),
  listBackupChildren: (backupId: string, parentPath: string, limit?: number, offset?: number) => ipcRenderer.invoke('list-backup-children', backupId, parentPath, limit, offset),
  
  // Auto-updater functions
  updaterCheckForUpdates: () => ipcRenderer.invoke('updater-check-for-updates'),
  updaterDownloadUpdate: () => ipcRenderer.invoke('updater-download-update'),
  updaterInstallUpdate: () => ipcRenderer.invoke('updater-install-update'),
}); 