// Per-Drive Storage Implementation
// Implements the StorageManager interface using per-drive databases

import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs-extra';
import { StorageManager } from './storage-manager';
import { BackupManager } from './backup-manager';
import type { DriveInfo, FileInfo, SearchResult, ScanProgress } from './types';

// ===== SYNC FAILURE RECOVERY TYPES =====

/**
 * Recovery options for sync failure scenarios
 */
interface RecoveryOptions {
  deleteNewDatabase?: boolean;      // Delete the new sync database being created
  deleteCatalog?: boolean;          // Delete corrupted catalog.db  
  restoreDriveBackup?: boolean;     // Restore per-drive database from backup
  restoreCatalogBackup?: boolean;   // Restore catalog.db from backup
  validateIntegrity?: boolean;      // Validate restored databases
}

/**
 * Result of a recovery operation
 */
interface RecoveryResult {
  success: boolean;
  error?: string;
  details: string[];
  restoredDriveDatabase?: string;
  restoredCatalogTimestamp?: number;
}

/**
 * Information about the current database state for a drive
 */
interface DatabaseState {
  currentDatabase: string | null;     // e.g., "driveId_sync4.db"
  newDatabase: string | null;         // e.g., "driveId_sync5.db" (being created)
  expectedBackup: string | null;      // e.g., "backup_driveId_sync4.db"
  syncNumber: number;                 // Current sync iteration
  isFirstSync: boolean;               // True if transitioning from _init
}

/**
 * Validation result for backup files
 */
interface BackupValidation {
  exists: boolean;
  isValid: boolean;
  timestamp: number;
  fileSize: number;
  canOpen: boolean;
  hasRequiredTables: boolean;
}

/**
 * Crash detection data stored during sync operations
 */
interface CrashDetectionData {
  driveId: string;
  driveName?: string;
  operation: string;
  startTime: number;
  currentDatabase?: string;
  newDatabase?: string;
  catalogBackupCreated?: boolean;
  phase: string;
}

/**
 * Result of crash detection check
 */
interface CrashDetectionResult {
  crashDetected: boolean;
  crashData?: CrashDetectionData;
  shouldRecover: boolean;
  userChoice?: 'recover' | 'continue' | 'details';
}

// Logging configuration
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const isDebugMode = LOG_LEVEL === 'debug';
const isVerboseMode = LOG_LEVEL === 'debug' || LOG_LEVEL === 'info';

// Clean logging function
function log(level: 'debug' | 'info' | 'warn' | 'error', message: string, ...args: any[]) {
  if (level === 'debug' && !isDebugMode) return;
  if (level === 'info' && !isVerboseMode) return;
  
  const prefix = `[PerDriveStorage]`;
  
  switch (level) {
    case 'debug':
      console.log(prefix, message, ...args);
      break;
    case 'info':
      console.log(prefix, message, ...args);
      break;
    case 'warn':
      console.warn(prefix, message, ...args);
      break;
    case 'error':
      console.error(prefix, message, ...args);
      break;
  }
}

export class PerDriveStorage implements StorageManager {
  private catalogDb: Database.Database | null = null;
  private driveDbs = new Map<string, Database.Database>();
  private storageDir: string;
  private userId: string | null = null;
  private scanProgressCallbacks: ((progress: ScanProgress) => void)[] = [];
  private backupManager: BackupManager | null = null;

  constructor(storageDir: string, userId: string) {
    this.storageDir = storageDir;
    
    // Validate user ID - no anonymous storage support
    if (!userId || typeof userId !== 'string' || userId.trim() === '') {
      throw new Error('User ID is required for storage initialization. Anonymous storage is not supported.');
    }
    
    this.userId = userId.trim();
    log('info', `PerDriveStorage initialized for user: ${this.userId}`);
  }

  // Sanitize drive ID for use in filenames
  private sanitizeDriveIdForFilename(driveId: string): string {
    // Replace spaces and special characters with underscores
    return driveId.replace(/[^a-zA-Z0-9]/g, '_');
  }

  // Set or change the user ID (for switching users)
  setUserId(userId: string): void {
    // Validate user ID - no anonymous storage support
    if (!userId || typeof userId !== 'string' || userId.trim() === '') {
      throw new Error('Valid user ID is required. Anonymous storage is not supported.');
    }
    
    this.userId = userId.trim();
    log('info', `User ID updated to: ${this.userId}`);
  }

  // Get the current user ID
  getUserId(): string {
    if (!this.userId) {
      throw new Error('User ID not set. Storage requires a valid user ID.');
    }
    return this.userId;
  }

  // Get the current storage path
  getStoragePath(): string {
    return this.getUserStorageDir();
  }

  // Check if storage is ready for operations
  isReady(): boolean {
    return this.userId !== null && this.catalogDb !== null;
  }

  // Get storage status information
  getStorageStatus(): { ready: boolean; userId: string | null; catalogDbExists: boolean; driveCount: number } {
    return {
      ready: this.isReady(),
      userId: this.userId,
      catalogDbExists: this.catalogDb !== null,
      driveCount: this.driveDbs.size
    };
  }

  // Validate that storage is ready for operations
  private validateStorageReady(operation: string): void {
    if (!this.userId) {
      throw new Error(`Storage not ready for ${operation}: User ID not set`);
    }
    if (!this.catalogDb) {
      throw new Error(`Storage not ready for ${operation}: Catalog database not initialized`);
    }
  }

