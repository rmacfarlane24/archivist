// Type definitions for Electron API exposed through preload script
declare global {
  interface Window {
    electronAPI: {
      // Folder operations
      scanFolder: (folderPath: string) => Promise<FileMetadata[]>;
      getStoredMetadata: (folderPath: string) => Promise<FileMetadata[]>;
      
      // Folder picker
      openFolderPicker: (opts?: {
        title?: string;
        message?: string; // macOS only
        buttonLabel?: string;
        prePrompt?: {
          title?: string;
          message?: string;
          detail?: string;
        };
      }) => Promise<string | null>;
      
      // Drive operations
      addDrive: (drivePath: string) => Promise<DriveInfo>;
      startDriveScan: (driveId: string) => Promise<{ success: boolean; filesFound?: number; error?: string; message?: string }>;
      startSyncScan: (driveId: string) => Promise<{ success: boolean; filesFound?: number; error?: string; message?: string }>;
      getDrives: () => Promise<DriveInfo[]>;
      getAllDrives: () => Promise<DriveInfo[]>;
      getDriveFiles: (driveId: string) => Promise<FileMetadata[]>;
      listRoot: (driveId: string) => Promise<FileMetadata[]>;
      listChildren: (driveId: string, parentPath: string, limit?: number, offset?: number) => Promise<{ files: FileMetadata[]; hasMore: boolean }>;
      getDriveFileCount: (driveId: string) => Promise<{ total: number; directories: number; files: number }>;
      deleteDrive: (driveId: string) => Promise<{ success: boolean }>;
        // New sync functionality
      syncDrive: (driveId: string, folderPath: string) => Promise<{ success: boolean; drive?: DriveInfo; error?: string; conflicts?: string[] }>;
      restoreDriveFromBackup: (driveId: string) => Promise<{ success: boolean; message?: string; error?: string }>;
      createBackupBeforeSync: (driveId: string) => Promise<{ success: boolean; duration?: number; message?: string; error?: string }>;
      checkBackupStatus: (driveId: string) => Promise<{ 
        success: boolean; 
        driveId: string; 
        drive?: DriveInfo; 
        backupExists: boolean; 
        backupPath: string; 
        ftsBackupPath: string; 
        error?: string 
      }>;
      // Recovery functionality removed for MVP
      hydrateFolder: (driveId: string, folderPath: string) => Promise<{ success: boolean; added?: number; error?: string }>;
      
      // Drive status operations
      // (Removed) drive status / identification operations
      
      // Search operations
      searchFiles: (query: string) => Promise<SearchResult[]>;
      searchFilesPaged: (query: string, offset: number, limit: number, hideSystemFiles?: boolean) => Promise<{ rows: SearchResult[]; total: number; mode: 'MATCH' | 'LIKE' | 'BLOCKED'; truncatedTotal?: boolean }>;
      getFileDetailsForNavigation: (fileName: string, driveId: string, filePath: string) => Promise<SearchResult | null>;
      buildSearchIndex: () => Promise<void>;
      populateSearchIndex: () => Promise<void>;
      getSearchIndexStatus: () => Promise<{ isBuilt: boolean; totalIndexed: number; totalFiles?: number; inSync?: boolean }>;
      checkSearchIndexHealth: () => Promise<{ 
        healthy: boolean; 
        totalFiles: number; 
        totalIndexed: number; 
        activeDrives: number;
        issues: string[];
      }>;
      
      // File deletion functions (automatic only - happens during drive rescans)
      softDeleteFile: (fileId: string, reason: 'file_removed' | 'drive_deleted' | 'system') => Promise<{ success: boolean }>;
      softDeleteFilesByPath: (driveId: string, filePath: string, reason: 'file_removed' | 'drive_deleted' | 'system') => Promise<{ success: boolean; deletedCount: number }>;
      // Recovery functionality removed for MVP
      getDeletedFiles: (driveId?: string) => Promise<Array<{
        id: string;
        name: string;
        path: string;
        driveId: string;
        deletedAt: string;
        deletionReason: string;
        size: number;
        isDirectory: boolean;
      }>>;
      permanentlyDeleteFile: (fileId: string) => Promise<{ success: boolean }>;
      cleanupSoftDeletedRecords: () => Promise<{ success: boolean; deletedFiles: number; deletedDrives: number; freedSpace: number }>;
      cancelScan: () => Promise<{ success: boolean; message?: string; error?: string }>;
      getActiveScanInfo: () => Promise<{ 
        success: boolean; 
        hasActiveScan: boolean; 
        currentDriveId: string | null; 
        isCancelled: boolean; 
        scanManagerStatus: any 
      }>;
      checkScanConflicts: (driveId: string) => Promise<{ 
        success: boolean; 
        hasConflicts: boolean; 
        conflicts: string[]; 
        canStart: boolean; 
        message: string; 
        queueStatus: any 
      }>;
      getScanStatus: (driveId?: string) => Promise<{ 
        success: boolean; 
        driveId?: string; 
        scanState?: any; 
        isLocked?: boolean; 
        isBeingScanned?: boolean; 
        activeScans?: any[]; 
        queueStatus?: any; 
        totalActive?: number; 
        totalQueued?: number; 
        error?: string 
      }>;
      
      // Cache operations
      clearSizeCache: () => Promise<{ success: boolean }>;
      clearMemoryCache: () => Promise<{ success: boolean; error?: string }>;
      
      // Progress reporting
      onScanProgress: (callback: (progress: ScanProgress) => void) => void;
      removeScanProgressListener: () => void;
      
      // Utility functions
      formatBytes: (bytes: number) => Promise<string>;
      formatDate: (dateString: string) => Promise<string>;

      // Auth functions
      authSignIn: (email: string, password: string) => Promise<{ data: any; error: any }>;
      authSignUp: (email: string, password: string, name?: string) => Promise<{ data: any; error: any }>;
      authSignOut: () => Promise<{ error: any }>;
      authGetSession: () => Promise<{ session: any; error: any }>;
      authGetUser: () => Promise<{ user: any; error: any }>;
      authResetPassword: (email: string) => Promise<{ error: any }>;
      checkTrialStatus: () => Promise<{ profile: any }>;
      switchStorageUser: (userId: string | null) => Promise<{ 
        success: boolean; 
        phase?: string; 
        duration?: number; 
        userId?: string; 
        driveCount?: number; 
        driveLoadError?: string 
      }>;
      
      // Storage readiness functions
      checkStorageReady: () => Promise<{ 
        ready: boolean; 
        userId: string | null; 
        timestamp: string; 
        error?: string 
      }>;
      getStorageStatus: () => Promise<{ 
        initialized: boolean; 
        userId: string | null; 
        storagePath: string | null; 
        driveCount: number; 
        drives?: Array<{ id: string; name: string }>; 
        error?: string 
      }>;
      notifyStorageReady: () => Promise<{ 
        ready: boolean; 
        userId: string | null; 
        catalogDbExists: boolean; 
        driveCount: number; 
        timestamp: string; 
        error?: string 
      }>;
      recoverStorageError: (operation: string) => Promise<{ 
        success: boolean; 
        message?: string; 
        error?: string; 
        timestamp: string 
      }>;
      checkStorageHealth: () => Promise<{ 
        healthy: boolean; 
        userId: string | null; 
        storagePath: string | null; 
        catalogDbExists: boolean; 
        driveCount: number; 
        timestamp: string; 
        error?: string 
      }>;
      
      // Storage event listeners
      onStorageReady: (callback: (data: any) => void) => void;
      onStorageError: (callback: (data: any) => void) => void;
      onStorageRecoveryAttempt: (callback: (data: any) => void) => void;
      
      // Drive restoration event listeners
      onDriveRestored: (callback: (data: any) => void) => void;
      removeDriveRestoredListener: () => void;
      
      // Backup and recovery functions
      getAvailableBackups: () => Promise<{ success: boolean; backups: Array<{
        id: string;
        type: 'drive' | 'catalog';
        driveId?: string;
        driveName?: string;
        timestamp: number;
        size: number;
        path: string;
      }>; error?: string }>;
      getGroupedBackups: () => Promise<{ success: boolean; groupedBackups: Array<{
        driveId: string;
        driveName: string;
        backups: Array<any>;
        latestBackup: any;
        totalBackups: number;
      }>; error?: string }>;
      restoreDriveFromBackup: (backupId: string, targetDriveId: string) => Promise<{ success: boolean; message?: string; error?: string }>;
      restoreCatalogFromBackup: (backupId: string) => Promise<{ success: boolean; message?: string; error?: string }>;
      getBackupStorageUsage: () => Promise<{ success: boolean; totalSize: number; fileCount: number; error?: string }>;
      cleanupOldBackups: (maxAgeDays?: number) => Promise<{ success: boolean; deletedCount: number; error?: string }>;
      validateBackup: (backupId: string) => Promise<{ success: boolean; isValid: boolean; error?: string }>;
      createBackup: (driveId: string) => Promise<{ success: boolean; message?: string; error?: string }>;
      deleteBackup: (backupId: string) => Promise<{ success: boolean; message?: string; error?: string }>;
      getBackupFileTree: (backupId: string) => Promise<{ success: boolean; fileTree?: any[]; error?: string }>;
      listBackupRoot: (backupId: string) => Promise<FileMetadata[]>;
      listBackupChildren: (backupId: string, parentPath: string, limit?: number, offset?: number) => Promise<{ files: FileMetadata[]; hasMore: boolean }>;
      
      getStreamingConfig: () => Promise<{ success: boolean; config: any }>;
      debugScanMethods: () => Promise<{ success: boolean; message: string; availableMethods: string[]; error?: string }>;
      
      // Auto-updater functions
      updaterCheckForUpdates: () => Promise<{ available: boolean; version?: string; message?: string; error?: string }>;
      updaterDownloadUpdate: () => Promise<{ success: boolean; message?: string; error?: string }>;
      updaterInstallUpdate: () => Promise<{ success: boolean; message?: string; error?: string }>;
    };
  }
}

