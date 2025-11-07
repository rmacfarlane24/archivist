// Storage Manager Interface
// Defines all storage operations for the per-drive database architecture

import type { DriveInfo, FileInfo, SearchResult, ScanProgress } from './types';

export interface StorageManager {
  // Drive operations
  addDrive(drive: DriveInfo): Promise<DriveInfo>;
  removeDrive(driveId: string): Promise<void>;
  // Recovery functionality removed for MVP
  getDriveById(driveId: string): Promise<DriveInfo | null>;
  getAllDrives(): Promise<DriveInfo[]>;
  getActiveDrives(): Promise<DriveInfo[]>;
  updateDriveInfo(driveId: string, updates: Partial<DriveInfo>): Promise<void>;
  
  // File operations
  storeFileTree(driveId: string, files: (FileInfo | Omit<FileInfo, 'id'>)[]): Promise<void>;
  
  // Store file tree progressively in batches (for large scans)
  storeFileTreeProgressive(driveId: string, files: (FileInfo | Omit<FileInfo, 'id'>)[]): Promise<void>;
  getFileDetails(fileId: string, driveId: string): Promise<FileInfo | null>;
  listDriveFiles(driveId: string, path: string): Promise<FileInfo[]>;
  listRoot(driveId: string): Promise<FileInfo[]>;
  listChildren(driveId: string, parentPath: string, limit?: number, offset?: number): Promise<{ files: FileInfo[]; hasMore: boolean }>;
  listChildrenBatch?(driveId: string, parentPaths: string[]): Promise<{ [parentPath: string]: FileInfo[] }>;
  getDriveFileCount(driveId: string): Promise<{ total: number; directories: number; files: number }>;
  updateFileSize(fileId: string, size: number): Promise<void>;
  
  // Search operations
  searchFiles?(query: string, driveFilter?: string[]): Promise<SearchResult[]>;
  searchFilesPaged(query: string, offset: number, limit: number, driveFilter?: string[], hideSystemFiles?: boolean): Promise<{ rows: SearchResult[]; total: number; mode: 'MATCH' | 'LIKE' | 'BLOCKED'; truncatedTotal?: boolean }>;
  getFileDetailsForNavigation(fileName: string, driveId: string, filePath: string): Promise<SearchResult | null>;
  buildSearchIndex(): Promise<void>;
  populateSearchIndex(): Promise<void>;
  getSearchIndexStatus(): Promise<{ isBuilt: boolean; totalIndexed: number; totalFiles?: number; inSync?: boolean }>;
  checkSearchIndexHealth(): Promise<{ healthy: boolean; totalFiles: number; totalIndexed: number; activeDrives: number; issues: string[] }>;
  addDriveToCatalog(driveId: string, driveInfo: any): Promise<boolean>;
  rebuildSearchIndexForDrive(driveId: string): Promise<void>;
  
  // File deletion operations
  softDeleteFile(fileId: string, reason: 'file_removed' | 'drive_deleted' | 'system'): Promise<void>;
  softDeleteFilesByPath(driveId: string, filePath: string, reason: 'file_removed' | 'drive_deleted' | 'system'): Promise<number>;
  // Recovery functionality removed for MVP
  getDeletedFiles(driveId?: string): Promise<Array<{
    id: string;
    name: string;
    path: string;
    driveId: string;
    deletedAt: string;
    deletionReason: string;
    size: number;
    isDirectory: boolean;
  }>>;
  permanentlyDeleteFile(fileId: string): Promise<void>;
  cleanupSoftDeletedRecords(): Promise<{ deletedFiles: number; deletedDrives: number; freedSpace: number }>;
  
  // Recovery functionality removed for MVP
  
  // Cache operations
  clearSizeCache(): Promise<{ success: boolean }>;
  clearMemoryCache(): Promise<{ success: boolean; error?: string }>;
  
  // Progress reporting
  onScanProgress(callback: (progress: ScanProgress) => void): void;
  
  // Utility functions
  formatBytes(bytes: number): Promise<string>;
  formatDate(dateString: string): Promise<string>;
  getStoredMetadata(folderPath: string): Promise<FileInfo[]>;
  
  // Database management
  initialize(): Promise<void>;
  close(): Promise<void>;
  reinitializeForUser(userId: string | null): Promise<void>;
  getDriveDatabasePath(driveId: string): Promise<string>;
  initializeDriveDatabase(driveId: string): Promise<void>;
  getDatabaseSize(): Promise<{
    totalSize: number;
    fileCount: number;
    driveCount: number;
    needsSplitting: boolean;
    recommendation: string;
  }>;
  
  // Sync operations
  backupDrive(driveId: string): Promise<{ success: boolean; error?: string }>;
  restoreDriveFromBackup(driveId: string): Promise<{ success: boolean; error?: string }>;
  clearDriveFiles(driveId: string): Promise<void>;
  clearDriveFTS(driveId: string): Promise<void>;
  cleanupBackupFiles(driveId: string): Promise<{ success: boolean; error?: string }>;
  verifyBackupExists(driveId: string): Promise<boolean>;

  // New approach: Write to new DB first, swap on success
  createNewScanDatabase(driveId: string): Promise<{ success: boolean; error?: string; newDbPath?: string }>;
  storeFileTreeToNewDatabase(driveId: string, files: (FileInfo | Omit<FileInfo, 'id'>)[]): Promise<void>;
  finalizeScanSync(driveId: string, progressCallback?: (progress: { current: number; total: number; phase: string; message: string; etaSeconds?: number }) => void): Promise<{ success: boolean; error?: string }>;
  cleanupNewDatabasesOnFailure(driveId: string): Promise<{ success: boolean; error?: string }>;
}