  // Get the user-specific storage directory
  getUserStorageDir(): string {
    // User ID is always required - no anonymous storage support
    if (!this.userId) {
      throw new Error('User ID is required for storage operations. Anonymous storage is not supported.');
    }
    
    // Create user-specific subdirectory with proper structure
    const userDir = path.join(this.storageDir, 'users', this.userId);
    
    // Ensure the user directory exists with proper permissions
    try {
      fs.ensureDirSync(userDir, { mode: 0o755 }); // Read/write/execute for owner, read/execute for group/others
      log('info', `User-specific storage directory: ${userDir}`);
    } catch (error) {
      log('error', `Failed to create user storage directory: ${userDir}`, error);
      throw new Error(`Failed to create user storage directory: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    return userDir;
  }

  // Get the current sync number for a drive
  private async getCurrentSyncNumber(driveId: string): Promise<number | null> {
    const userStorageDir = this.getUserStorageDir();
    
    // List all files in the directory
    const files = await fs.readdir(userStorageDir);
    
    // Look for files matching our patterns
    const syncRegex = new RegExp(`^${driveId}_sync(\\d+)\\.db$`);
    const initRegex = new RegExp(`^${driveId}_init\\.db$`);
    
    let maxSyncNum = 0;
    let hasInitFile = false;

    for (const file of files) {
      // Check for init file
      if (initRegex.test(file)) {
        hasInitFile = true;
        continue;
      }

      // Check for sync files
      const match = file.match(syncRegex);
      if (match) {
        const syncNum = parseInt(match[1], 10);
        if (!isNaN(syncNum) && syncNum > maxSyncNum) {
          maxSyncNum = syncNum;
        }
      }
    }

    // If we found sync files, return the highest number
    if (maxSyncNum > 0) {
      return maxSyncNum;
    }
    
    // If we found an init file but no sync files, return 0
    if (hasInitFile) {
      return 0;
    }

    // If we found neither, return null
    return null;
  }

  // Get the database filename for a drive
  private async getDriveDatabaseFilename(driveId: string): Promise<string> {
    const safeId = this.sanitizeDriveIdForFilename(driveId);
    const currentSyncNum = await this.getCurrentSyncNumber(safeId);
    
    // No existing database, must be initial creation
    if (currentSyncNum === null) {
      return `${safeId}_init.db`;
    }
    
    // Has _init file but no syncs, create first sync file
    if (currentSyncNum === 0) {
      return `${safeId}_sync1.db`;
    }
    
    // Has existing sync files, increment the number
    return `${safeId}_sync${currentSyncNum + 1}.db`;
  }

  // Get the path to a specific drive database (for new database creation)
  async getDriveDatabasePath(driveId: string): Promise<string> {
    const userStorageDir = this.getUserStorageDir();
    const filename = await this.getDriveDatabaseFilename(driveId);
    return path.join(userStorageDir, filename);
  }

  // Get the current path to a specific drive database (for reading existing data)
  async getCurrentDriveDatabasePath(driveId: string): Promise<string> {
    const userStorageDir = this.getUserStorageDir();
    const safeId = this.sanitizeDriveIdForFilename(driveId);
    const currentSyncNum = await this.getCurrentSyncNumber(safeId);
    
    if (currentSyncNum === null) {
      throw new Error(`No database exists for drive: ${driveId}`);
    }
    
    if (currentSyncNum === 0) {
      // Using init database
      return path.join(userStorageDir, `${safeId}_init.db`);
    }
    
    // Using latest sync database
    return path.join(userStorageDir, `${safeId}_sync${currentSyncNum}.db`);
  }

  // Get the path to a drive backup database
  private getDriveBackupPath(driveId: string): string {
    const userStorageDir = this.getUserStorageDir();
    const safeId = this.sanitizeDriveIdForFilename(driveId);
    const backupPath = path.join(userStorageDir, `drive_${safeId}_backup.db`);
    return backupPath;
  }

  // Get the path to a drive FTS backup database
  private getDriveFTSBackupPath(driveId: string): string {
    const userStorageDir = this.getUserStorageDir();
    const safeId = this.sanitizeDriveIdForFilename(driveId);
    const ftsBackupPath = path.join(userStorageDir, `drive_${safeId}_fts_backup.db`);
    return ftsBackupPath;
  }

  // Get the path to a drive new database (for swapping)
  private getDriveNewPath(driveId: string): string {
    const userStorageDir = this.getUserStorageDir();
    const safeId = this.sanitizeDriveIdForFilename(driveId);
    const newDbPath = path.join(userStorageDir, `drive_${safeId}_new.db`);
    return newDbPath;
  }

  // Simple ID generation function
  private generateSimpleId(): string {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
  }

  // Database operation logging helper
  private logDbOperation(operation: string, driveId: string, details: any = {}) {
    const timestamp = new Date().toISOString();
    const logData = {
      timestamp,
      operation,
      driveId,
      userId: this.userId,
      ...details
    };
    log('debug', `${JSON.stringify(logData, null, 2)}`);
  }

  async initialize(): Promise<void> {
    log('info', `Starting storage initialization for user: ${this.userId}...`);
    
    try {
      // Validate user ID before initialization
      if (!this.userId) {
        throw new Error('User ID is required for storage initialization');
      }
      
      // Get user-specific storage directory
      const userStorageDir = this.getUserStorageDir();
      
      // Initialize catalog database
      const catalogPath = path.join(userStorageDir, 'catalog.db');
      log('debug', `Initializing catalog database at: ${catalogPath}`);
      
      this.catalogDb = new Database(catalogPath);
      log('debug', `Catalog database connection established`);
      
      // Create catalog schema
      log('debug', `Creating catalog schema...`);
      this.createCatalogSchema();
      log('debug', `Catalog schema created successfully`);
      
      // Initialize backup manager
      log('debug', `Initializing backup manager...`);
      this.backupManager = new BackupManager(this.getUserStorageDir(), this);
      log('debug', `Backup manager initialized`);
      
      // Skip eager drive initialization - drives will be lazy-loaded on first access
      // This significantly speeds up startup time, especially for users with many drives
      log('debug', `Skipping eager drive initialization (using lazy loading)`);
      // await this.initializeExistingDrives();
      
      log('info', `Storage initialization completed successfully for user: ${this.userId}`);
      log('debug', `Storage initialization completed successfully for user: ${this.userId}`);
    } catch (error: any) {
      console.error(`[DB-INIT] Storage initialization failed for user ${this.userId}:`, error instanceof Error ? error.message : String(error));
      console.error(`[DB-INIT] Error stack:`, error instanceof Error ? error.stack : undefined);
      log('error', `Storage initialization failed for user ${this.userId}:`, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  async reinitializeForUser(userId: string): Promise<void> {
    log('info', `Reinitializing storage for user: ${userId}...`);
    
    try {
      // Validate user ID
      if (!userId || typeof userId !== 'string' || userId.trim() === '') {
        throw new Error('Valid user ID is required for storage reinitialization');
      }
      
      // Log current state before reinitializing
      log('info', `Current user ID: ${this.userId}`);
      log('info', `Current catalog database: ${this.catalogDb ? 'exists' : 'null'}`);
      log('info', `Number of drive databases: ${this.driveDbs.size}`);
      
      // Close existing connections with enhanced cleanup
      log('info', 'Closing existing database connections...');
      await this.close();
      
      // Clear existing drive databases
      log('info', 'Clearing drive database cache...');
      this.driveDbs.clear();
      
      // Set new user ID
      log('info', `Setting new user ID: ${userId}`);
      this.userId = userId.trim();
      
      // Get new storage directory
      const newStorageDir = this.getUserStorageDir();
      log('info', `New storage directory: ${newStorageDir}`);
      
      // Reinitialize with new user
      log('info', 'Reinitializing storage manager...');
      await this.initialize();
      
      log('info', `Storage reinitialized successfully for user: ${userId}`);
      log('info', `New catalog database: ${this.catalogDb ? 'exists' : 'null'}`);
      log('info', `New storage directory: ${this.getUserStorageDir()}`);
    } catch (error: any) {
      log('error', `Failed to reinitialize storage for user ${userId}:`, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  private createCatalogSchema(): void {
    if (!this.catalogDb) return;

    // Drives table
    this.catalogDb.exec(`
      CREATE TABLE IF NOT EXISTS drives (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        total_capacity INTEGER NOT NULL DEFAULT 0,
        used_space INTEGER NOT NULL DEFAULT 0,
        free_space INTEGER NOT NULL DEFAULT 0,
        format_type TEXT DEFAULT '',
        added_date TEXT NOT NULL,
        last_updated TEXT,
        deleted INTEGER DEFAULT 0,
        deleted_at TEXT
      );
    `);

    // Create search index (FTS5) - safe creation only
    try {
      // Check if search index exists
      const tableExists = this.catalogDb.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='files_fts'
      `).get();
      
      if (!tableExists) {
        log('info', `Creating search index with correct schema`);
        
        // Create search index (FTS5)
        this.catalogDb.exec(`
          CREATE VIRTUAL TABLE files_fts USING fts5(
            name,
            drive_id,
            path,
            is_directory
          );
        `);
        
        log('info', `Search index created successfully`);
      } else {
        log('info', `Search index already exists, skipping creation`);
      }
    } catch (error: any) {
      log('error', `Failed to create search index:`, error.message);
      // Don't throw - search index is not critical for basic functionality
    }

    // Migration: Remove legacy drive_versions table if it exists (used JSON storage)
    try {
      const driveVersionsExists = this.catalogDb.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='drive_versions'
      `).get();
      
      if (driveVersionsExists) {
        log('info', 'Removing legacy drive_versions table (contained JSON data)...');
        this.catalogDb.exec(`DROP TABLE drive_versions;`);
        log('info', 'Legacy drive_versions table removed successfully');
      }
    } catch (error: any) {
      log('warn', `Failed to remove legacy drive_versions table:`, error.message);
      // Don't throw - this is just cleanup
    }

    // Recovery functionality removed for MVP

    // Create triggers for FTS index maintenance
    this.createCatalogTriggers();
  }

  private createCatalogTriggers(): void {
    if (!this.catalogDb) return;

    // Note: We can't create triggers on virtual tables (files_fts)
    // Instead, we'll manually manage the FTS index in the storeFileTree method
    // and other file operations
  }

  private async initializeExistingDrives(): Promise<void> {
    if (!this.catalogDb) {
      return;
    }

    const drives = this.catalogDb.prepare(`
      SELECT id, name, path FROM drives WHERE deleted = 0
    `).all() as DriveInfo[];

    if (drives.length > 0) {
      log('info', `Initializing ${drives.length} existing drives...`);
      
      for (const drive of drives) {
        try {
          await this.initializeDriveDatabase(drive.id);
        } catch (error: any) {
          log('error', `Failed to initialize drive database for ${drive.name} (${drive.id}):`, error.message);
        }
      }
      
      log('info', `Successfully initialized ${drives.length} drives`);
    } else {
      log('info', 'No existing drives found');
    }
  }

  async initializeDriveDatabase(driveId: string): Promise<void> {
    try {
      // Get current database path based on sync number
      let currentDbPath: string;
      try {
        currentDbPath = await this.getCurrentDriveDatabasePath(driveId);
      } catch (error) {
        log('debug', `No existing database found for drive ${driveId}`);
        return; // Drive database doesn't exist yet
      }

      log('debug', `Initializing drive database: ${currentDbPath}`);
      log('debug', `User storage directory: ${this.getUserStorageDir()}`);
      
      // Check if drive database exists
      if (!(await fs.pathExists(currentDbPath))) {
        log('debug', `Drive database doesn't exist yet: ${currentDbPath}`);
        return; // Drive database doesn't exist yet
      }

      try {
        log('debug', `Opening existing drive database: ${driveId}`);
        const driveDb = new Database(currentDbPath);
        log('debug', `Drive database connection established for: ${driveId}`);
        
        this.driveDbs.set(driveId, driveDb);
        log('debug', `Drive database ${driveId} added to memory map`);
        
        // Create drive database schema if it doesn't exist
        log('debug', `Creating/verifying schema for drive: ${driveId}`);
        this.createDriveSchema(driveDb);
        log('debug', `Schema verified for drive: ${driveId}`);
      } catch (error: any) {
        console.error(`[DB-DRIVE] Failed to initialize drive database for ${driveId}:`, error.message);
        console.error(`[DB-DRIVE] Error stack:`, error.stack);
        log('error', `Failed to initialize drive database for ${driveId}:`, error.message);
        throw error;
      }
    } catch (error: any) {
      console.error(`[DB-DRIVE] Failed to initialize drive database for ${driveId}:`, error.message);
      console.error(`[DB-DRIVE] Error stack:`, error.stack);
      log('error', `Failed to initialize drive database for ${driveId}:`, error.message);
      throw error;
    }
  }

  /**
   * Get or lazy-load a drive database connection.
   * Opens the database on first access if not already open.
   */
  private async getDriveDb(driveId: string): Promise<Database.Database | null> {
    // Check if already open in memory
    if (this.driveDbs.has(driveId)) {
      return this.driveDbs.get(driveId)!;
    }
    
    // Not open yet - lazy load it now
    log('debug', `Lazy-loading drive database: ${driveId}`);
    try {
      await this.initializeDriveDatabase(driveId);
      return this.driveDbs.get(driveId) || null;
    } catch (error: any) {
      log('error', `Failed to lazy-load drive database ${driveId}:`, error.message);
      return null;
    }
  }

  private createDriveSchema(driveDb: Database.Database): void {
    log('debug', `Creating/verifying drive database schema`);
    
    // Drive metadata table - stores all drive information in the per-drive database
    log('debug', `Creating drive_metadata table...`);
    driveDb.exec(`
      CREATE TABLE IF NOT EXISTS drive_metadata (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        total_capacity INTEGER,
        used_space INTEGER,
        free_space INTEGER,
        format_type TEXT,
        last_scan TEXT,
        file_count INTEGER,
        status TEXT DEFAULT 'active',
        added_date TEXT,
        last_updated TEXT
      );
    `);
    log('debug', `Drive metadata table created/verified`);
    
    // Files table
    log('debug', `Creating files table...`);
    driveDb.exec(`
      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        drive_id TEXT NOT NULL,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        parent_path TEXT,
        is_directory INTEGER NOT NULL,
        size INTEGER,
        created TEXT,
        modified TEXT,
        depth INTEGER,
        inode INTEGER,
        hard_link_count INTEGER,
        is_hard_link INTEGER,
        hard_link_group TEXT,
        folder_path TEXT,
        file_type TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        deleted INTEGER DEFAULT 0,
        deleted_at TEXT,
        deletion_reason TEXT,
        UNIQUE(drive_id, path)
      );
    `);
    log('debug', `Files table created/verified`);

    // Performance indexes (safe, additive):
    // - children-of-folder queries
    // - exact path lookups
    // - optional name+path composite for occasional lookups
    log('debug', `Creating performance indexes...`);
    driveDb.exec(`
      CREATE INDEX IF NOT EXISTS idx_files_drive_parent ON files(drive_id, parent_path, deleted, is_directory, name);
      CREATE INDEX IF NOT EXISTS idx_files_drive_path ON files(drive_id, path);
      CREATE INDEX IF NOT EXISTS idx_files_drive_name_path ON files(drive_id, name, path);
    `);
    log('debug', `Performance indexes created/verified`);

    // Recovery functionality removed for MVP
    log('debug', `Drive database schema setup completed`);
  }

  // Drive operations
  async addDrive(drive: DriveInfo): Promise<DriveInfo> {
    log('info', `Adding drive: ${drive.name}`);
    
    if (!this.catalogDb) {
      throw new Error('Catalog database not initialized');
    }

    try {
      // Add to catalog
      this.catalogDb.prepare(`
        INSERT INTO drives (id, name, path, total_capacity, used_space, free_space, format_type, added_date, last_updated, deleted, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        drive.id, drive.name, drive.path, drive.totalCapacity, drive.usedSpace, 
        drive.freeSpace, drive.formatType, drive.addedDate, drive.lastUpdated, 
        drive.deleted ? 1 : 0, drive.deletedAt
      );

      // Create drive-specific database
      await this.createDriveDatabase(drive.id);

      // Add drive metadata to the per-drive database
      const driveDb = this.driveDbs.get(drive.id);
      if (driveDb) {
        driveDb.prepare(`
          INSERT OR REPLACE INTO drive_metadata (
            id, name, path, total_capacity, used_space, free_space, 
            format_type, last_scan, file_count, status, added_date, last_updated
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          drive.id, drive.name, drive.path, drive.totalCapacity, drive.usedSpace,
          drive.freeSpace, drive.formatType, null, 0, 'active', drive.addedDate, drive.lastUpdated
        );
        log('debug', `Drive metadata inserted into per-drive database for ${drive.id}`);
      }

      log('info', `Drive added successfully: ${drive.name}`);
      
      // Return the drive info
      return drive;
    } catch (error: any) {
      log('error', `Failed to add drive ${drive.name}:`, error.message);
      throw error;
    }
  }

  private async createDriveDatabase(driveId: string): Promise<void> {
    const driveDbPath = await this.getDriveDatabasePath(driveId);
    
    try {
      log('debug', `Creating new drive database: ${driveDbPath}`);
      const driveDb = new Database(driveDbPath);
      this.createDriveSchema(driveDb);
      this.driveDbs.set(driveId, driveDb);
      log('info', `Created drive database with path: ${driveDbPath}`);
    } catch (error: any) {
      log('error', `Failed to create drive database for ${driveId}:`, error.message);
      throw error;
    }
  }

  async removeDrive(driveId: string): Promise<void> {
    if (!this.catalogDb) throw new Error('Catalog database not initialized');

    // Get drive info for backup
    const driveInfo = this.catalogDb.prepare(`SELECT * FROM drives WHERE id = ?`).get(driveId) as any;
    if (!driveInfo) {
      throw new Error(`Drive ${driveId} not found`);
    }

    // First get the current database path BEFORE we delete anything
    let currentDbPath: string | null = null;
    try {
      currentDbPath = await this.getCurrentDriveDatabasePath(driveId);
      log('debug', `[removeDrive] Current database path: ${currentDbPath}`);
    } catch (error: any) {
      console.error(`[removeDrive] Could not get current database path: ${error.message}`);
      // Continue with deletion even if we can't get the path
    }

    // Create backup before deletion if we have a valid path
    if (this.backupManager && currentDbPath) {
      try {
        const backupSuccess = await this.backupManager.backupDrive(
          driveId, 
          driveInfo.name || `Drive ${driveId}`, 
          currentDbPath
        );
        
        if (backupSuccess) {
          log('info', `Backup created for drive ${driveId} before deletion`);
        } else {
          console.warn(`[removeDrive] Failed to create backup for drive ${driveId}, proceeding with deletion`);
        }
      } catch (error: any) {
        console.error(`[removeDrive] Error creating backup for drive ${driveId}:`, error.message);
        // Continue with deletion even if backup fails
      }
    }

    // Delete the database file from filesystem first if we have a path
    if (currentDbPath) {
      try {
        const exists = await fs.pathExists(currentDbPath);
        log('debug', `[removeDrive] Database file exists: ${exists}`);
        
        if (exists) {
          // Force close any remaining connections
          const driveDb = this.driveDbs.get(driveId);
          if (driveDb) {
            log('debug', `[removeDrive] Closing database connection before deletion`);
            driveDb.close();
            this.driveDbs.delete(driveId);
          }
          
          // Ensure we have write permissions
          await fs.chmod(currentDbPath, 0o666);
          log('debug', `[removeDrive] Updated file permissions for deletion`);
          
          // Try to delete the file
          await fs.remove(currentDbPath);
          log('debug', `[removeDrive] Successfully deleted database file: ${currentDbPath}`);
          
          // Verify deletion
          const stillExists = await fs.pathExists(currentDbPath);
          if (stillExists) {
            throw new Error(`Failed to delete file - file still exists after removal attempt`);
          }
          
          log('info', `Deleted active database file: ${currentDbPath}`);
        } else {
          log('warn', `Database file not found at expected path: ${currentDbPath}`);
        }
      } catch (error: any) {
        console.error(`[removeDrive] Failed to delete database file: ${error.message}`);
        // Continue with catalog cleanup even if file deletion fails
      }
    }

    // Now clean up the database entries
    try {
      // Remove files from search index first
      this.catalogDb.prepare(`
        DELETE FROM files_fts WHERE drive_id = ?
      `).run(driveId);

      // Then remove from catalog
      this.catalogDb.prepare(`
        DELETE FROM drives WHERE id = ?
      `).run(driveId);

      // Finally, close and remove from memory if not already done
      const driveDb = this.driveDbs.get(driveId);
      if (driveDb) {
        driveDb.close();
        this.driveDbs.delete(driveId);
      }
    } catch (error: any) {
      console.error(`[removeDrive] Failed to clean up database entries: ${error.message}`);
      throw error; // Throw here since the database state might be inconsistent
    }
  }

  // Recovery functionality removed for MVP

  getBackupManager(): BackupManager | null {
    return this.backupManager;
  }

  async getDriveById(driveId: string): Promise<DriveInfo | null> {
    if (!this.catalogDb) throw new Error('Catalog database not initialized');

    const drive = this.catalogDb.prepare(`
      SELECT * FROM drives WHERE id = ?
    `).get(driveId) as any;

    if (!drive) return null;

    return {
      id: drive.id,
      name: drive.name,
      path: drive.path,
      totalCapacity: drive.total_capacity,
      usedSpace: drive.used_space,
      freeSpace: drive.free_space,
      serialNumber: '', // Not stored in catalog
      formatType: drive.format_type,
      addedDate: drive.added_date,
      lastUpdated: drive.last_updated,
      deleted: !!drive.deleted,
      deletedAt: drive.deleted_at
    };
  }

  async getAllDrives(): Promise<DriveInfo[]> {
    if (!this.catalogDb) throw new Error('Catalog database not initialized');

    const drives = this.catalogDb.prepare(`
      SELECT * FROM drives ORDER BY added_date DESC
    `).all() as any[];

    return drives.map(drive => ({
      id: drive.id,
      name: drive.name,
      path: drive.path,
      totalCapacity: drive.total_capacity,
      usedSpace: drive.used_space,
      freeSpace: drive.free_space,
      serialNumber: '',
      formatType: drive.format_type,
      addedDate: drive.added_date,
      lastUpdated: drive.last_updated,
      deleted: !!drive.deleted,
      deletedAt: drive.deleted_at
    }));
  }

  async getActiveDrives(): Promise<DriveInfo[]> {
    if (!this.catalogDb) throw new Error('Catalog database not initialized');

    const drives = this.catalogDb.prepare(`
      SELECT * FROM drives WHERE deleted = 0 ORDER BY added_date DESC
    `).all() as any[];

    return drives.map(drive => ({
      id: drive.id,
      name: drive.name,
      path: drive.path,
      totalCapacity: drive.total_capacity,
      usedSpace: drive.used_space,
      freeSpace: drive.free_space,
      serialNumber: '',
      formatType: drive.format_type,
      addedDate: drive.added_date,
      lastUpdated: drive.last_updated,
      deleted: !!drive.deleted,
      deletedAt: drive.deleted_at
    }));
  }

  async updateDriveInfo(driveId: string, updates: Partial<DriveInfo>): Promise<void> {
    if (!this.catalogDb) throw new Error('Catalog database not initialized');

    log('debug', `Updating drive info for drive: ${driveId}`);
    log('debug', `Update fields:`, Object.keys(updates));
    log('debug', `Update values:`, updates);

    const setClauses: string[] = [];
    const values: any[] = [];

    if (updates.name !== undefined) {
      setClauses.push('name = ?');
      values.push(updates.name);
      log('debug', `Field mapping: name → name = ${updates.name}`);
    }
    if (updates.totalCapacity !== undefined) {
      setClauses.push('total_capacity = ?');
      values.push(updates.totalCapacity);
      log('debug', `Field mapping: totalCapacity → total_capacity = ${updates.totalCapacity}`);
    }
    if (updates.usedSpace !== undefined) {
      setClauses.push('used_space = ?');
      values.push(updates.usedSpace);
      log('debug', `Field mapping: usedSpace → used_space = ${updates.usedSpace}`);
    }
    if (updates.freeSpace !== undefined) {
      setClauses.push('free_space = ?');
      values.push(updates.freeSpace);
      log('debug', `Field mapping: freeSpace → free_space = ${updates.freeSpace}`);
    }
    if (updates.lastUpdated !== undefined) {
      setClauses.push('last_updated = ?');
      values.push(updates.lastUpdated);
      log('debug', `Field mapping: lastUpdated → last_updated = ${updates.lastUpdated}`);
    }
    if (updates.fileCount !== undefined) {
      setClauses.push('file_count = ?');
      values.push(updates.fileCount);
      log('debug', `Field mapping: fileCount → file_count = ${updates.fileCount}`);
    }

    if (setClauses.length === 0) {
      log('debug', `No updates to make for drive: ${driveId}`);
      return;
    }

    const query = `UPDATE drives SET ${setClauses.join(', ')} WHERE id = ?`;
    values.push(driveId);
    
    log('debug', `Executing UPDATE query: ${query}`);
    log('debug', `Query parameters:`, values);

    try {
      const updateStartTime = Date.now();
      const result = this.catalogDb.prepare(query).run(...values);
      const updateDuration = Date.now() - updateStartTime;
      
      log('debug', `UPDATE completed in ${updateDuration}ms`);
      log('debug', `Rows affected: ${result.changes}`);
      log('debug', `Drive ${driveId} updated successfully`);
    } catch (error: any) {
      console.error(`[DB-UPDATE] Failed to update drive ${driveId}:`, error.message);
      console.error(`[DB-UPDATE] Error stack:`, error.stack);
      throw error;
    }
  }

  // File operations
  async storeFileTree(driveId: string, files: (FileInfo | Omit<FileInfo, 'id'>)[]): Promise<void> {
    log('debug', `===== STORING FILE TREE =====`);
    log('debug', `Drive ID: ${driveId}`);
    log('debug', `Total files to store: ${files.length}`);
    
    // Log sample of files being stored
    if (files.length > 0) {
      const sample = files.slice(0, 3);
      log('debug', `Sample of files to store:`, sample.map(f => ({
        name: f.name,
        path: f.path,
        parentPath: f.parentPath,
        isDirectory: f.isDirectory
      })));
    }
    
    try {
      const driveDb = await this.getDriveDb(driveId);
      if (!driveDb) {
        console.error(`[DB-FILES] Drive database not found for drive: ${driveId}`);
        throw new Error(`Drive database not found for drive: ${driveId}`);
      }

      log('debug', `Drive database connection verified for: ${driveId}`);

      // Clear existing files for this drive
      log('debug', `Clearing existing files for drive: ${driveId}`);
      log('debug', `Executing DELETE FROM files WHERE drive_id = ?`);
      const deleteStartTime = Date.now();
      const deleteResult = driveDb.prepare(`DELETE FROM files WHERE drive_id = ?`).run(driveId);
      const deleteDuration = Date.now() - deleteStartTime;
      
      log('debug', `DELETE completed in ${deleteDuration}ms`);
      log('debug', `Cleared ${deleteResult.changes} existing files`);
      
      if (deleteResult.changes > 0) {
        log('info', `Cleared ${deleteResult.changes} existing files`);
      }
      
      // Store all files
      log('debug', `Starting batch insertion of ${files.length} files...`);
      const insertStartTime = Date.now();
      await this.insertFilesInBatches(driveDb, driveId, files);
      const insertDuration = Date.now() - insertStartTime;
      log('debug', `Batch insertion completed in ${insertDuration}ms`);
      
      // Update search index
      log('debug', `Updating search index...`);
      const indexStartTime = Date.now();
      await this.populateSearchIndex();
      const indexDuration = Date.now() - indexStartTime;
      log('debug', `Search index updated in ${indexDuration}ms`);
      
      const totalDuration = Date.now() - deleteStartTime;
      log('debug', `===== FILE TREE STORED SUCCESSFULLY =====`);
      log('debug', `Total duration: ${totalDuration}ms`);
      log('debug', `Breakdown:`);
      log('debug', `  - Clear existing: ${deleteDuration}ms`);
      log('debug', `  - Insert new files: ${insertDuration}ms`);
      log('debug', `  - Update search index: ${indexDuration}ms`);
      log('debug', `  - Other operations: ${totalDuration - deleteDuration - insertDuration - indexDuration}ms`);
      
      log('info', `Stored ${files.length} files for drive`);
    } catch (error) {
      console.error(`[DB-FILES] Failed to store file tree for drive ${driveId}:`, error);
      console.error(`[DB-FILES] Error stack:`, (error as Error).stack);
      log('error', `Failed to store file tree for drive ${driveId}:`, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  async storeFileTreeProgressive(driveId: string, files: (FileInfo | Omit<FileInfo, 'id'>)[]): Promise<void> {
    try {
      const driveDb = await this.getDriveDb(driveId);
      if (!driveDb) {
        throw new Error(`Drive database not found for drive: ${driveId}`);
      }

      // Store this batch of files (don't clear existing files)
      await this.insertFilesInBatches(driveDb, driveId, files);
    } catch (error) {
      log('error', `Progressive storage failed for drive ${driveId}:`, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  private async insertFilesInBatches(driveDb: any, driveId: string, files: (FileInfo | Omit<FileInfo, 'id'>)[]): Promise<void> {
    const BATCH_SIZE = 10000; // Process files in batches of 10000 (increased for maximum performance)
    
    log('debug', `===== STARTING BATCH INSERTION =====`);
    log('debug', `Drive ID: ${driveId}`);
    log('debug', `Total files: ${files.length}`);
    log('debug', `Batch size: ${BATCH_SIZE}`);
    log('debug', `Expected batches: ${Math.ceil(files.length / BATCH_SIZE)}`);

    // Analyze parentPath distribution
    const parentPaths = new Map<string | null | undefined, number>();
    for (const file of files) {
      const key = file.parentPath;
      parentPaths.set(key, (parentPaths.get(key) || 0) + 1);
    }
    log('debug', 'Parent path distribution:', Object.fromEntries(parentPaths.entries()));

    // Analyze some root-level files if they exist
    const rootFiles = files.filter(f => !f.parentPath || f.parentPath === '').slice(0, 3);
    if (rootFiles.length > 0) {
      log('debug', 'Sample of root-level files:', rootFiles.map(f => ({
        name: f.name,
        path: f.path,
        parentPath: f.parentPath,
        isDirectory: f.isDirectory
      })));
    }
    
    // Insert new files
    log('debug', `Preparing INSERT statement for files table`);
    const insertStmt = driveDb.prepare(`
      INSERT INTO files (id, drive_id, name, path, parent_path, is_directory, size, created, modified, depth, inode, hard_link_count, is_hard_link, hard_link_group, folder_path, file_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Insert into search index
    log('debug', `Preparing INSERT statement for FTS table`);
    const ftsInsertStmt = this.catalogDb?.prepare(`
      INSERT INTO files_fts (name, drive_id, path, is_directory) VALUES (?, ?, ?, ?)
    `);

    let insertedFiles = 0;
    let insertedDirectories = 0;
    let totalSize = 0;

    // Process files in batches
    const batchStartTime = Date.now();
    let batchCount = 0;
    
    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE);
      batchCount++;
      const batchStartTime = Date.now();
      
      log('debug', `Processing batch ${batchCount}/${Math.ceil(files.length / BATCH_SIZE)}: ${batch.length} files`);
      
      for (const file of batch) {
        const fileId = 'id' in file ? file.id : this.generateSimpleId();
        const result = insertStmt.run(
          fileId, driveId, file.name, file.path, file.parentPath, 
          file.isDirectory ? 1 : 0, file.size, file.created, file.modified,
          file.depth, file.inode, file.hardLinkCount, file.isHardLink ? 1 : 0,
          file.hardLinkGroup, file.folderPath, file.file_type
        );

        if (result.changes > 0) {
          insertedFiles++;
          if (file.isDirectory) {
            insertedDirectories++;
          } else {
            totalSize += file.size || 0;
          }
        }

        // Add to search index
        if (this.catalogDb && ftsInsertStmt) {
          try {
            ftsInsertStmt.run(file.name, driveId, file.path, file.isDirectory ? 1 : 0);
          } catch (ftsError: any) {
            console.warn(`[DB-BATCH] Failed to add file ${file.name} to search index:`, ftsError.message);
            log('warn', `Failed to add file ${file.name} to search index:`, ftsError.message);
          }
        }
      }
      
      const batchDuration = Date.now() - batchStartTime;
      log('debug', `Batch ${batchCount} completed in ${batchDuration}ms`);
      
      // Log progress for very large batches only
      if (files.length > 50000 && (i + batch.length) % 50000 === 0) {
        const progress = Math.min(100, ((i + batch.length) / files.length) * 100);
        log('debug', `Progress: ${progress.toFixed(1)}% (${i + batch.length}/${files.length} files)`);
        log('info', `Progress: ${progress.toFixed(1)}% (${i + batch.length}/${files.length} files)`);
      }
    }
    
    const totalBatchDuration = Date.now() - batchStartTime;
    log('debug', `===== BATCH INSERTION COMPLETED =====`);
    log('debug', `Total duration: ${totalBatchDuration}ms`);
    log('debug', `Batches processed: ${batchCount}`);
    log('debug', `Average batch time: ${(totalBatchDuration / batchCount).toFixed(2)}ms`);

    if (insertedFiles > 0) {
      log('info', `Inserted ${insertedFiles} files (${insertedDirectories} dirs, ${(totalSize / (1024 * 1024)).toFixed(1)}MB)`);
    }
  }

  async getFileDetails(fileId: string, driveId: string): Promise<FileInfo | null> {
    const driveDb = await this.getDriveDb(driveId);
    if (!driveDb) return null;

    const file = driveDb.prepare(`
      SELECT * FROM files WHERE id = ? AND drive_id = ?
    `).get(fileId, driveId) as any;

    if (!file) return null;

    return {
      id: file.id,
      name: file.name,
      path: file.path,
      parentPath: file.parent_path,
      size: file.size,
      created: file.created,
      modified: file.modified,
      isDirectory: !!file.is_directory,
      folderPath: file.folder_path,
      driveId: file.drive_id,
      depth: file.depth,
      inode: file.inode,
      hardLinkCount: file.hard_link_count,
      isHardLink: !!file.is_hard_link,
      hardLinkGroup: file.hard_link_group,
      file_type: file.file_type
    };
  }

  async listDriveFiles(driveId: string, path: string): Promise<FileInfo[]> {
    const driveDb = await this.getDriveDb(driveId);
    if (!driveDb) return [];

    const query = `
      SELECT * FROM files 
      WHERE drive_id = ? AND parent_path = ? AND deleted = 0
      ORDER BY is_directory DESC, name ASC
    `;
    
    const files = driveDb.prepare(query).all(driveId, path) as any[];

    return files.map(file => ({
      id: file.id,
      name: file.name,
      path: file.path,
      parentPath: file.parent_path,
      size: file.size,
      created: file.created,
      modified: file.modified,
      isDirectory: !!file.is_directory,
      folderPath: file.folder_path,
      driveId: file.drive_id,
      depth: file.depth,
      inode: file.inode,
      hardLinkCount: file.hard_link_count,
      isHardLink: !!file.is_hard_link,
      hardLinkGroup: file.hard_link_group,
      file_type: file.file_type
    }));
  }

  async listRoot(driveId: string): Promise<FileInfo[]> {
    log('debug', `[listRoot] Starting for drive: ${driveId}`);

    const driveDb = await this.getDriveDb(driveId);
    if (!driveDb) {
      log('error', `[listRoot] Drive database not found for drive: ${driveId}`);
      return [];
    }
    
    log('debug', `[listRoot] Drive database connection obtained`);

    // First check total files in drive
    const totalCount = driveDb.prepare(`SELECT COUNT(*) as count FROM files WHERE drive_id = ?`).get(driveId) as any;
    log('debug', `[listRoot] Total files in drive: ${totalCount.count}`);

    // Check for any files with parent paths to verify storage format
    const parentPathSample = driveDb.prepare(`
      SELECT parent_path, COUNT(*) as count 
      FROM files 
      WHERE drive_id = ? 
      GROUP BY parent_path 
      LIMIT 5
    `).all(driveId) as any[];
    log('debug', `[listRoot] Sample of parent paths:`, parentPathSample);
    
    // Query for files that are actually at the root level
    // Check for both empty string and null parent paths, and limit results
    const query = `
      SELECT * FROM files 
      WHERE drive_id = ? 
        AND (parent_path = '' OR parent_path IS NULL) 
        AND deleted = 0
      ORDER BY is_directory DESC, name ASC
      LIMIT 1000
    `;
    
    log('debug', `[listRoot] Executing root files query`);
    const files = driveDb.prepare(query).all(driveId) as any[];
    log('debug', `[listRoot] Found ${files.length} root files`);
    
    return files.map(file => ({
      id: file.id,
      name: file.name,
      path: file.path,
      parentPath: file.parent_path,
      size: file.size,
      created: file.created,
      modified: file.modified,
      isDirectory: !!file.is_directory,
      folderPath: file.folder_path,
      driveId: file.drive_id,
      depth: file.depth,
      inode: file.inode,
      hardLinkCount: file.hard_link_count,
      isHardLink: !!file.is_hard_link,
      hardLinkGroup: file.hard_link_group,
      file_type: file.file_type
    }));
  }

  // Get total file count for a drive

  // Get total file count for a drive
  async getDriveFileCount(driveId: string): Promise<{ total: number; directories: number; files: number }> {
    const driveDb = await this.getDriveDb(driveId);
    if (!driveDb) return { total: 0, directories: 0, files: 0 };

    try {
      const totalResult = driveDb.prepare(`
        SELECT COUNT(*) as count FROM files WHERE drive_id = ? AND deleted = 0
      `).get(driveId) as any;
      
      const dirResult = driveDb.prepare(`
        SELECT COUNT(*) as count FROM files WHERE drive_id = ? AND is_directory = 1 AND deleted = 0
      `).get(driveId) as any;
      
      const fileResult = driveDb.prepare(`
        SELECT COUNT(*) as count FROM files WHERE drive_id = ? AND is_directory = 0 AND deleted = 0
      `).get(driveId) as any;
      
      return {
        total: totalResult?.count || 0,
        directories: dirResult?.count || 0,
        files: fileResult?.count || 0
      };
    } catch (error) {
      log('error', `Error getting file count for drive ${driveId}:`, error);
      return { total: 0, directories: 0, files: 0 };
    }
  }

  async listChildren(driveId: string, parentPath: string, limit?: number, offset?: number): Promise<{ files: FileInfo[]; hasMore: boolean }> {
    const driveDb = await this.getDriveDb(driveId);
    if (!driveDb) return { files: [], hasMore: false };

    let query = `
      SELECT * FROM files 
      WHERE drive_id = ? AND parent_path = ? AND deleted = 0
      ORDER BY is_directory DESC, name ASC
    `;

    if (limit) {
      query += ` LIMIT ${limit}`;
      if (offset) {
        query += ` OFFSET ${offset}`;
      }
    }

    const files = driveDb.prepare(query).all(driveId, parentPath) as any[];

    // Check if there are more files
    let hasMore = false;
    if (limit) {
      const totalCount = driveDb.prepare(`
        SELECT COUNT(*) as count FROM files 
        WHERE drive_id = ? AND parent_path = ? AND deleted = 0
      `).get(driveId, parentPath) as any;
      hasMore = totalCount.count > (offset || 0) + files.length;
    }

    return {
      files: files.map(file => ({
        id: file.id,
        name: file.name,
        path: file.path,
        parentPath: file.parent_path,
        size: file.size,
        created: file.created,
        modified: file.modified,
        isDirectory: !!file.is_directory,
        folderPath: file.folder_path,
        driveId: file.drive_id,
        depth: file.depth,
        inode: file.inode,
        hardLinkCount: file.hard_link_count,
        isHardLink: !!file.is_hard_link,
        hardLinkGroup: file.hard_link_group,
        file_type: file.file_type
      })),
      hasMore
    };
  }

  async listChildrenBatch(driveId: string, parentPaths: string[]): Promise<{ [parentPath: string]: FileInfo[] }> {
    const driveDb = await this.getDriveDb(driveId);
    if (!driveDb || !parentPaths || parentPaths.length === 0) return {};

    // Deduplicate parent paths to avoid redundant rows
    const uniqueParents = Array.from(new Set(parentPaths.filter(Boolean)));
    if (uniqueParents.length === 0) return {};

    // Build an IN clause for parent paths
    const placeholders = uniqueParents.map(() => '?').join(',');
    const sql = `
      SELECT * FROM files
      WHERE drive_id = ? AND parent_path IN (${placeholders}) AND deleted = 0
      ORDER BY is_directory DESC, name ASC
    `;
    const rows = driveDb.prepare(sql).all(driveId, ...uniqueParents) as any[];

    const grouped: { [parentPath: string]: FileInfo[] } = {};
    for (const p of uniqueParents) grouped[p] = [];

    for (const file of rows) {
      const parent = file.parent_path || '';
      if (!grouped[parent]) grouped[parent] = [];
      grouped[parent].push({
        id: file.id,
        name: file.name,
        path: file.path,
        parentPath: file.parent_path,
        size: file.size,
        created: file.created,
        modified: file.modified,
        isDirectory: !!file.is_directory,
        folderPath: file.folder_path,
        driveId: file.drive_id,
        depth: file.depth,
        inode: file.inode,
        hardLinkCount: file.hard_link_count,
        isHardLink: !!file.is_hard_link,
        hardLinkGroup: file.hard_link_group,
        file_type: file.file_type
      });
    }

    return grouped;
  }

  async updateFileSize(fileId: string, size: number): Promise<void> {
    // Find which drive this file belongs to
    for (const [driveId, driveDb] of this.driveDbs) {
      const file = driveDb.prepare(`
        SELECT id FROM files WHERE id = ?
      `).get(fileId) as any;

      if (file) {
        driveDb.prepare(`
          UPDATE files SET size = ?, updated_at = datetime('now') WHERE id = ?
        `).run(size, fileId);
        return;
      }
    }
  }



  // New: paged search with MATCH fallback to LIKE
  async searchFilesPaged(query: string, offset: number, limit: number, driveFilter?: string[], hideSystemFiles?: boolean): Promise<{ rows: SearchResult[]; total: number; mode: 'MATCH' | 'LIKE'; truncatedTotal?: boolean }> {
    if (!this.catalogDb) throw new Error('Catalog database not initialized');
    const start = Date.now();
    const safeLimit = Math.max(1, Math.min(limit || 100, 500));
    const safeOffset = Math.max(0, offset || 0);
    
    log('debug', `searchFilesPaged called with hideSystemFiles=${hideSystemFiles}`);

    const tryMatch = (q: string) => {
      // Very simple sanitization and builder: split tokens, prefix *
      const tokens = q.trim().split(/\s+/).filter(Boolean);
      if (tokens.length === 0) return null;
      // Guard: require >= 2 chars for MATCH
      if (tokens.join('').length < 2) return null;
      const escaped = tokens.map(t => '"' + t.replace(/"/g, '""') + '"*');
      const expr = escaped.join(' AND ');
      return expr;
    };

    const runQuery = (sql: string, params: any[]) => {
      const rows = this.catalogDb!.prepare(sql).all(...params) as any[];
      
      // Debug: Log first few raw results to see what we're getting
      if (rows.length > 0) {
        log('debug', '[SearchPaged] First 3 raw results from FTS:', rows.slice(0, 3).map(r => ({
          fileName: r.fileName,
          isDirectory: r.isDirectory,
          driveId: r.driveId
        })));
      }
      
      return rows.map(r => ({
        fileId: '',
        driveId: r.driveId,
        driveName: '',
        fileName: r.fileName,
        path: r.fullPath,
        fullPath: r.fullPath,
        isDirectory: !!r.isDirectory, // Use the actual value from FTS table
        size: undefined,
        modified: undefined
      }));
    };

    // Helper function to check if a filename is a system file
    const isSystemFile = (fileName: string): boolean => {
      // Exact-name system entries
      const exactNames = new Set([
        '.DS_Store',
        '.Spotlight-V100',
        '.Trashes',
        '.fseventsd',
        '.TemporaryItems',
        'System Volume Information',
        '$RECYCLE.BIN',
      ]);
      if (exactNames.has(fileName)) return true;
      // AppleDouble resource fork files created on macOS when writing to non-HFS volumes
      if (fileName.startsWith('._')) return true;
      return false;
    };

    const countLike = (likeTerm: string, driveFilter?: string[], hideSystemFiles?: boolean) => {
      let countSql = `SELECT COUNT(*) as c FROM files_fts JOIN drives d ON d.id = files_fts.drive_id WHERE d.deleted = 0 AND files_fts.name LIKE ?`;
      const params: any[] = [likeTerm];
      if (driveFilter && driveFilter.length) {
        countSql += ` AND files_fts.drive_id IN (${driveFilter.map(() => '?').join(',')})`;
        params.push(...driveFilter);
      }
      if (hideSystemFiles) {
        countSql += ` AND files_fts.name NOT IN ('.DS_Store', '.Spotlight-V100', '.Trashes', '.fseventsd', '.TemporaryItems', 'System Volume Information', '$RECYCLE.BIN') AND files_fts.name NOT LIKE '._%'`;
      }
      const c = this.catalogDb!.prepare(countSql).get(...params) as any;
      return c?.c || 0;
    };

    // Attempt MATCH first (if eligible)
    let mode: 'MATCH' | 'LIKE' = 'LIKE';
    try {
      const matchExpr = tryMatch(query);
      if (matchExpr) {
        mode = 'MATCH';
        let sql = `
          SELECT files_fts.name as fileName, files_fts.drive_id as driveId, files_fts.path as fullPath, files_fts.is_directory as isDirectory
          FROM files_fts
          JOIN drives d ON d.id = files_fts.drive_id
          WHERE d.deleted = 0 AND files_fts.name MATCH ?
        `;
        const params: any[] = [matchExpr];
        if (driveFilter && driveFilter.length) {
          sql += ` AND files_fts.drive_id IN (${driveFilter.map(() => '?').join(',')})`;
          params.push(...driveFilter);
        }
        if (hideSystemFiles) {
          sql += ` AND files_fts.name NOT IN ('.DS_Store', '.Spotlight-V100', '.Trashes', '.fseventsd', '.TemporaryItems', 'System Volume Information', '$RECYCLE.BIN') AND files_fts.name NOT LIKE '._%'`;
          log('debug', `MATCH query with system files filter: ${sql}`);
        } else {
          log('debug', `MATCH query without system files filter: ${sql}`);
        }
        sql += ` ORDER BY bm25(files_fts) LIMIT ? OFFSET ?`;
        params.push(safeLimit, safeOffset);
        const rows = runQuery(sql, params);

        // Debug: Log final results for MATCH
        log('debug', '[SearchPaged] MATCH final results:', rows.slice(0, 3).map(r => ({
          fileName: r.fileName,
          isDirectory: r.isDirectory,
          driveId: r.driveId
        })));

        // total count for MATCH
        let countSql = `SELECT COUNT(*) as c FROM files_fts JOIN drives d ON d.id = files_fts.drive_id WHERE d.deleted = 0 AND files_fts.name MATCH ?`;
        const countParams: any[] = [matchExpr];
        if (driveFilter && driveFilter.length) {
          countSql += ` AND files_fts.drive_id IN (${driveFilter.map(() => '?').join(',')})`;
          countParams.push(...driveFilter);
        }
        if (hideSystemFiles) {
          countSql += ` AND files_fts.name NOT IN ('.DS_Store', '.Spotlight-V100', '.Trashes', '.fseventsd', '.TemporaryItems', 'System Volume Information', '$RECYCLE.BIN') AND files_fts.name NOT LIKE '._%'`;
          log('debug', `MATCH count query with system files filter: ${countSql}`);
        } else {
          log('debug', `MATCH count query without system files filter: ${countSql}`);
        }
        const c = this.catalogDb!.prepare(countSql).get(...countParams) as any;
        const total = c?.c || 0;
        const timeMs = Date.now() - start;
        log('debug', `mode=MATCH total=${total} rows=${rows.length} offset=${safeOffset} limit=${safeLimit} timeMs=${timeMs}`);
        return { rows, total, mode };
      }
    } catch (e) {
      // fall back to LIKE
    }

    // LIKE fallback (or for very short queries)
    mode = 'LIKE';
    
    // For single characters, use prefix search for better performance
    let likeTerm: string;
    if (query.length === 1) {
      // Block problematic single character searches
      if (query === '.' || query === '*' || query === '?' || query === '%' || query === '_') {
        log('debug', `Blocked problematic single character search: "${query}"`);
        return { rows: [], total: 0, mode: 'BLOCKED' as any };
      }
      
      likeTerm = `${query}%`; // Starts with the character (e.g., "a%")
      log('debug', `Single character search "${query}", using prefix search: ${likeTerm}`);
    } else {
      likeTerm = `%${query}%`; // Contains the characters anywhere (e.g., "%ab%")
    }
    
    let sql = `
      SELECT files_fts.name as fileName, files_fts.drive_id as driveId, files_fts.path as fullPath, files_fts.is_directory as isDirectory
      FROM files_fts
      JOIN drives d ON d.id = files_fts.drive_id
      WHERE d.deleted = 0 AND files_fts.name LIKE ?
    `;
    const params: any[] = [likeTerm];
    if (driveFilter && driveFilter.length) {
      sql += ` AND files_fts.drive_id IN (${driveFilter.map(() => '?').join(',')})`;
      params.push(...driveFilter);
    }
    if (hideSystemFiles) {
      sql += ` AND files_fts.name NOT IN ('.DS_Store', '.Spotlight-V100', '.Trashes', '.fseventsd', '.TemporaryItems', 'System Volume Information', '$RECYCLE.BIN') AND files_fts.name NOT LIKE '._%'`;
    }
    sql += ` ORDER BY files_fts.name LIMIT ? OFFSET ?`;
    params.push(safeLimit, safeOffset);
    const rows = runQuery(sql, params);
    
    // Debug: Log final results for LIKE
    log('debug', '[SearchPaged] LIKE final results:', rows.slice(0, 3).map(r => ({
      fileName: r.fileName,
      isDirectory: r.isDirectory,
      driveId: r.driveId
    })));
    
    const total = countLike(likeTerm, driveFilter, hideSystemFiles);
    const timeMs = Date.now() - start;
    log('debug', `mode=LIKE total=${total} rows=${rows.length} offset=${safeOffset} limit=${safeLimit} timeMs=${timeMs} query="${query}" likeTerm="${likeTerm}"`);
    return { rows, total, mode };
  }

  // Get full file details for navigation (called when user clicks search result)
  async getFileDetailsForNavigation(fileName: string, driveId: string, filePath: string): Promise<SearchResult | null> {
    try {
      log('debug', `Getting full details for ${fileName} on drive ${driveId}`);
      log('debug', `Using filePath: ${filePath}`);
      
      // Get drive name from catalog database
      const driveInfo = this.catalogDb?.prepare(`
        SELECT name FROM drives WHERE id = ? AND deleted = 0
      `).get(driveId) as any;
      
      if (!driveInfo) {
        console.warn(`[Navigation] Drive ${driveId} not found or deleted`);
        return null;
      }

      // Get full file details from the specific drive database
      const driveDb = await this.getDriveDb(driveId);
      if (!driveDb) {
        console.warn(`[Navigation] Drive database not found for ${driveId}`);
        return null;
      }

      const fileDetails = driveDb.prepare(`
        SELECT * FROM files 
        WHERE name = ? AND drive_id = ? AND path = ? AND deleted = 0
      `).get(fileName, driveId, filePath) as any;

      if (!fileDetails) {
        console.warn(`[Navigation] File not found: ${fileName} on drive ${driveId} with path: ${filePath}`);
        log('debug', `Available paths in drive database:`);
        const samplePaths = driveDb.prepare(`SELECT path FROM files WHERE name = ? AND drive_id = ? LIMIT 5`).all(fileName, driveId) as any[];
        samplePaths.forEach(p => console.log(`  - ${p.path}`));
        return null;
      }

      log('debug', `Found file details for navigation`);
      
      return {
        fileId: fileDetails.id,
        driveId: driveId,
        driveName: driveInfo.name,
        fileName: fileName,
        fullPath: filePath,
        isDirectory: !!fileDetails.is_directory,
        size: fileDetails.size,
        modified: fileDetails.modified || undefined
      };

    } catch (error) {
      console.error(`[Navigation] Failed to get file details for navigation:`, error);
      return null;
    }
  }

  async buildSearchIndex(): Promise<void> {
    // Search index is built automatically via triggers
    // This method exists for compatibility
  }

  async populateSearchIndex(): Promise<void> {
    if (!this.catalogDb) throw new Error('Catalog database not initialized');

    log('debug', 'Starting search index population...');

    try {
      // Clear existing index
      this.catalogDb.prepare(`DELETE FROM files_fts`).run();

      // Get all active files from all drives
      let totalIndexed = 0;
      for (const [driveId, driveDb] of this.driveDbs) {
        const files = driveDb.prepare(`
          SELECT name, path FROM files WHERE deleted = 0
        `).all() as any[];

        log('debug', `Indexing ${files.length} files from drive ${driveId}`);

        // Insert into search index - consistent with scan-time indexing
        const insertStmt = this.catalogDb.prepare(`
          INSERT INTO files_fts (name, drive_id, path, is_directory) VALUES (?, ?, ?, ?)
        `);

        for (const file of files) {
          insertStmt.run(file.name, driveId, file.path, file.isDirectory ? 1 : 0);
          totalIndexed++;
        }
      }

      log('debug', `Search index population completed with ${totalIndexed} files`);
    } catch (error) {
      console.error('[Search] Error populating search index:', error);
      throw error;
    }
  }

  async getSearchIndexStatus(): Promise<{ isBuilt: boolean; totalIndexed: number; totalFiles?: number; inSync?: boolean }> {
    if (!this.catalogDb) throw new Error('Catalog database not initialized');

    const indexedCount = this.catalogDb.prepare(`SELECT COUNT(*) as c FROM files_fts`).get() as any;
    
    // Count total files across all drives
    let totalFiles = 0;
    for (const driveDb of this.driveDbs.values()) {
      const count = driveDb.prepare(`SELECT COUNT(*) as c FROM files WHERE deleted = 0`).get() as any;
      totalFiles += count.c;
    }

    return {
      isBuilt: indexedCount.c > 0,
      totalIndexed: indexedCount.c,
      totalFiles,
      inSync: indexedCount.c === totalFiles
    };
  }

  async checkSearchIndexHealth(): Promise<{ healthy: boolean; totalFiles: number; totalIndexed: number; activeDrives: number; issues: string[] }> {
    if (!this.catalogDb) throw new Error('Catalog database not initialized');

    const status = await this.getSearchIndexStatus();
    const activeDrives = this.driveDbs.size;
    const issues: string[] = [];

    if (!status.isBuilt) {
      issues.push('Search index is not built');
    }
    if (!status.inSync) {
      issues.push(`Search index out of sync: ${status.totalIndexed} indexed vs ${status.totalFiles} total files`);
    }
    if (activeDrives === 0) {
      issues.push('No active drives found');
    }

    return {
      healthy: issues.length === 0,
      totalFiles: status.totalFiles || 0,
      totalIndexed: status.totalIndexed,
      activeDrives,
      issues
    };
  }

  // Test method to verify search is working
  async testSearch(query: string): Promise<{ success: boolean; results: number; error?: string }> {
    try {
      log('debug', `Testing search for: "${query}"`);
      
      // Debug: Let's see what's actually in the files_fts table
      if (this.catalogDb) {
        try {
          log('debug', 'Checking files_fts table structure...');
          
          // Check table info
          const tableInfo = this.catalogDb.prepare(`PRAGMA table_info(files_fts)`).all() as any[];
          log('debug', 'files_fts table structure:', tableInfo);
          
          // Check if we can query the table at all
          const count = this.catalogDb.prepare(`SELECT COUNT(*) as count FROM files_fts`).get() as any;
          log('debug', 'Total files in FTS:', count.count);
          
          // Try to get a few sample rows
          const sampleData = this.catalogDb.prepare(`SELECT * FROM files_fts LIMIT 3`).all() as any[];
          log('debug', 'Sample data from files_fts:', sampleData);
          
          // Try to query specific columns
          try {
            const nameTest = this.catalogDb.prepare(`SELECT name FROM files_fts LIMIT 1`).get() as any;
            log('debug', 'name column test:', nameTest);
          } catch (e) {
            log('debug', 'name column failed:', e);
          }
          
          try {
            const driveIdTest = this.catalogDb.prepare(`SELECT drive_id FROM files_fts LIMIT 1`).get() as any;
            log('debug', 'drive_id column test:', driveIdTest);
          } catch (e) {
            log('debug', 'drive_id column failed:', e);
          }
          
          try {
            const pathTest = this.catalogDb.prepare(`SELECT path FROM files_fts LIMIT 1`).get() as any;
            log('debug', 'path column test:', pathTest);
          } catch (e) {
            log('debug', 'path column failed:', e);
          }
          
        } catch (error) {
          console.warn('[Search Test] Could not inspect files_fts table:', error);
        }
      }
      
      // Don't call searchFiles yet - let's see the table structure first
      log('debug', `Table inspection complete - check console for details`);
      return { success: true, results: 0, error: 'Table inspection complete - check console' };
      
    } catch (error: any) {
      console.error(`[Search Test] Search failed:`, error);
      return { success: false, results: 0, error: error.message };
    }
  }

  // File deletion operations
  async softDeleteFile(fileId: string, reason: 'file_removed' | 'drive_deleted' | 'system'): Promise<void> {
    // Find which drive this file belongs to
    for (const [driveId, driveDb] of this.driveDbs) {
      const file = driveDb.prepare(`
        SELECT id, name, path FROM files WHERE id = ?
      `).get(fileId) as any;

      if (file) {
        // Hard delete: remove file completely
        driveDb.prepare(`
          DELETE FROM files WHERE id = ?
        `).run(fileId);

        // Remove from search index using file path and drive ID
        if (this.catalogDb) {
          this.catalogDb.prepare(`
            DELETE FROM files_fts WHERE drive_id = ? AND path = ?
          `).run(driveId, file.path);
        }
        return;
      }
    }
  }

  async softDeleteFilesByPath(driveId: string, filePath: string, reason: 'file_removed' | 'drive_deleted' | 'system'): Promise<number> {
    const driveDb = await this.getDriveDb(driveId);
    if (!driveDb) return 0;

    // Hard delete: remove files completely
    const result = driveDb.prepare(`
      DELETE FROM files WHERE drive_id = ? AND path = ?
    `).run(driveId, filePath);

    // Remove from search index
    if (this.catalogDb) {
      this.catalogDb.prepare(`
        DELETE FROM files_fts WHERE drive_id = ? AND path = ?
      `).run(driveId, filePath);
    }

    return result.changes;
  }

  // Recovery functionality removed for MVP

  async getDeletedFiles(driveId?: string): Promise<Array<{
    id: string;
    name: string;
    path: string;
    driveId: string;
    deletedAt: string;
    deletionReason: string;
    size: number;
    isDirectory: boolean;
  }>> {
    const deletedFiles: Array<{
      id: string;
      name: string;
      path: string;
      driveId: string;
      deletedAt: string;
      deletionReason: string;
      size: number;
      isDirectory: boolean;
    }> = [];

    if (driveId) {
      const driveDb = await this.getDriveDb(driveId);
      if (driveDb) {
        const files = driveDb.prepare(`
          SELECT id, name, path, deleted_at, deletion_reason, size, is_directory
          FROM files WHERE deleted = 1
        `).all() as any[];

        deletedFiles.push(...files.map(f => ({
          id: f.id,
          name: f.name,
          path: f.path,
          driveId,
          deletedAt: f.deleted_at,
          deletionReason: f.deletion_reason,
          size: f.size || 0,
          isDirectory: !!f.is_directory
        })));
      }
    } else {
      // Get deleted files from all drives
      for (const [driveId, driveDb] of this.driveDbs) {
        const files = driveDb.prepare(`
          SELECT id, name, path, deleted_at, deletion_reason, size, is_directory
          FROM files WHERE deleted = 1
        `).all() as any[];

        deletedFiles.push(...files.map(f => ({
          id: f.id,
          name: f.name,
          path: f.path,
          driveId,
          deletedAt: f.deleted_at,
          deletionReason: f.deletion_reason,
          size: f.size || 0,
          isDirectory: !!f.is_directory
        })));
      }
    }

    return deletedFiles;
  }

  async permanentlyDeleteFile(fileId: string): Promise<void> {
    // Find which drive this file belongs to
    for (const [driveId, driveDb] of this.driveDbs) {
      const file = driveDb.prepare(`
        SELECT rowid FROM files WHERE id = ?
      `).get(fileId) as any;

      if (file) {
        // Remove from search index first
        if (this.catalogDb) {
          this.catalogDb.prepare(`DELETE FROM files_fts WHERE rowid = ?`).run(file.rowid);
        }

        // Permanently delete the file
        driveDb.prepare(`DELETE FROM files WHERE id = ?`).run(fileId);
        return;
      }
    }
  }

  async cleanupSoftDeletedRecords(): Promise<{ deletedFiles: number; deletedDrives: number; freedSpace: number }> {
    if (!this.catalogDb) throw new Error('Catalog database not initialized');
    
    let totalDeletedFiles = 0;
    let totalFreedSpace = 0;
    
    // Clean up files from each drive database
    for (const [driveId, driveDb] of this.driveDbs) {
      const tx = driveDb.transaction(() => {
        // Get counts and size before deletion
        const deletedFilesCount = driveDb.prepare(`SELECT COUNT(*) as count FROM files WHERE deleted = 1`).get() as any;
        const deletedFilesSize = driveDb.prepare(`
          SELECT COALESCE(SUM(size), 0) as total_size 
          FROM files 
          WHERE deleted = 1 AND size IS NOT NULL
        `).get() as any;
        
        if (deletedFilesCount.count > 0) {
          // Hard delete all soft-deleted files
          const filesDeleted = driveDb.prepare(`DELETE FROM files WHERE deleted = 1`).run();
          
          return {
            deletedFiles: filesDeleted.changes,
            freedSpace: deletedFilesSize.total_size
          };
        }
        
        return { deletedFiles: 0, freedSpace: 0 };
      });
      
      const result = tx();
      totalDeletedFiles += result.deletedFiles;
      totalFreedSpace += result.freedSpace;
    }
    
    // Clean up drives from catalog database
    // First, create backups for soft-deleted drives before deletion
    if (this.backupManager) {
      const deletedDrives = this.catalogDb.prepare(`SELECT * FROM drives WHERE deleted = 1`).all() as any[];
      
      for (const drive of deletedDrives) {
        try {
          const userStorageDir = this.getUserStorageDir();
          const driveDbPath = path.join(userStorageDir, `drive_${drive.id}.db`);
          
          if (await fs.pathExists(driveDbPath)) {
            await this.backupManager.backupDrive(
              drive.id, 
              drive.name || `Drive ${drive.id}`, 
              driveDbPath
            );
            log('debug', `Backup created for soft-deleted drive ${drive.id}`);
          }
        } catch (error: any) {
          console.error(`[cleanupSoftDeletedRecords] Failed to backup drive ${drive.id}:`, error.message);
          // Continue with cleanup even if backup fails
        }
      }
    }

    const catalogTx = this.catalogDb.transaction(() => {
      // Get counts before deletion
      const deletedDrivesCount = this.catalogDb!.prepare(`SELECT COUNT(*) as count FROM drives WHERE deleted = 1`).get() as any;
      
      if (deletedDrivesCount.count > 0) {
        // Remove soft-deleted files from search index
        this.catalogDb!.prepare(`
          DELETE FROM files_fts 
          WHERE drive_id IN (SELECT id FROM drives WHERE deleted = 1)
        `).run();
        
        // Hard delete all soft-deleted drives
        const drivesDeleted = this.catalogDb!.prepare(`DELETE FROM drives WHERE deleted = 1`).run();
        
        return drivesDeleted.changes;
      }
      
      return 0;
    });
    
    const deletedDrives = catalogTx();
    
    // Run VACUUM on catalog database to reclaim disk space
    this.catalogDb.exec('VACUUM');
    
    // Run VACUUM on each drive database
    for (const [driveId, driveDb] of this.driveDbs) {
      driveDb.exec('VACUUM');
    }
    
    if (totalDeletedFiles > 0 || deletedDrives > 0) {
      log('info', `Cleanup completed: ${totalDeletedFiles} files, ${deletedDrives} drives, ${(totalFreedSpace / (1024 * 1024 * 1024)).toFixed(2)} GB freed`);
    }
    
    return {
      deletedFiles: totalDeletedFiles,
      deletedDrives: deletedDrives,
      freedSpace: totalFreedSpace
    };
  }

  // Legacy recovery methods removed - using backup/restore system instead

  // Recovery functionality removed for MVP

  // Cache operations (stub implementations)
  async clearSizeCache(): Promise<{ success: boolean }> {
    return { success: true };
  }

  async clearMemoryCache(): Promise<{ success: boolean; error?: string }> {
    return { success: true };
  }

  // Progress reporting
  onScanProgress(callback: (progress: ScanProgress) => void): void {
    this.scanProgressCallbacks.push(callback);
  }

  private emitScanProgress(progress: ScanProgress): void {
    for (const callback of this.scanProgressCallbacks) {
      callback(progress);
    }
  }

  // Utility functions (stub implementations)
  async formatBytes(bytes: number): Promise<string> {
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0) return '0 Bytes';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  }

  async formatDate(dateString: string): Promise<string> {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString();
    } catch {
      return dateString;
    }
  }

  async getStoredMetadata(folderPath: string): Promise<FileInfo[]> {
    const files: FileInfo[] = [];
    
    // Search across all active drives
    for (const [driveId, driveDb] of this.driveDbs) {
      const driveFiles = driveDb.prepare(`
        SELECT * FROM files 
        WHERE parent_path = ? AND deleted = 0
        ORDER BY is_directory DESC, name ASC
      `).all(folderPath) as any[];
      
      files.push(...driveFiles.map(file => ({
        id: file.id,
        name: file.name,
        path: file.path,
        parentPath: file.parent_path,
        size: file.size,
        created: file.created,
        modified: file.modified,
        isDirectory: !!file.is_directory,
        folderPath: file.folder_path,
        driveId: file.drive_id,
        depth: file.depth,
        inode: file.inode,
        hardLinkCount: file.hard_link_count,
        isHardLink: !!file.is_hard_link,
        hardLinkGroup: file.hard_link_group,
        file_type: file.file_type
      })));
    }
    
    return files;
  }

  // Database management
  async getDatabaseSize(): Promise<{
    totalSize: number;
    fileCount: number;
    driveCount: number;
    needsSplitting: boolean;
    recommendation: string;
  }> {
    let totalSize = 0;
    let totalFileCount = 0;
    const driveCount = this.driveDbs.size;

    // Get catalog database size
    if (this.catalogDb) {
      const catalogPath = path.join(this.storageDir, 'catalog.db');
      if (await fs.pathExists(catalogPath)) {
        const stats = await fs.stat(catalogPath);
        totalSize += stats.size;
      }
    }

    // Get per-drive database sizes
    for (const [driveId, driveDb] of this.driveDbs) {
      const driveDbPath = await this.getDriveDatabasePath(driveId);
      if (await fs.pathExists(driveDbPath)) {
        const stats = await fs.stat(driveDbPath);
        totalSize += stats.size;
      }

      // Count files in this drive
      const fileCount = driveDb.prepare(`SELECT COUNT(*) as c FROM files WHERE deleted = 0`).get() as any;
      totalFileCount += fileCount.c;
    }

    const needsSplitting = totalSize > 500 * 1024 * 1024 || totalFileCount > 8000000;
    
    let recommendation = 'Database size is optimal';
    if (needsSplitting) {
      if (totalSize > 500 * 1024 * 1024) {
        recommendation = 'Database size exceeds 500MB - consider splitting by drive';
      } else {
        recommendation = 'File count exceeds 8M - consider splitting by drive';
      }
    }

    return {
      totalSize,
      fileCount: totalFileCount,
      driveCount,
      needsSplitting,
      recommendation
    };
  }

  async close(): Promise<void> {
    log('info', `Closing storage manager for user: ${this.userId}...`);
    
    try {
      // Close all drive databases with enhanced error handling
      log('info', `Closing ${this.driveDbs.size} drive databases...`);
      const closeErrors: string[] = [];
      
      for (const [driveId, driveDb] of this.driveDbs.entries()) {
        try {
          driveDb.close();
          log('info', `Closed drive database: ${driveId}`);
        } catch (error) {
          const errorMsg = `Error closing drive database ${driveId}: ${error instanceof Error ? error.message : String(error)}`;
          log('warn', errorMsg);
          closeErrors.push(errorMsg);
        }
      }
      this.driveDbs.clear();
      log('info', 'All drive databases closed');

      // Close catalog database with enhanced error handling
      if (this.catalogDb) {
        try {
          this.catalogDb.close();
          log('info', 'Catalog database closed');
        } catch (error) {
          const errorMsg = `Error closing catalog database: ${error instanceof Error ? error.message : String(error)}`;
          log('warn', errorMsg);
          closeErrors.push(errorMsg);
        }
        this.catalogDb = null;
      }
      
      // Clear user ID to prevent further operations
      this.userId = null;
      
      if (closeErrors.length > 0) {
        log('warn', `Storage manager closed with ${closeErrors.length} errors:`, closeErrors);
      } else {
        log('info', 'Storage manager closed successfully');
      }
    } catch (error) {
      log('error', 'Error during storage manager close:', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  // Sync operations
  async backupDrive(driveId: string): Promise<{ success: boolean; error?: string }> {
    const startTime = Date.now();
    log('info', `===== STARTING BACKUP OPERATION =====`);
    log('info', `Drive ID: ${driveId}`);
    log('info', `Storage directory: ${this.storageDir}`);
    
    try {
      const driveDb = await this.getDriveDb(driveId);
      if (!driveDb) {
        console.error(`[Backup] Drive database not found in memory for drive: ${driveId}`);
        return { success: false, error: `Drive database not found for drive: ${driveId}` };
      }

      const sourcePath = await this.getDriveDatabasePath(driveId);
      const backupPath = this.getDriveBackupPath(driveId);
      
      log('info', `Source database path: ${sourcePath}`);
      log('info', `Backup database path: ${backupPath}`);
      
      // Check if source database exists
      if (!(await fs.pathExists(sourcePath))) {
        console.error(`[Backup] Source database file does not exist: ${sourcePath}`);
        return { success: false, error: `Source database file not found: ${sourcePath}` };
      }
      
      // Get source file size
      const sourceStats = await fs.stat(sourcePath);
      log('info', `Source database size: ${sourceStats.size} bytes`);
      
      // Close the database connection temporarily to allow file operations
      log('info', `Closing database connection for file operations...`);
      log('debug', `Closing database connection for drive: ${driveId}`);
      driveDb.close();
      log('info', `Database connection closed successfully`);
      log('debug', `Database connection closed for drive: ${driveId}`);
      
      try {
        // Copy the database file
        log('info', `Copying database file...`);
        const copyStartTime = Date.now();
        await fs.copy(sourcePath, backupPath);
        const copyDuration = Date.now() - copyStartTime;
        log('info', `Database file copied successfully in ${copyDuration}ms`);
        
        // Verify backup file
        const backupStats = await fs.stat(backupPath);
        log('info', `Backup file size: ${backupStats.size} bytes`);
        log('info', `Size verification: ${sourceStats.size === backupStats.size ? 'PASSED' : 'FAILED'}`);
        
        // Now backup the FTS index for this drive from catalog.db
        log('info', `===== BACKING UP FTS INDEX =====`);
        const ftsBackupStartTime = Date.now();
        
        if (this.catalogDb) {
          try {
            // Export FTS entries for this specific drive
            const ftsBackupPath = this.getDriveFTSBackupPath(driveId);
            log('info', `FTS backup path: ${ftsBackupPath}`);
            
            // Create a temporary database for FTS backup
            const ftsBackupDb = new Database(ftsBackupPath);
            
            // Create the FTS backup schema
            ftsBackupDb.exec(`
              CREATE TABLE IF NOT EXISTS files_fts_backup (
                drive_id TEXT NOT NULL,
                file_path TEXT NOT NULL,
                file_name TEXT NOT NULL,
                content TEXT,
                PRIMARY KEY (drive_id, file_path)
              );
            `);
            
            // Export FTS data for this drive
            const ftsStmt = ftsBackupDb.prepare(`
              INSERT INTO files_fts_backup (drive_id, file_path, file_name, content)
              SELECT drive_id, file_path, file_name, content 
              FROM files_fts 
              WHERE drive_id = ?
            `);
            
            const ftsResult = ftsStmt.run(driveId);
            log('info', `FTS entries backed up: ${ftsResult.changes} rows`);
            
            // Verify FTS backup
            const ftsBackupStats = await fs.stat(ftsBackupPath);
            log('info', `FTS backup file size: ${ftsBackupStats.size} bytes`);
            
            ftsBackupDb.close();
            
            const ftsBackupDuration = Date.now() - ftsBackupStartTime;
            log('info', `FTS index backup completed in ${ftsBackupDuration}ms`);
            log('info', `===== FTS INDEX BACKUP COMPLETE =====`);
            
          } catch (ftsError: any) {
            console.error(`[Backup] FTS backup failed:`, ftsError.message);
            console.error(`[Backup] FTS backup error stack:`, ftsError.stack);
            // Don't fail the entire backup if FTS backup fails
            console.warn(`[Backup] Continuing with database backup despite FTS backup failure`);
          }
        } else {
          console.warn(`[Backup] Catalog database not available, skipping FTS backup`);
        }
        
        // Reopen the database connection
        log('info', `Reopening database connection...`);
        const reopenStartTime = Date.now();
        log('debug', `Creating new database connection for drive: ${driveId}`);
        const newDriveDb = new Database(sourcePath);
        this.driveDbs.set(driveId, newDriveDb);
        const reopenDuration = Date.now() - reopenStartTime;
        log('info', `Database connection reopened successfully in ${reopenDuration}ms`);
        log('debug', `New database connection established for drive: ${driveId}`);
        
        const totalDuration = Date.now() - startTime;
        log('info', `===== BACKUP OPERATION COMPLETED SUCCESSFULLY =====`);
        log('info', `Total duration: ${totalDuration}ms`);
        log('info', `Breakdown:`);
        log('info', `  - Copy operation: ${copyDuration}ms`);
        log('info', `  - FTS backup: ${Date.now() - ftsBackupStartTime}ms`);
        log('info', `  - Database operations: ${reopenDuration}ms`);
        log('info', `  - Other operations: ${totalDuration - copyDuration - (Date.now() - ftsBackupStartTime) - reopenDuration}ms`);
        log('info', `Successfully backed up drive ${driveId} to ${backupPath}`);
        
        return { success: true };
      } catch (copyError: any) {
        console.error(`[Backup] Copy operation failed:`, copyError.message);
        console.error(`[Backup] Copy error stack:`, copyError.stack);
        
        // If copy failed, try to reopen the original database
        log('info', `Attempting to reopen original database after copy failure...`);
        try {
          const reopenStartTime = Date.now();
          const newDriveDb = new Database(sourcePath);
          this.driveDbs.set(driveId, newDriveDb);
          const reopenDuration = Date.now() - reopenStartTime;
          log('info', `Original database reopened successfully in ${reopenDuration}ms`);
        } catch (reopenError: any) {
          console.error(`[Backup] Failed to reopen drive database after backup failure:`, reopenError.message);
          console.error(`[Backup] Reopen error stack:`, reopenError.stack);
        }
        
        return { success: false, error: `Failed to create backup: ${copyError.message}` };
      }
    } catch (error: any) {
      const totalDuration = Date.now() - startTime;
      console.error(`[Backup] ===== BACKUP OPERATION FAILED =====`);
      console.error(`[Backup] Total duration: ${totalDuration}ms`);
      console.error(`[Backup] Error type: ${error.constructor.name}`);
      console.error(`[Backup] Error message: ${error.message}`);
      console.error(`[Backup] Error stack:`, error.stack);
      return { success: false, error: `Backup operation failed: ${error.message}` };
    }
  }

  async cleanupBackupFiles(driveId: string): Promise<{ success: boolean; error?: string }> {
    const startTime = Date.now();
    log('debug', `===== STARTING BACKUP CLEANUP =====`);
    log('debug', `Drive ID: ${driveId}`);
    log('debug', `Storage directory: ${this.storageDir}`);
    
    try {
      const backupPath = this.getDriveBackupPath(driveId);
      const ftsBackupPath = this.getDriveFTSBackupPath(driveId);
      
      log('debug', `Database backup path: ${backupPath}`);
      log('debug', `FTS backup path: ${ftsBackupPath}`);
      
      let filesRemoved = 0;
      let totalSize = 0;
      
      // Remove database backup file
      if (await fs.pathExists(backupPath)) {
        const stats = await fs.stat(backupPath);
        await fs.remove(backupPath);
        filesRemoved++;
        totalSize += stats.size;
        log('debug', `Database backup file removed: ${backupPath}`);
      } else {
        log('debug', `Database backup file not found: ${backupPath}`);
      }
      
      // Remove FTS backup file
      if (await fs.pathExists(ftsBackupPath)) {
        const stats = await fs.stat(ftsBackupPath);
        await fs.remove(ftsBackupPath);
        filesRemoved++;
        totalSize += stats.size;
        log('debug', `FTS backup file removed: ${ftsBackupPath}`);
      } else {
        log('debug', `FTS backup file not found: ${ftsBackupPath}`);
      }
      
      const totalDuration = Date.now() - startTime;
      log('debug', `===== BACKUP CLEANUP COMPLETED SUCCESSFULLY =====`);
      log('debug', `Total duration: ${totalDuration}ms`);
      log('debug', `Files removed: ${filesRemoved}`);
      log('debug', `Total size freed: ${totalSize} bytes`);
      
      return { success: true };
    } catch (error: any) {
      const totalDuration = Date.now() - startTime;
      console.error(`[Cleanup] ===== BACKUP CLEANUP FAILED =====`);
      console.error(`[Cleanup] Total duration: ${totalDuration}ms`);
      console.error(`[Cleanup] Error type: ${error.constructor.name}`);
      console.error(`[Cleanup] Error message: ${error.message}`);
      console.error(`[Cleanup] Error stack:`, error.stack);
      return { success: false, error: `Backup cleanup failed: ${error.message}` };
    }
  }

  async verifyBackupExists(driveId: string): Promise<boolean> {
    try {
      const backupPath = this.getDriveBackupPath(driveId);
      const ftsBackupPath = this.getDriveFTSBackupPath(driveId);
      
      const dbBackupExists = await fs.pathExists(backupPath);
      const ftsBackupExists = await fs.pathExists(ftsBackupPath);
      
      log('debug', `Database backup exists: ${dbBackupExists}`);
      log('debug', `FTS backup exists: ${ftsBackupExists}`);
      log('debug', `Database backup path: ${backupPath}`);
      log('debug', `FTS backup path: ${ftsBackupPath}`);
      
      if (dbBackupExists && ftsBackupExists) {
        // Verify backup files have content
        try {
          const dbBackupStats = await fs.stat(backupPath);
          const ftsBackupStats = await fs.stat(ftsBackupPath);
          
          log('debug', `Database backup size: ${dbBackupStats.size} bytes`);
          log('debug', `FTS backup size: ${ftsBackupStats.size} bytes`);
          
          const isValidBackup = dbBackupStats.size > 0 && ftsBackupStats.size > 0;
          log('debug', `Backup files are valid: ${isValidBackup}`);
          
          return isValidBackup;
        } catch (statError: any) {
          console.error(`[Backup Verification] Error checking backup file stats:`, statError.message);
          return false;
        }
      }
      
      return false;
    } catch (error: any) {
      console.error(`[Backup Verification] Error checking backup existence:`, error.message);
      return false;
    }
  }

  async restoreDriveFromBackup(driveId: string): Promise<{ success: boolean; error?: string }> {
    const startTime = Date.now();
    log('info', `===== STARTING RESTORE OPERATION =====`);
    log('info', `Drive ID: ${driveId}`);
    log('info', `Storage directory: ${this.storageDir}`);
    
    try {
      const backupPath = this.getDriveBackupPath(driveId);
      const sourcePath = await this.getDriveDatabasePath(driveId);
      
      log('info', `Backup file path: ${backupPath}`);
      log('info', `Source file path: ${sourcePath}`);
      
      if (!(await fs.pathExists(backupPath))) {
        console.error(`[Restore] Backup file not found: ${backupPath}`);
        return { success: false, error: `Backup file not found for drive: ${driveId}` };
      }

      // Get backup file size
      const backupStats = await fs.stat(backupPath);
      log('info', `Backup file size: ${backupStats.size} bytes`);
      
      // Check if source file exists and get its size
      let sourceExists = false;
      let sourceSize = 0;
      try {
        if (await fs.pathExists(sourcePath)) {
          sourceExists = true;
          const stats = await fs.stat(sourcePath);
          sourceSize = stats.size;
          log('info', `Source file exists, current size: ${sourceSize} bytes`);
        } else {
          log('info', `Source file does not exist, will be created from backup`);
        }
      } catch (error) {
        console.warn(`[Restore] Could not check source file status:`, error);
      }

      // Close the current database connection
      log('info', `Closing current database connection...`);
      const currentDriveDb = this.driveDbs.get(driveId);
      if (currentDriveDb) {
        log('debug', `Closing existing database connection for drive: ${driveId}`);
        currentDriveDb.close();
        log('info', `Current database connection closed successfully`);
        log('debug', `Database connection closed for drive: ${driveId}`);
      } else {
        log('info', `No current database connection to close`);
        log('debug', `No existing database connection found for drive: ${driveId}`);
      }

      try {
        // Restore from backup
        log('info', `Copying backup to source location...`);
        const copyStartTime = Date.now();
        await fs.copy(backupPath, sourcePath);
        const copyDuration = Date.now() - copyStartTime;
        log('info', `Backup copied successfully in ${copyDuration}ms`);
        
        // Verify restored file
        const restoredStats = await fs.stat(sourcePath);
        log('info', `Restored file size: ${restoredStats.size} bytes`);
        log('info', `Size verification: ${backupStats.size === restoredStats.size ? 'PASSED' : 'FAILED'}`);
        
        // Confirm per-drive database restoration
        log('info', '✅ ===== PER-DRIVE DATABASE RESTORATION CONFIRMED =====');
        log('info', '✅ Drive database restored successfully');
        log('info', '✅ File size verification:', backupStats.size === restoredStats.size ? 'PASSED' : 'FAILED');
        
        // Now restore the FTS index for this drive
        log('info', `===== RESTORING FTS INDEX =====`);
        const ftsRestoreStartTime = Date.now();
        
        if (this.catalogDb) {
          try {
            const ftsBackupPath = this.getDriveFTSBackupPath(driveId);
            log('info', `FTS backup path: ${ftsBackupPath}`);
            
            if (await fs.pathExists(ftsBackupPath)) {
              // Clear existing FTS entries for this drive
              log('info', `Clearing existing FTS entries for drive ${driveId}...`);
              const clearStmt = this.catalogDb.prepare(`DELETE FROM files_fts WHERE drive_id = ?`);
              const clearResult = clearStmt.run(driveId);
              log('info', `Cleared ${clearResult.changes} existing FTS entries`);
              
              // Open FTS backup database and restore entries
              const ftsBackupDb = new Database(ftsBackupPath);
              
              // Get count of FTS entries to restore
              const countStmt = ftsBackupDb.prepare(`SELECT COUNT(*) as count FROM files_fts_backup WHERE drive_id = ?`);
              const countResult = countStmt.get(driveId) as { count: number } | undefined;
              const ftsCount = countResult ? countResult.count : 0;
              log('info', `Found ${ftsCount} FTS entries to restore`);
              
              if (ftsCount > 0) {
                // Restore FTS entries in batches
                const batchSize = 1000;
                const totalBatches = Math.ceil(ftsCount / batchSize);
                
                for (let i = 0; i < totalBatches; i++) {
                  const offset = i * batchSize;
                  const batchStmt = ftsBackupDb.prepare(`
                    SELECT drive_id, file_path, file_name, content 
                    FROM files_fts_backup 
                    WHERE drive_id = ? 
                    LIMIT ? OFFSET ?
                  `);
                  
                  const batch = batchStmt.all(driveId, batchSize, offset) as Array<{
                    drive_id: string;
                    file_path: string;
                    file_name: string;
                    content: string;
                  }>;
                  
                  // Insert batch into catalog.db
                  const insertStmt = this.catalogDb.prepare(`
                    INSERT INTO files_fts (drive_id, file_path, file_name, content)
                    VALUES (?, ?, ?, ?)
                  `);
                  
                  for (const row of batch) {
                    insertStmt.run(row.drive_id, row.file_path, row.file_name, row.content);
                  }
                  
                  log('info', `Restored FTS batch ${i + 1}/${totalBatches}: ${batch.length} entries`);
                }
                
                log('info', `Successfully restored ${ftsCount} FTS entries`);
              }
              
              ftsBackupDb.close();
              
              // Confirm FTS index restoration
              log('info', '✅ ===== FTS INDEX RESTORATION CONFIRMED =====');
              log('info', '✅ FTS entries restored:', ftsCount);
              log('info', '✅ FTS index now available in catalog.db for search');
              
              // Note: FTS backup file will be cleaned up by cleanupBackupFiles()
              // Don't remove it here to avoid conflicts with the cleanup process
              log('info', `FTS backup file preserved for coordinated cleanup`);
              
            } else {
              console.warn(`[Restore] FTS backup file not found, skipping FTS restoration`);
            }
            
            const ftsRestoreDuration = Date.now() - ftsRestoreStartTime;
            log('info', `FTS index restoration completed in ${ftsRestoreDuration}ms`);
            log('info', `===== FTS INDEX RESTORE COMPLETE =====`);
            
          } catch (ftsError: any) {
            console.error(`[Restore] FTS restoration failed:`, ftsError.message);
            console.error(`[Restore] FTS restoration error stack:`, ftsError.stack);
            // Don't fail the entire restore if FTS restore fails
            console.warn(`[Restore] Continuing with database restore despite FTS restore failure`);
          }
        } else {
          console.warn(`[Restore] Catalog database not available, skipping FTS restoration`);
        }
        
        // Reopen the restored database
        log('info', `Reopening restored database...`);
        const reopenStartTime = Date.now();
        log('debug', `Creating restored database connection for drive: ${driveId}`);
        const restoredDriveDb = new Database(sourcePath);
        this.driveDbs.set(driveId, restoredDriveDb);
        const reopenDuration = Date.now() - reopenStartTime;
        log('info', `Database reopened successfully in ${reopenDuration}ms`);
        log('debug', `Restored database connection established for drive: ${driveId}`);
        
        // Note: Main backup file will be cleaned up by cleanupBackupFiles()
        // Don't remove it here to avoid conflicts with the cleanup process
        log('info', `Main backup file preserved for coordinated cleanup`);
        const removeDuration = 0; // No removal time since we're not removing it
        
        const totalDuration = Date.now() - startTime;
        log('info', `===== RESTORE OPERATION COMPLETED SUCCESSFULLY =====`);
        log('info', `Total duration: ${totalDuration}ms`);
        log('info', `Breakdown:`);
        log('info', `  - Copy operation: ${copyDuration}ms`);
        log('info', `  - FTS restoration: ${Date.now() - ftsRestoreStartTime}ms`);
        log('info', `  - Database reopen: ${reopenDuration}ms`);
        log('info', `  - Backup cleanup: Coordinated (not during restore)`);
        log('info', `  - Other operations: ${totalDuration - copyDuration - (Date.now() - ftsRestoreStartTime) - reopenDuration}ms`);
        log('info', `Successfully restored drive ${driveId} from backup`);
        
        return { success: true };
      } catch (restoreError: any) {
        console.error(`[Restore] Restore operation failed:`, restoreError.message);
        console.error(`[Restore] Restore error stack:`, restoreError.stack);
        
        // If restore failed, try to reopen the original database
        log('info', `Attempting to reopen original database after restore failure...`);
        try {
          const reopenStartTime = Date.now();
          const newDriveDb = new Database(sourcePath);
          this.driveDbs.set(driveId, newDriveDb);
          const reopenDuration = Date.now() - reopenStartTime;
          log('info', `Original database reopened successfully in ${reopenDuration}ms`);
        } catch (reopenError: any) {
          console.error(`[Restore] Failed to reopen drive database after restore failure:`, reopenError.message);
          console.error(`[Restore] Reopen error stack:`, reopenError.stack);
        }
        
        return { success: false, error: `Failed to restore from backup: ${restoreError.message}` };
      }
    } catch (error: any) {
      const totalDuration = Date.now() - startTime;
      console.error(`[Restore] ===== RESTORE OPERATION FAILED =====`);
      console.error(`[Restore] Total duration: ${totalDuration}ms`);
      console.error(`[Restore] Error type: ${error.constructor.name}`);
      console.error(`[Restore] Error message: ${error.message}`);
      console.error(`[Restore] Error stack:`, error.stack);
      return { success: false, error: `Restore operation failed: ${error.message}` };
    }
  }

  async clearDriveFiles(driveId: string): Promise<void> {
    const startTime = Date.now();
    log('info', `===== CLEARING DRIVE FILES =====`);
    log('info', `Drive ID: ${driveId}`);
    
    const driveDb = await this.getDriveDb(driveId);
    if (!driveDb) {
      console.error(`[Clear] Drive database not found for drive: ${driveId}`);
      throw new Error(`Drive database not found for drive: ${driveId}`);
    }

    // Get file count before clearing
    log('debug', `Executing COUNT query for drive: ${driveId}`);
    const fileCountResult = driveDb.prepare(`SELECT COUNT(*) as count FROM files WHERE drive_id = ?`).get(driveId) as any;
    const fileCount = fileCountResult.count;
    log('info', `Found ${fileCount} files to clear for drive ${driveId}`);
    log('debug', `COUNT result: ${fileCount} files`);

    // Clear all files for this drive
    log('info', `Executing DELETE statement...`);
    log('debug', `Executing DELETE FROM files WHERE drive_id = ?`);
    const deleteStartTime = Date.now();
    const deleteResult = driveDb.prepare(`DELETE FROM files WHERE drive_id = ?`).run(driveId);
    const deleteDuration = Date.now() - deleteStartTime;
    
    log('info', `DELETE operation completed in ${deleteDuration}ms`);
    log('info', `Cleared ${deleteResult.changes} files from drive ${driveId}`);
    log('info', `Expected vs actual: ${fileCount} vs ${deleteResult.changes}`);
    
    const totalDuration = Date.now() - startTime;
    log('info', `===== DRIVE FILES CLEARED SUCCESSFULLY =====`);
    log('info', `Total duration: ${totalDuration}ms`);
  }

  async clearDriveFTS(driveId: string): Promise<void> {
    const startTime = Date.now();
    log('info', `===== CLEARING DRIVE FTS =====`);
    log('info', `Drive ID: ${driveId}`);
    
    if (!this.catalogDb) {
      console.error(`[Clear] Catalog database not initialized`);
      throw new Error('Catalog database not initialized');
    }

    // Get FTS entry count before clearing
    log('debug', `Executing COUNT query on FTS table for drive: ${driveId}`);
    const ftsCountResult = this.catalogDb.prepare(`SELECT COUNT(*) as count FROM files_fts WHERE drive_id = ?`).get(driveId) as any;
    const ftsCount = ftsCountResult.count;
    log('info', `Found ${ftsCount} FTS entries to clear for drive ${driveId}`);
    log('debug', `FTS COUNT result: ${ftsCount} entries`);

    // Clear FTS entries for this drive
    log('info', `Executing DELETE statement on FTS table...`);
    log('debug', `Executing DELETE FROM files_fts WHERE drive_id = ?`);
    const deleteStartTime = Date.now();
    const deleteResult = this.catalogDb.prepare(`DELETE FROM files_fts WHERE drive_id = ?`).run(driveId);
    const deleteDuration = Date.now() - deleteStartTime;
    
    log('info', `FTS DELETE operation completed in ${deleteDuration}ms`);
    log('info', `Cleared ${deleteResult.changes} FTS entries for drive ${driveId}`);
    log('info', `Expected vs actual: ${ftsCount} vs ${deleteResult.changes}`);
    
    const totalDuration = Date.now() - startTime;
    log('info', `===== DRIVE FTS CLEARED SUCCESSFULLY =====`);
    log('info', `Total duration: ${totalDuration}ms`);
  }

  // Simplified approach: Create numbered database directly
  async createNewScanDatabase(driveId: string): Promise<{ success: boolean; error?: string; newDbPath?: string }> {
    const startTime = Date.now();
    log('debug', `===== CREATING NEW NUMBERED SCAN DATABASE =====`);
    log('debug', `Drive ID: ${driveId}`);
    log('debug', `Storage directory: ${this.storageDir}`);
    
    try {
      // FIRST: Get current database path and determine new database path BEFORE any cleanup
      let currentDbPath: string | null = null;
      try {
        currentDbPath = await this.getCurrentDriveDatabasePath(driveId);
        log('debug', `Found existing database to cleanup: ${currentDbPath}`);
      } catch (error) {
        log('debug', `No existing database found - this must be initial creation`);
      }
      
      // SECOND: Get the new database path BEFORE deleting anything
      const newDbPath = await this.getDriveDatabasePath(driveId);
      log('debug', `New numbered database path: ${newDbPath}`);
      
      // THIRD: If there's an existing database, create backup and delete it
      if (currentDbPath && await fs.pathExists(currentDbPath)) {
        log('debug', `===== CLEANING UP PREVIOUS DATABASE BEFORE SYNC =====`);
        
        // Close the current database connection if it exists
        if (this.driveDbs.has(driveId)) {
          log('debug', `Closing current database connection...`);
          const currentDb = this.driveDbs.get(driveId);
          if (currentDb) {
            currentDb.close();
            this.driveDbs.delete(driveId);
          }
        }
        
        // Create backup of the current database if backup manager is available
        if (this.backupManager) {
          log('debug', `Creating backup of current database before deletion...`);
          const drive = await this.getDriveById(driveId);
          const driveName = drive?.name || `Drive ${driveId}`;
          
          const backupSuccess = await this.backupManager.backupDrive(driveId, driveName, currentDbPath);
          if (backupSuccess) {
            log('debug', `Backup created successfully for previous database`);
          } else {
            log('warn', `Failed to create backup of previous database - continuing anyway`);
          }
        } else {
          log('warn', `No backup manager available - skipping backup of previous database`);
        }
        
        // Delete the previous database file
        log('debug', `Deleting previous database file: ${currentDbPath}`);
        try {
          await fs.remove(currentDbPath);
          log('debug', `Previous database deleted successfully`);
        } catch (deleteError: any) {
          log('warn', `Failed to delete previous database: ${deleteError.message} - continuing anyway`);
        }
        
        log('debug', `===== PREVIOUS DATABASE CLEANUP COMPLETE =====`);
      }
      
      // FOURTH: Now create the new database (path was determined before cleanup)
      
      // Create new per-drive database with correct numbered name
      const newDb = new Database(newDbPath);
      log('debug', `New numbered database connection established`);
      
      // Create the schema for the new database
      this.createDriveSchema(newDb);
      log('debug', `New numbered database schema created`);
      
      // No FTS table needed in per-drive database - FTS is handled in catalog.db
      log('debug', `No FTS table needed in per-drive database`);
      
      // Store the new database connection using the drive ID (no _new suffix)
      this.driveDbs.set(driveId, newDb);
      log('debug', `New numbered database connection stored for drive: ${driveId}`);
      
      const duration = Date.now() - startTime;
      log('debug', `===== NUMBERED SCAN DATABASE CREATED SUCCESSFULLY =====`);
      log('debug', `Duration: ${duration}ms`);
      
      return { success: true, newDbPath };
      
    } catch (error: any) {
      console.error(`[NewScanDB] Failed to create new scan database:`, error.message);
      log('debug', `===== NEW SCAN DATABASE CREATION FAILED =====`);
      return { success: false, error: error.message };
    }
  }

  // Method to store files directly to the numbered database during scans
  async storeFileTreeToNewDatabase(driveId: string, files: (FileInfo | Omit<FileInfo, 'id'>)[]): Promise<void> {
    const startTime = Date.now();
    log('debug', `===== STORING FILES TO NUMBERED DATABASE =====`);
    log('debug', `Drive ID: ${driveId}`);
    log('debug', `Files count: ${files.length}`);
    
    try {
      // Get the numbered database connection for this drive
      const numberedDb = this.driveDbs.get(driveId);
      if (!numberedDb) {
        throw new Error(`Numbered scan database not found for drive: ${driveId}`);
      }
      
      log('debug', `Numbered database connection found, starting file storage...`);
      
      // Use the existing storeFileTree logic but with the numbered database
      await this.storeFileTreeInternal(numberedDb, driveId, files);
      
      const duration = Date.now() - startTime;
      log('debug', `===== FILES STORED TO NUMBERED DATABASE SUCCESSFULLY =====`);
      log('debug', `Duration: ${duration}ms`);
      
    } catch (error: any) {
      console.error(`[StoreToNumberedDB] Failed to store files to numbered database:`, error.message);
      log('debug', `===== FILE STORAGE TO NUMBERED DATABASE FAILED =====`);
      throw error;
    }
  }

  // Internal method to store files to a specific database
  private async storeFileTreeInternal(db: Database.Database, driveId: string, files: (FileInfo | Omit<FileInfo, 'id'>)[]): Promise<void> {
    // This is the existing storeFileTree logic but accepts a specific database
    // Implementation would be similar to the current storeFileTree method
    // but uses the passed database instead of this.driveDbs.get(driveId)
    
    // For now, let's use a simplified approach
    const batchSize = 1000;
    
    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);
      
            // Insert files into the new database
      const insertStmt = db.prepare(`
        INSERT INTO files (id, drive_id, name, path, parent_path, size, is_directory, modified, depth, folder_path, file_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      for (const file of batch) {
        // Generate proper ID for each file (same logic as regular insertion)
        const fileId = 'id' in file ? file.id : this.generateSimpleId();
        
        insertStmt.run(
          fileId,
          driveId,
          file.name,
          file.path,
          file.parentPath || null,
          file.size,
          file.isDirectory ? 1 : 0,
          file.modified || new Date().toISOString(),
          file.depth || 0,
          file.folderPath || file.path,
          file.file_type || null
        );
      }
      
      // CRITICAL FIX: Do NOT update catalog FTS index during scan
      // FTS index will be rebuilt from the new FTS database after successful swap
      // This prevents real-time catalog.db updates and duplicate FTS entries
    }
  }

  // Simple finalization method that just updates FTS index from the new numbered database
  async finalizeScanSync(driveId: string, progressCallback?: (progress: { current: number; total: number; phase: string; message: string; etaSeconds?: number }) => void): Promise<{ success: boolean; error?: string }> {
    const startTime = Date.now();
    console.log(`[FINALIZE] ===== FINALIZING NUMBERED DATABASE SYNC =====`);
    console.log(`[FINALIZE] Drive ID: ${driveId}`);
    
    try {
      // Get the current (newly created) numbered database path
      const currentDbPath = await this.getCurrentDriveDatabasePath(driveId);
      
      log('debug', `Current database path: ${currentDbPath}`);
      
      // Verify database exists and has content
      if (!(await fs.pathExists(currentDbPath))) {
        console.error(`[FinalizeSync] Current database not found: ${currentDbPath}`);
        return { success: false, error: 'Current database not found' };
      }
      
      const dbStats = await fs.stat(currentDbPath);
      if (dbStats.size === 0) {
        console.error(`[FinalizeSync] Current database is empty: ${currentDbPath}`);
        return { success: false, error: 'Current database is empty' };
      }
      
      log('debug', `Current database size: ${dbStats.size} bytes`);
      
      // Build new FTS index in catalog.db from the current per-drive database
      console.log(`[FINALIZE] ===== BUILDING NEW FTS INDEX IN CATALOG =====`);
      
      if (this.catalogDb) {
        try {
          // Remove old FTS entries for this drive 
          log('debug', `Removing old FTS entries for drive ${driveId}...`);
          const deleteStmt = this.catalogDb.prepare(`DELETE FROM files_fts WHERE drive_id = ?`);
          const deleteResult = deleteStmt.run(driveId);
          log('debug', `Removed ${deleteResult.changes} old FTS entries`);
          
          // Read file data from the current per-drive database
          log('debug', `Reading file data from current per-drive database...`);
          log('debug', `Database path: ${currentDbPath}`);
          
          const currentDb = new Database(currentDbPath);
          
          const files = currentDb.prepare(`
            SELECT name, drive_id, path, is_directory FROM files WHERE drive_id = ?
          `).all(driveId) as Array<{ name: string; drive_id: string; path: string; is_directory: number }>;
          
          log('debug', `Found ${files.length} files to index in FTS`);
          
          // Build FTS index from file data directly  
          if (files.length > 0) {
            const insertFtsStmt = this.catalogDb.prepare(`
              INSERT INTO files_fts (name, drive_id, path, is_directory) VALUES (?, ?, ?, ?)
            `);
            
            const batchSize = 1000;
            let indexedCount = 0;
            const ftsStartTime = Date.now();
            
            log('debug', `Building FTS index directly in batches of ${batchSize}...`);
            log('debug', `Total files to index: ${files.length}`);
            
            // Send initial progress
            if (progressCallback) {
              console.log(`[FINALIZE] Sending initial progress callback: Building search index...`);
              progressCallback({
                current: 0,
                total: files.length,
                phase: 'fts-indexing',
                message: 'Building search index...'
              });
            }
            
            for (let i = 0; i < files.length; i += batchSize) {
              const batch = files.slice(i, i + batchSize);
              
              // Insert batch of files
              for (const file of batch) {
                try {
                  insertFtsStmt.run(file.name, file.drive_id, file.path, file.is_directory);
                  indexedCount++;
                } catch (insertError: any) {
                  console.error(`[FinalizeSync] Failed to insert file into FTS:`, file.name, insertError.message);
                  throw new Error(`FTS insertion failed for file ${file.name}: ${insertError.message}`);
                }
              }
              
              // Send progress update every batch
              if (progressCallback) {
                const elapsed = Date.now() - ftsStartTime;
                const rate = indexedCount / (elapsed / 1000); // files per second
                const remaining = files.length - indexedCount;
                const etaSeconds = rate > 0 ? remaining / rate : 0;
                
                console.log(`[FINALIZE] Sending progress update: ${indexedCount}/${files.length} files indexed`);
                progressCallback({
                  current: indexedCount,
                  total: files.length,
                  phase: 'fts-indexing',
                  message: `Building search index: ${indexedCount.toLocaleString()}/${files.length.toLocaleString()} files`,
                  etaSeconds: etaSeconds
                });
              }
              
              // Yield to event loop to prevent blocking
              if (i % (batchSize * 10) === 0) {
                await new Promise(resolve => setImmediate(resolve));
              }
            }
          
            log('debug', `Successfully indexed ${indexedCount} files in FTS table`);
            
            // Verify the FTS table has data
            const ftsRowCount = this.catalogDb.prepare(`SELECT COUNT(*) as count FROM files_fts WHERE drive_id = ?`).get(driveId) as any;
            log('debug', `FTS table now contains ${ftsRowCount.count} entries for drive ${driveId}`);
          } else {
            log('debug', `No files to index in FTS table`);
          }
        
          currentDb.close();
        } catch (ftsError: any) {
          console.error(`[FinalizeSync] Error building FTS index:`, ftsError.message);
          throw ftsError; // Re-throw to fail the sync
        }
      } else {
        console.warn(`[FinalizeSync] Warning: Catalog database not available, skipping FTS operations`);
      }
      
      // Re-initialize database connections for the drive
      log('debug', `Re-initializing database connections for drive ${driveId}...`);
      await this.initializeDriveDatabase(driveId);
      log('debug', `Database connections re-initialized successfully`);
      
      // Update drive metadata in catalog (last_updated field)
      if (this.catalogDb) {
        try {
          log('debug', `===== UPDATING DRIVE METADATA IN CATALOG =====`);
          
          const updateStmt = this.catalogDb.prepare(`
            UPDATE drives 
            SET last_updated = ? 
            WHERE id = ?
          `);
          
          const currentTimestamp = new Date().toISOString();
          const updateResult = updateStmt.run(currentTimestamp, driveId);
          
          if (updateResult.changes > 0) {
            log('debug', `Drive metadata updated successfully`);
            log('debug', `last_updated set to: ${currentTimestamp}`);
          } else {
            console.warn(`[FinalizeSync] Warning: No drive record found to update in catalog`);
          }
          
          log('debug', `===== DRIVE METADATA UPDATE COMPLETE =====`);
        } catch (updateError: any) {
          console.error(`[FinalizeSync] Failed to update drive metadata:`, updateError.message);
          console.warn(`[FinalizeSync] Warning: Drive metadata update failed, but sync succeeded`);
        }
      }
      
      const duration = Date.now() - startTime;
      console.log(`[FINALIZE] ===== DATABASE FINALIZATION COMPLETED SUCCESSFULLY =====`);
      console.log(`[FINALIZE] Duration: ${duration}ms`);
      
      return { success: true };
      
    } catch (error: any) {
      console.error(`[FINALIZE] Database finalization failed:`, error.message);
      console.error(`[FINALIZE] Error stack:`, error.stack);
      console.log(`[FINALIZE] ===== DATABASE FINALIZATION FAILED =====`);
      return { success: false, error: error.message };
    }
  }

  // Method to rebuild FTS index from per-drive database data
  private async rebuildFtsFromDriveDatabase(driveId: string, driveDbPath: string): Promise<void> {
    log('debug', `Rebuilding FTS index from per-drive database: ${driveDbPath}`);
    
    try {
      if (!this.catalogDb) {
        throw new Error('Catalog database not available');
      }
      
      // Verify per-drive database exists and is accessible
      log('debug', `Verifying per-drive database accessibility...`);
      if (!(await fs.pathExists(driveDbPath))) {
        throw new Error(`Per-drive database not found: ${driveDbPath}`);
      }
      
      // Read file data from the per-drive database
      const driveDb = new Database(driveDbPath);
      log('debug', `Per-drive database connection established`);
      
      // Verify schema
      const tables = driveDb.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all();
      log('debug', `Per-drive database tables:`, tables.map((t: any) => t.name));
      
      const files = driveDb.prepare(`
        SELECT name, drive_id, path FROM files WHERE drive_id = ?
      `).all(driveId) as Array<{ name: string; drive_id: string; path: string }>;
      
      log('debug', `Found ${files.length} files to index`);
      
      if (files.length > 0) {
        // Clear existing FTS data for this drive
        const clearStmt = this.catalogDb.prepare(`DELETE FROM files_fts WHERE drive_id = ?`);
        clearStmt.run(driveId);
        
        // Insert new FTS data progressively
        const insertStmt = this.catalogDb.prepare(`
          INSERT INTO files_fts (name, drive_id, path, is_directory) VALUES (?, ?, ?, ?)
        `);
        
        const batchSize = 1000;
        let indexedCount = 0;
        
        log('debug', `Building FTS index progressively in batches of ${batchSize}...`);
        
        for (let i = 0; i < files.length; i += batchSize) {
          const batch = files.slice(i, i + batchSize);
          
          // Insert batch of files
          for (const file of batch) {
            insertStmt.run(file.name, file.drive_id, file.path);
            indexedCount++;
          }
          
          // Log progress every few batches
          if (i % (batchSize * 5) === 0 || i + batchSize >= files.length) {
            log('debug', `Progress: ${indexedCount}/${files.length} files indexed (${Math.round((indexedCount / files.length) * 100)}%)`);
          }
          
          // Yield to event loop every few batches to prevent blocking
          if (i % (batchSize * 10) === 0) {
            await new Promise(resolve => setImmediate(resolve));
          }
        }
        
        log('debug', `Successfully rebuilt FTS index with ${indexedCount} files`);
      }
      
      driveDb.close();
      
    } catch (error: any) {
      console.error(`[RebuildFTS] Failed to rebuild FTS index:`, error.message);
      throw error;
    }
  }

  async cleanupNewDatabasesOnFailure(driveId: string): Promise<{ success: boolean; error?: string }> {
    const startTime = Date.now();
    log('debug', `===== CLEANING UP NUMBERED DATABASE ON FAILURE =====`);
    log('debug', `Drive ID: ${driveId}`);
    
    try {
      const numberedDbPath = await this.getDriveDatabasePath(driveId);
      
      let cleanedCount = 0;
      
      // Remove numbered database if it exists
      if (await fs.pathExists(numberedDbPath)) {
        await fs.remove(numberedDbPath);
        log('debug', `Removed numbered database: ${numberedDbPath}`);
        cleanedCount++;
      }
      
      // Close database connection if open
      const driveDb = this.driveDbs.get(driveId);
      if (driveDb) {
        driveDb.close();
        this.driveDbs.delete(driveId);
        log('debug', `Closed numbered database connection for ${driveId}`);
      }
      
      const duration = Date.now() - startTime;
      log('debug', `===== NUMBERED DATABASE CLEANUP COMPLETED =====`);
      log('debug', `Cleaned ${cleanedCount} files in ${duration}ms`);
      
      return { success: true };
      
    } catch (error: any) {
      console.error(`[CleanupNumberedDB] Cleanup failed:`, error.message);
      log('debug', `===== NUMBERED DATABASE CLEANUP FAILED =====`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Add a drive back to the catalog database with its information
   */
  async addDriveToCatalog(driveId: string, driveInfo: any): Promise<boolean> {
    if (!this.catalogDb) {
      log('error', `Cannot add drive to catalog: Catalog database not initialized`);
      return false;
    }

    try {
      log('info', `Adding drive ${driveId} back to catalog...`);
      log('debug', `Drive info:`, driveInfo);

      // Prepare the SQL statement with all possible fields
      const stmt = this.catalogDb.prepare(`
        INSERT INTO drives (
          id, name, path, total_capacity, used_space, free_space, 
          format_type, added_date, last_updated, deleted, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      // Execute the insert with the drive info
      const result = stmt.run(
        driveId,
        driveInfo.name || `Drive ${driveId}`,
        driveInfo.path || '',
        driveInfo.totalCapacity || 0,
        driveInfo.usedSpace || 0,
        driveInfo.freeSpace || 0,
        driveInfo.formatType || '',
        driveInfo.addedDate || new Date().toISOString(),
        driveInfo.lastUpdated || new Date().toISOString(),
        0, // Not deleted
        null // No deletion date
      );

      log('info', `Successfully added drive ${driveId} to catalog`);
      return result.changes > 0;
    } catch (error) {
      log('error', `Failed to add drive ${driveId} to catalog:`, error);
      return false;
    }
  }

  /**
   * Rebuild the search index for a specific drive
   */
  async rebuildSearchIndexForDrive(driveId: string): Promise<void> {
    if (!this.catalogDb) {
      throw new Error('Cannot rebuild search index: Catalog database not initialized');
    }

    try {
      log('info', `Rebuilding search index for drive ${driveId}...`);

      // Get the drive database
      const driveDb = await this.getDriveDb(driveId);
      if (!driveDb) {
        throw new Error(`Drive database not found for drive: ${driveId}`);
      }

      // First remove any existing index entries for this drive
      log('debug', `Removing existing FTS entries for drive ${driveId}...`);
      this.catalogDb.prepare(`DELETE FROM files_fts WHERE drive_id = ?`).run(driveId);

      // Get all files from the drive database
      const files = driveDb.prepare(`
        SELECT id, name, path, is_directory FROM files 
        WHERE drive_id = ? AND deleted = 0
      `).all(driveId) as any[];

      log('info', `Found ${files.length} files to index`);

      if (files.length > 0) {
        // Insert into search index in batches
        const batchSize = 1000;
        const insertStmt = this.catalogDb.prepare(`
          INSERT INTO files_fts (name, drive_id, path, is_directory)
          VALUES (?, ?, ?, ?)
        `);

        for (let i = 0; i < files.length; i += batchSize) {
          const batch = files.slice(i, i + batchSize);
          
          for (const file of batch) {
            insertStmt.run(file.name, driveId, file.path, file.is_directory ? 1 : 0);
          }

          if (i % (batchSize * 5) === 0 || i + batch.length >= files.length) {
            const progress = Math.round(((i + batch.length) / files.length) * 100);
            log('debug', `Indexing progress: ${progress}% (${i + batch.length}/${files.length} files)`);
          }
        }
      }

      log('info', `Search index rebuilt successfully for drive ${driveId}`);
    } catch (error) {
      log('error', `Failed to rebuild search index for drive ${driveId}:`, error);
      throw error;
    }
  }

  // ===== SYNC FAILURE RECOVERY SYSTEM =====

  /**
   * Core recovery function that restores the application to its last known good state
   * when sync fails or is cancelled.
   */
  async recoverFromSyncFailure(driveId: string, options: RecoveryOptions = {}): Promise<RecoveryResult> {
    const startTime = Date.now();
    const details: string[] = [];
    
    log('info', `===== STARTING SYNC FAILURE RECOVERY =====`);
    log('info', `Drive ID: ${driveId}`);
    log('info', `Options:`, options);
    
    try {
      // Step 1: Detect current database state
      log('info', `Step 1: Detecting database state...`);
      const dbState = await this.detectDatabaseState(driveId);
      details.push(`Database state detected: current=${dbState.currentDatabase}, new=${dbState.newDatabase}, sync=${dbState.syncNumber}`);
      log('info', `Database state:`, dbState);

      // Step 2: Clean up new numbered database if requested (do this early to avoid confusion)
      if (options.deleteNewDatabase !== false && dbState.newDatabase) {
        log('info', `Step 2: Cleaning up new database...`);
        const cleanupResult = await this.cleanupNewDatabasesOnFailure(driveId);
        if (cleanupResult.success) {
          details.push('Cleaned up new database files');
          log('info', 'New database cleanup successful');
        } else {
          details.push(`New database cleanup failed: ${cleanupResult.error}`);
          log('warn', `New database cleanup failed: ${cleanupResult.error}`);
        }
      }
      
      // Step 3: Restore drive database from backup if requested (CRITICAL: This must happen BEFORE catalog work)
      if (options.restoreDriveBackup !== false && dbState.expectedBackup) {
        log('info', `Step 3: Restoring drive database from backup...`);
        
        // Validate backup before restoration
        const backupValidation = await this.validateBackup(dbState.expectedBackup, 'drive');
        if (!backupValidation.exists) {
          details.push(`Drive backup not found: ${dbState.expectedBackup}`);
          log('error', `Drive backup not found: ${dbState.expectedBackup}`);
          return { success: false, error: `Drive backup not found: ${dbState.expectedBackup}`, details };
        }
        
        if (!backupValidation.isValid) {
          details.push(`Drive backup is corrupted: ${dbState.expectedBackup}`);
          log('error', `Drive backup is corrupted: ${dbState.expectedBackup}`);
          return { success: false, error: `Drive backup is corrupted`, details };
        }
        
        // Restore from backup
        const driveRestoreResult = await this.restoreDriveFromBackup(driveId);
        if (driveRestoreResult.success) {
          details.push('Restored drive database from backup');
          log('info', 'Drive database restored successfully');
        } else {
          details.push(`Drive restoration failed: ${driveRestoreResult.error}`);
          log('error', `Drive restoration failed: ${driveRestoreResult.error}`);
          return { success: false, error: driveRestoreResult.error, details };
        }
      }

      // Step 4: Delete corrupted current catalog.db if requested (AFTER drive restoration)
      if (options.deleteCatalog !== false) {
        log('info', `Step 4: Deleting corrupted catalog.db...`);
        const catalogPath = path.join(this.getUserStorageDir(), 'catalog.db');
        if (await fs.pathExists(catalogPath)) {
          // Close catalog connection first
          if (this.catalogDb) {
            this.catalogDb.close();
            this.catalogDb = null;
          }
          await fs.remove(catalogPath);
          details.push('Deleted corrupted catalog.db');
          log('info', 'Deleted corrupted catalog.db');
        } else {
          details.push('No catalog.db to delete');
          log('info', 'No catalog.db found to delete');
        }
      }
      
      // Step 5: Restore catalog.db from backup if requested (AFTER drive restoration ensures active DBs are ready)
      if (options.restoreCatalogBackup !== false) {
        log('info', `Step 5: Restoring catalog.db from backup...`);
        const backupManager = this.getBackupManager();
        if (backupManager) {
          const backups = await backupManager.getAvailableBackups();
          const catalogBackups = backups.filter(b => b.type === 'catalog');
          
          if (catalogBackups.length > 0) {
            const mostRecentCatalogBackup = catalogBackups.sort((a, b) => b.timestamp - a.timestamp)[0];
            const catalogPath = path.join(this.getUserStorageDir(), 'catalog.db');
            const restoreResult = await backupManager.restoreCatalog(mostRecentCatalogBackup, catalogPath);
            
            if (restoreResult.success) {
              details.push('Restored catalog.db from backup');
              log('info', 'Catalog restored successfully');
              
              // Reinitialize catalog connection
              this.catalogDb = new Database(catalogPath);
              this.createCatalogSchema();
            } else {
              details.push(`Catalog restoration failed: ${restoreResult.message}`);
              log('error', `Catalog restoration failed: ${restoreResult.message}`);
              
              // FALLBACK: Rebuild catalog from per-drive databases
              log('warn', `Attempting to rebuild catalog from per-drive databases...`);
              try {
                const rebuildResult = await this.rebuildCatalogFromPerDriveDatabases();
                if (rebuildResult.success) {
                  details.push(`Catalog rebuilt from per-drive databases: ${rebuildResult.details}`);
                  log('info', 'Catalog successfully rebuilt from per-drive databases');
                } else {
                  details.push(`Catalog rebuild failed: ${rebuildResult.error}`);
                  log('error', `Catalog rebuild failed: ${rebuildResult.error}`);
                  return { success: false, error: `Catalog restoration and rebuild both failed: ${rebuildResult.error}`, details };
                }
              } catch (rebuildError: any) {
                details.push(`Catalog rebuild exception: ${rebuildError.message}`);
                log('error', `Catalog rebuild exception: ${rebuildError.message}`);
                return { success: false, error: `Catalog restoration failed and rebuild exception: ${rebuildError.message}`, details };
              }
            }
          } else {
            details.push('No catalog backup found');
            log('warn', 'No catalog backup found for restoration');
            
            // FALLBACK: Rebuild catalog from per-drive databases
            log('info', `No catalog backup available, rebuilding from per-drive databases...`);
            try {
              const rebuildResult = await this.rebuildCatalogFromPerDriveDatabases();
              if (rebuildResult.success) {
                details.push(`Catalog rebuilt from per-drive databases: ${rebuildResult.details}`);
                log('info', 'Catalog successfully rebuilt from per-drive databases');
              } else {
                details.push(`Catalog rebuild failed: ${rebuildResult.error}`);
                log('error', `Catalog rebuild failed: ${rebuildResult.error}`);
                return { success: false, error: `No catalog backup and rebuild failed: ${rebuildResult.error}`, details };
              }
            } catch (rebuildError: any) {
              details.push(`Catalog rebuild exception: ${rebuildError.message}`);
              log('error', `Catalog rebuild exception: ${rebuildError.message}`);
              return { success: false, error: `No catalog backup and rebuild exception: ${rebuildError.message}`, details };
            }
          }
        } else {
          details.push('Backup manager not available');
          log('warn', 'Backup manager not available for catalog restoration');
          
          // FALLBACK: Rebuild catalog from per-drive databases  
          log('info', `Backup manager unavailable, rebuilding catalog from per-drive databases...`);
          try {
            const rebuildResult = await this.rebuildCatalogFromPerDriveDatabases();
            if (rebuildResult.success) {
              details.push(`Catalog rebuilt from per-drive databases: ${rebuildResult.details}`);
              log('info', 'Catalog successfully rebuilt from per-drive databases');
            } else {
              details.push(`Catalog rebuild failed: ${rebuildResult.error}`);
              log('error', `Catalog rebuild failed: ${rebuildResult.error}`);
              return { success: false, error: `Backup manager unavailable and rebuild failed: ${rebuildResult.error}`, details };
            }
          } catch (rebuildError: any) {
            details.push(`Catalog rebuild exception: ${rebuildError.message}`);
            log('error', `Catalog rebuild exception: ${rebuildError.message}`);
            return { success: false, error: `Backup manager unavailable and rebuild exception: ${rebuildError.message}`, details };
          }
        }
      }

      // Step 6: Validate restored databases if requested
      if (options.validateIntegrity !== false) {
        log('info', `Step 6: Validating restored databases...`);
        
        // Validate catalog database
        const catalogPath = path.join(this.getUserStorageDir(), 'catalog.db');
        if (await fs.pathExists(catalogPath)) {
          const catalogValidation = await this.validateDatabaseIntegrity(catalogPath);
          if (catalogValidation.valid) {
            details.push('Catalog database integrity validated');
            log('info', 'Catalog database integrity validated');
          } else {
            details.push(`Catalog database validation failed: ${catalogValidation.error}`);
            log('warn', `Catalog database validation failed: ${catalogValidation.error}`);
          }
        }
        
        // Validate drive database if it was restored
        if (dbState.currentDatabase) {
          const currentDbPath = await this.getCurrentDriveDatabasePath(driveId);
          if (await fs.pathExists(currentDbPath)) {
            const driveValidation = await this.validateDatabaseIntegrity(currentDbPath);
            if (driveValidation.valid) {
              details.push('Drive database integrity validated');
              log('info', 'Drive database integrity validated');
            } else {
              details.push(`Drive database validation failed: ${driveValidation.error}`);
              log('warn', `Drive database validation failed: ${driveValidation.error}`);
            }
          }
        }
      }
      
      const totalDuration = Date.now() - startTime;
      log('info', `===== SYNC FAILURE RECOVERY COMPLETED SUCCESSFULLY =====`);
      log('info', `Total duration: ${totalDuration}ms`);
      log('info', `Recovery steps completed: ${details.length}`);
      
      return { success: true, details };
      
    } catch (error: any) {
      const totalDuration = Date.now() - startTime;
      log('error', `===== SYNC FAILURE RECOVERY FAILED =====`);
      log('error', `Total duration: ${totalDuration}ms`);
      log('error', `Error: ${error.message}`);
      return { success: false, error: error.message, details };
    }
  }

  /**
   * Detect the current database state for a drive to determine recovery strategy
   */
  async detectDatabaseState(driveId: string): Promise<DatabaseState> {
    const userStorageDir = this.getUserStorageDir();
    const safeId = this.sanitizeDriveIdForFilename(driveId);
    
    try {
      // List all files in the directory
      const files = await fs.readdir(userStorageDir);
      
      // Look for current database (highest sync number or init)
      const syncRegex = new RegExp(`^${safeId}_sync(\\d+)\\.db$`);
      const initRegex = new RegExp(`^${safeId}_init\\.db$`);
      
      let currentDatabase: string | null = null;
      let maxSyncNum = 0;
      let hasInitFile = false;
      
      for (const file of files) {
        // Check for init file
        if (initRegex.test(file)) {
          hasInitFile = true;
          continue;
        }
        
        // Check for sync files
        const match = file.match(syncRegex);
        if (match) {
          const syncNum = parseInt(match[1], 10);
          if (!isNaN(syncNum) && syncNum > maxSyncNum) {
            maxSyncNum = syncNum;
            currentDatabase = file;
          }
        }
      }
      
      // Determine current and new database names
      if (maxSyncNum > 0) {
        currentDatabase = `${safeId}_sync${maxSyncNum}.db`;
      } else if (hasInitFile) {
        currentDatabase = `${safeId}_init.db`;
        maxSyncNum = 0;
      }
      
      // New database would be the next in sequence
      const newDatabase = maxSyncNum === 0 
        ? `${safeId}_sync1.db` 
        : `${safeId}_sync${maxSyncNum + 1}.db`;
      
      // Expected backup would be for the current database
      let expectedBackup: string | null = null;
      if (currentDatabase) {
        // Extract the suffix from current database name
        const match = currentDatabase.match(/^(.+?)(_(?:init|sync\d+))\.db$/);
        if (match) {
          expectedBackup = `backup_${match[1]}${match[2]}.db`;
        }
      }
      
      return {
        currentDatabase,
        newDatabase,
        expectedBackup,
        syncNumber: maxSyncNum,
        isFirstSync: hasInitFile && maxSyncNum === 0
      };
      
    } catch (error: any) {
      log('error', `Failed to detect database state for drive ${driveId}:`, error.message);
      return {
        currentDatabase: null,
        newDatabase: null,
        expectedBackup: null,
        syncNumber: 0,
        isFirstSync: false
      };
    }
  }

  /**
   * Validate backup file integrity and readability
   */
  async validateBackup(backupPath: string, type: 'drive' | 'catalog'): Promise<BackupValidation> {
    try {
      const fullBackupPath = path.isAbsolute(backupPath) 
        ? backupPath 
        : path.join(this.getUserStorageDir(), 'backups', backupPath);
      
      // Check if file exists
      if (!(await fs.pathExists(fullBackupPath))) {
        return {
          exists: false,
          isValid: false,
          timestamp: 0,
          fileSize: 0,
          canOpen: false,
          hasRequiredTables: false
        };
      }
      
      // Get file stats
      const stats = await fs.stat(fullBackupPath);
      const fileSize = stats.size;
      const timestamp = stats.mtime.getTime();
      
      // Try to open database
      let canOpen = false;
      let hasRequiredTables = false;
      
      try {
        const db = new Database(fullBackupPath, { readonly: true });
        canOpen = true;
        
        // Check for required tables
        const tables = db.prepare(`
          SELECT name FROM sqlite_master 
          WHERE type='table'
        `).all() as Array<{ name: string }>;
        
        if (type === 'drive') {
          hasRequiredTables = tables.some(t => t.name === 'files');
        } else if (type === 'catalog') {
          hasRequiredTables = tables.some(t => t.name === 'drives' || t.name === 'files_fts');
        }
        
        db.close();
      } catch (dbError: any) {
        log('warn', `Could not open backup database ${backupPath}:`, dbError.message);
      }
      
      const isValid = canOpen && hasRequiredTables && fileSize > 0;
      
      return {
        exists: true,
        isValid,
        timestamp,
        fileSize,
        canOpen,
        hasRequiredTables
      };
      
    } catch (error: any) {
      log('error', `Failed to validate backup ${backupPath}:`, error.message);
      return {
        exists: false,
        isValid: false,
        timestamp: 0,
        fileSize: 0,
        canOpen: false,
        hasRequiredTables: false
      };
    }
  }

  /**
   * Validate database integrity by checking if it can be opened and has required tables
   */
  async validateDatabaseIntegrity(dbPath: string): Promise<{ valid: boolean; error?: string }> {
    try {
      const db = new Database(dbPath, { readonly: true });
      
      // Test basic operations
      db.prepare('SELECT COUNT(*) FROM sqlite_master').get();
      
      // Check for required tables
      const tables = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name IN ('files', 'drives', 'files_fts')
      `).all() as Array<{ name: string }>;
      
      db.close();
      
      const hasRequiredTables = tables.length >= 1; // At least one required table
      
      return { valid: hasRequiredTables };
    } catch (error: any) {
      return { valid: false, error: error.message };
    }
  }

  // ===== APP CRASH DETECTION AND RECOVERY =====

  /**
   * Create crash detection files to track sync operations
   */
  async createCrashDetectionFiles(crashData: CrashDetectionData): Promise<void> {
    try {
      const userDataPath = this.getUserStorageDir();
      const crashFlagPath = path.join(userDataPath, '.sync-in-progress');
      const crashDataPath = path.join(userDataPath, '.sync-crash-data.json');
      
      log('info', `Creating crash detection files...`);
      log('debug', `Crash flag path: ${crashFlagPath}`);
      log('debug', `Crash data path: ${crashDataPath}`);
      
      // Create flag file with timestamp
      await fs.writeFile(crashFlagPath, new Date().toISOString());
      
      // Create data file with operation details
      await fs.writeJSON(crashDataPath, crashData, { spaces: 2 });
      
      log('info', `Crash detection files created successfully`);
    } catch (error: any) {
      log('error', `Failed to create crash detection files:`, error.message);
      // Don't throw - sync should continue even if crash detection fails
    }
  }

  /**
   * Update crash detection data during sync phases
   */
  async updateCrashDetectionPhase(phase: string, additionalData?: Partial<CrashDetectionData>): Promise<void> {
    try {
      const userDataPath = this.getUserStorageDir();
      const crashDataPath = path.join(userDataPath, '.sync-crash-data.json');
      
      if (await fs.pathExists(crashDataPath)) {
        const crashData = await fs.readJSON(crashDataPath) as CrashDetectionData;
        
        // Update phase and any additional data
        crashData.phase = phase;
        if (additionalData) {
          Object.assign(crashData, additionalData);
        }
        
        await fs.writeJSON(crashDataPath, crashData, { spaces: 2 });
        log('debug', `Updated crash detection phase to: ${phase}`);
      }
    } catch (error: any) {
      log('warn', `Failed to update crash detection phase:`, error.message);
      // Don't throw - this is non-critical
    }
  }

  /**
   * Remove crash detection files after successful completion
   */
  async removeCrashDetectionFiles(): Promise<void> {
    try {
      const userDataPath = this.getUserStorageDir();
      const crashFlagPath = path.join(userDataPath, '.sync-in-progress');
      const crashDataPath = path.join(userDataPath, '.sync-crash-data.json');
      
      log('info', `Removing crash detection files...`);
      
      if (await fs.pathExists(crashFlagPath)) {
        await fs.remove(crashFlagPath);
        log('debug', `Removed crash flag file`);
      }
      
      if (await fs.pathExists(crashDataPath)) {
        await fs.remove(crashDataPath);
        log('debug', `Removed crash data file`);
      }
      
      log('info', `Crash detection files removed successfully`);
    } catch (error: any) {
      log('error', `Failed to remove crash detection files:`, error.message);
      // Don't throw - this is cleanup
    }
  }

  /**
   * Check for potential app crash during sync operations
   */
  async checkForAppCrash(): Promise<CrashDetectionResult> {
    const userDataPath = this.getUserStorageDir();
    const crashFlagPath = path.join(userDataPath, '.sync-in-progress');
    const crashDataPath = path.join(userDataPath, '.sync-crash-data.json');
    
    try {
      // Check if crash flag exists
      if (!(await fs.pathExists(crashFlagPath))) {
        return {
          crashDetected: false,
          shouldRecover: false
        };
      }
      
      log('warn', `Potential app crash detected - crash flag file exists`);
      
      let crashData: CrashDetectionData | undefined;
      
      // Try to read crash data
      if (await fs.pathExists(crashDataPath)) {
        try {
          crashData = await fs.readJSON(crashDataPath) as CrashDetectionData;
          log('info', `Crash data found:`, crashData);
        } catch (jsonError: any) {
          log('warn', `Could not parse crash data:`, jsonError.message);
        }
      }
      
      return {
        crashDetected: true,
        crashData,
        shouldRecover: false, // Will be determined by user choice
        userChoice: undefined
      };
      
    } catch (error: any) {
      log('error', `Error checking for app crash:`, error.message);
      return {
        crashDetected: false,
        shouldRecover: false
      };
    }
  }

  /**
   * Execute crash recovery based on detected crash data
   */
  async executeAppCrashRecovery(crashData: CrashDetectionData): Promise<RecoveryResult> {
    log('info', `===== EXECUTING APP CRASH RECOVERY =====`);
    log('info', `Drive: ${crashData.driveName || crashData.driveId}`);
    log('info', `Operation: ${crashData.operation}`);
    log('info', `Phase: ${crashData.phase}`);
    log('info', `Start time: ${new Date(crashData.startTime).toLocaleString()}`);
    
    try {
      // Determine recovery strategy based on crash phase
      const recoveryOptions: RecoveryOptions = {
        deleteNewDatabase: true,
        deleteCatalog: false,
        restoreDriveBackup: true,
        restoreCatalogBackup: false,
        validateIntegrity: true
      };
      
      // Adjust recovery options based on crash phase
      switch (crashData.phase) {
        case 'catalog-backup':
          // Crashed during catalog backup - safe to continue without restoration
          recoveryOptions.restoreDriveBackup = false;
          recoveryOptions.restoreCatalogBackup = false;
          break;
          
        case 'drive-backup':
          // Crashed during drive backup - restore drive only
          recoveryOptions.restoreCatalogBackup = false;
          break;
          
        case 'file-scan':
          // Crashed during file scanning - restore both if catalog was modified
          recoveryOptions.restoreCatalogBackup = crashData.catalogBackupCreated || false;
          break;
          
        case 'catalog-update':
          // Crashed during catalog update - restore catalog definitely
          recoveryOptions.restoreCatalogBackup = true;
          recoveryOptions.deleteCatalog = true;
          break;
          
        case 'finalization':
          // Crashed during finalization - restore both to be safe
          recoveryOptions.restoreCatalogBackup = true;
          recoveryOptions.deleteCatalog = true;
          break;
          
        default:
          // Unknown phase - use full recovery
          log('warn', `Unknown crash phase: ${crashData.phase}, using full recovery`);
          recoveryOptions.restoreCatalogBackup = true;
          recoveryOptions.deleteCatalog = true;
      }
      
      log('info', `Recovery options determined:`, recoveryOptions);
      
      // Execute recovery
      const recoveryResult = await this.recoverFromSyncFailure(crashData.driveId, recoveryOptions);
      
      if (recoveryResult.success) {
        // Clean up crash detection files after successful recovery
        await this.removeCrashDetectionFiles();
        log('info', `App crash recovery completed successfully`);
      } else {
        log('error', `App crash recovery failed: ${recoveryResult.error}`);
      }
      
      return recoveryResult;
      
    } catch (error: any) {
      log('error', `Error during app crash recovery:`, error.message);
      return {
        success: false,
        error: error.message,
        details: [`App crash recovery failed: ${error.message}`]
      };
    }
  }

  /**
   * Clean up crash detection files (for manual cleanup or error scenarios)
   */
  async cleanupCrashDetectionFiles(): Promise<void> {
    try {
      await this.removeCrashDetectionFiles();
      log('info', `Crash detection files cleaned up manually`);
    } catch (error: any) {
      log('error', `Failed to cleanup crash detection files:`, error.message);
    }
  }

  /**
   * Rebuild catalog.db from active per-drive databases when backup restoration fails
   * Self-contained rebuild that directly rebuilds both drives table and FTS index
   */
  async rebuildCatalogFromPerDriveDatabases(): Promise<{ success: boolean; error?: string; details: string }> {
    const startTime = Date.now();
    log('info', `===== REBUILDING CATALOG FROM ACTIVE PER-DRIVE DATABASES =====`);
    
    try {
      const catalogPath = path.join(this.getUserStorageDir(), 'catalog.db');
      
      // Close existing catalog connection if any
      if (this.catalogDb) {
        this.catalogDb.close();
        this.catalogDb = null;
      }
      
      // Remove corrupted catalog.db if it exists
      if (await fs.pathExists(catalogPath)) {
        await fs.remove(catalogPath);
        log('info', 'Removed corrupted catalog.db');
      }
      
      // Create new catalog database
      this.catalogDb = new Database(catalogPath);
      this.createCatalogSchema();
      log('info', 'Created new catalog database with schema');
      
      // Scan user storage directory for ACTIVE per-drive databases (not backup folder)
      const userStorageDir = this.getUserStorageDir();
      const files = await fs.readdir(userStorageDir);
      
      // Find all per-drive database files (active databases only)
      const driveDbFiles: Array<{ file: string; driveId: string; path: string }> = [];
      for (const file of files) {
        // Match drive database patterns: driveId_init.db or driveId_sync1.db etc.
        // Exclude backup files and files in backup folder
        if (file.startsWith('backup_') || file.includes('_backup') || file.endsWith('_fts_backup.db')) {
          continue; // Skip backup files
        }
        
        const match = file.match(/^(.+?)_(?:init|sync\d+)\.db$/);
        if (match) {
          const driveId = match[1];
          const fullPath = path.join(userStorageDir, file);
          if (await fs.pathExists(fullPath)) {
            driveDbFiles.push({ file, driveId, path: fullPath });
          }
        }
      }
      
      log('info', `Found ${driveDbFiles.length} active per-drive database files`);
      
      if (driveDbFiles.length === 0) {
        return { success: false, error: 'No active per-drive databases found to rebuild catalog from', details: 'No active drive databases found' };
      }
      
      let rebuiltDrives = 0;
      let totalFiles = 0;
      
      // Prepare batch insert statements for efficiency
      const insertDriveStmt = this.catalogDb.prepare(`
        INSERT OR REPLACE INTO drives (
          id, name, path, total_capacity, used_space, free_space, 
          format_type, added_date, last_updated, deleted, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      const insertFtsStmt = this.catalogDb.prepare(`
        INSERT INTO files_fts (name, drive_id, path, is_directory) VALUES (?, ?, ?, ?)
      `);
      
      // Process each drive database to rebuild both drives table and FTS index
      for (const dbFile of driveDbFiles) {
        try {
          log('info', `Processing active drive database: ${dbFile.file}`);
          
          // Open the drive database in readonly mode
          const driveDb = new Database(dbFile.path, { readonly: true });
          
          // Read drive metadata
          let driveMetadata: any = null;
          try {
            driveMetadata = driveDb.prepare('SELECT * FROM drive_metadata LIMIT 1').get();
          } catch (metaError) {
            log('warn', `No drive_metadata found in ${dbFile.file}, using filename as driveId`);
          }
          
          const driveId = driveMetadata?.id || dbFile.driveId;
          const driveName = driveMetadata?.name || `Drive ${driveId}`;
          
          // Add drive to catalog drives table
          insertDriveStmt.run(
            driveId,
            driveName,
            driveMetadata?.path || '',
            driveMetadata?.total_capacity || 0,
            driveMetadata?.used_space || 0,
            driveMetadata?.free_space || 0,
            driveMetadata?.format_type || '',
            driveMetadata?.added_date || new Date().toISOString(),
            driveMetadata?.last_updated || new Date().toISOString(),
            0, // deleted
            null // deletedAt
          );
          
          // Read all active files from this drive and add to FTS index
          let driveFiles: any[] = [];
          try {
            driveFiles = driveDb.prepare(`
              SELECT name, path, is_directory FROM files WHERE deleted = 0
            `).all();
          } catch (filesError) {
            log('warn', `No files table found in ${dbFile.file}, skipping file indexing`);
          }
          
          // Add files to FTS index
          for (const file of driveFiles) {
            insertFtsStmt.run(
              file.name,
              driveId,
              file.path,
              file.is_directory || 0
            );
          }
          
          driveDb.close();
          rebuiltDrives++;
          totalFiles += driveFiles.length;
          log('info', `Rebuilt drive: ${driveName} (${driveFiles.length} files indexed)`);
          
        } catch (driveError: any) {
          log('error', `Failed to process drive database ${dbFile.file}: ${driveError.message}`);
          // Continue with other drives
        }
      }
      
      // Note: We don't reinitialize this.driveDbs here because this is a recovery function
      // The normal initialization will happen when the app resumes normal operation
      
      const totalDuration = Date.now() - startTime;
      const details = `Rebuilt ${rebuiltDrives} drives with ${totalFiles} files indexed in ${totalDuration}ms`;
      
      log('info', `===== CATALOG REBUILD COMPLETED SUCCESSFULLY =====`);
      log('info', details);
      
      return { success: true, details };
      
    } catch (error: any) {
      const totalDuration = Date.now() - startTime;
      log('error', `===== CATALOG REBUILD FAILED =====`);
      log('error', `Duration: ${totalDuration}ms`);
      log('error', `Error: ${error.message}`);
      return { success: false, error: error.message, details: `Rebuild failed after ${totalDuration}ms` };
    }
  }
}