// Allow Electron's <webview> tag in TSX
// eslint-disable-next-line @typescript-eslint/no-namespace
declare global {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string;
        allowpopups?: boolean;
        disablewebsecurity?: boolean;
        partition?: string;
        preload?: string;
      };
    }
  }
}

// Type definitions for scan progress
export interface ScanProgress {
  type: 'start' | 'progress' | 'complete' | 'batch' | 'streaming-progress';
  driveId?: string;
  files?: FileMetadata[];
  processed?: number;
  total?: number; // Add total count for accurate progress calculation
  errors?: number;
  message: string;
  rate?: string;
  memoryUsage?: any;
  errorMessages?: string[];
}

// Type definitions for file metadata
export interface FileMetadata {
  id: string;
  name: string;
  path: string;
  parentPath: string | null;
  size: number;
  created: string;
  modified: string;
  isDirectory: boolean;
  folderPath: string;
  driveId: string;
  depth: number;
}

// Type definitions for drive information
export interface DriveInfo {
  id: string;
  name: string;
  path: string;
  totalCapacity: number;
  usedSpace: number;
  freeSpace: number;
  serialNumber: string;
  formatType: string;
  addedDate: string;
  lastUpdated?: string;
  deleted?: boolean;
  deletedAt?: string;
  fileCount?: number;
}

// Type definitions for search results
export interface SearchResult {
  fileId: string;
  driveId: string;
  driveName: string;
  fileName: string;
  fullPath: string;
  isDirectory: boolean;
  size?: number;
  modified?: string;
}

// Recovery functionality removed for MVP

export {};