import * as fs from 'fs-extra';
import * as path from 'path';
import Database from 'better-sqlite3';

interface BackupInfo {
  id: string;
  type: 'drive' | 'catalog';
  driveId?: string;
  driveName?: string;
  timestamp: number;
  size: number;
  path: string;
  totalCapacity?: number;
  usedSpace?: number;
  freeSpace?: number;
  serialNumber?: string;
  formatType?: string;
  addedDate?: string;
  fileCount?: number;
}

interface RestoreResult {
  success: boolean;
  message: string;
  restoredFiles?: string[];
  restoredDrive?: any;
}

import { StorageManager } from './storage-manager';

export class BackupManager {
  private userDataPath: string;
  private backupsPath: string;
  private storageManager: StorageManager;

  constructor(userDataPath: string, storageManager: StorageManager) {
    this.userDataPath = userDataPath;
    this.backupsPath = path.join(userDataPath, 'backups');
    this.storageManager = storageManager;
    this.ensureBackupDirectory();
  }

  private ensureBackupDirectory(): void {
    try {
      fs.ensureDirSync(this.backupsPath);
    } catch (error) {
      console.error('Failed to create backup directory:', error);
    }
  }

  /**
   * Create backup of a per-drive database before deletion
   */
  async backupDrive(driveId: string, driveName: string, driveDbPath: string, driveInfo?: any): Promise<boolean> {
    try {
      console.log('===== STARTING BACKUP PROCESS =====');
      console.log(`Drive ID: ${driveId}`);
      console.log(`Drive Name: ${driveName}`);
      console.log(`Source DB Path: ${driveDbPath}`);
      console.log(`Backup Directory: ${this.backupsPath}`);

      // Check if backup directory exists
      const backupDirExists = fs.existsSync(this.backupsPath);
      console.log(`Backup directory exists: ${backupDirExists}`);

      if (!backupDirExists) {
        console.log('Creating backup directory...');
        await fs.ensureDir(this.backupsPath);
        console.log('Backup directory created successfully');
      }

      // Check source database
      if (!fs.existsSync(driveDbPath)) {
        console.log(`Drive database not found: ${driveDbPath}`);
        return false;
      }
      console.log('Source database exists and is accessible');

      // Extract the suffix from the original database filename
      const sourceFileName = path.basename(driveDbPath);
      console.log(`Original database filename: ${sourceFileName}`);
      
      // Parse the filename to extract the suffix (e.g., "_init.db" or "_sync1.db")
      let suffix = '_init'; // default suffix
      const match = sourceFileName.match(/^.+?(_(?:init|sync\d+))\.db$/);
      if (match) {
        suffix = match[1];
        console.log(`Extracted suffix: ${suffix}`);
      } else {
        console.log(`Could not extract suffix from ${sourceFileName}, using default: ${suffix}`);
      }

      // Create backup file name preserving the original suffix
      const timestamp = Date.now();
      const backupFileName = `backup_${driveId}${suffix}.db`;
      const backupPath = path.join(this.backupsPath, backupFileName);
      console.log(`Backup will be created at: ${backupPath}`);

      // Copy the database file
      console.log('Copying database file...');
      await fs.copy(driveDbPath, backupPath);

      console.log('Verifying backup has drive metadata...');
      // Ensure the backup has the drive_metadata table populated
      try {
        const db = new Database(backupPath);
        
        // Calculate actual file count from the database
        let actualFileCount = 0;
        try {
          const fileCountResult = db.prepare('SELECT COUNT(*) as count FROM files').get() as { count: number };
          actualFileCount = fileCountResult.count;
          console.log(`Calculated actual file count from database: ${actualFileCount}`);
        } catch (fileCountError) {
          console.warn('Could not calculate file count from database:', fileCountError);
          actualFileCount = driveInfo?.fileCount || 0;
        }

        // Check if drive_metadata table exists and has data
        const metadataExists = db.prepare(`
          SELECT name FROM sqlite_master WHERE type='table' AND name='drive_metadata'
        `).get();
        
        if (!metadataExists) {
          console.log('drive_metadata table not found, creating it...');
          db.exec(`
            CREATE TABLE drive_metadata (
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
          
          // Insert drive metadata with actual file count
          if (driveInfo) {
            console.log('Inserting drive metadata into backup...');
            db.prepare(`
              INSERT OR REPLACE INTO drive_metadata (
                id, name, path, total_capacity, used_space, free_space, 
                format_type, last_scan, file_count, status, added_date, last_updated
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              driveId, driveName, driveInfo.path || '', 
              driveInfo.totalCapacity || 0, driveInfo.usedSpace || 0, driveInfo.freeSpace || 0,
              driveInfo.formatType || '', driveInfo.lastScan || null, actualFileCount,
              driveInfo.status || 'active', driveInfo.addedDate || new Date().toISOString(),
              driveInfo.lastUpdated || null
            );
          }
        } else {
          console.log('drive_metadata table exists, checking contents...');
          const metadataRow = db.prepare('SELECT * FROM drive_metadata WHERE id = ?').get(driveId);
          if (!metadataRow) {
            console.log('No metadata found for drive, inserting...');
            if (driveInfo) {
              db.prepare(`
                INSERT OR REPLACE INTO drive_metadata (
                  id, name, path, total_capacity, used_space, free_space, 
                  format_type, last_scan, file_count, status, added_date, last_updated
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `).run(
                driveId, driveName, driveInfo.path || '', 
                driveInfo.totalCapacity || 0, driveInfo.usedSpace || 0, driveInfo.freeSpace || 0,
                driveInfo.formatType || '', driveInfo.lastScan || null, actualFileCount,
                driveInfo.status || 'active', driveInfo.addedDate || new Date().toISOString(),
                driveInfo.lastUpdated || null
              );
            }
          } else {
            console.log('Drive metadata already exists in backup, updating file count...');
            // Update the file count to ensure it's accurate
            db.prepare(`
              UPDATE drive_metadata 
              SET file_count = ?, last_updated = ?
              WHERE id = ?
            `).run(actualFileCount, new Date().toISOString(), driveId);
          }
        }
        
        db.close();
        console.log('Backup drive metadata verified/updated');
      } catch (metadataError) {
        console.error('Error verifying/adding metadata to backup:', metadataError);
        // Continue even if metadata fails - the backup file itself is more important
      }

      console.log(`===== BACKUP COMPLETED SUCCESSFULLY =====`);
      console.log(`Drive: ${driveName} (${driveId})`);
      console.log(`Backup location: ${backupPath}`);
      return true;
    } catch (error) {
      console.error(`===== BACKUP FAILED =====`);
      console.error(`Drive: ${driveName} (${driveId})`);
      console.error(`Error:`, error);
      return false;
    }
  }

  /**
   * Create backup of catalog database before changes
   */
  async backupCatalog(catalogDbPath: string): Promise<boolean> {
    try {
      if (!fs.existsSync(catalogDbPath)) {
        console.log(`Catalog database not found: ${catalogDbPath}`);
        return false;
      }

      const timestamp = Date.now();
      const backupFileName = `catalog_backup_${timestamp}.db`;
      const backupPath = path.join(this.backupsPath, backupFileName);

      // Copy the database file
      await fs.copy(catalogDbPath, backupPath);

      console.log(`Backed up catalog to ${backupPath}`);
      return true;
    } catch (error) {
      console.error('Failed to backup catalog:', error);
      return false;
    }
  }

  /**
   * Get list of all available backups
   */
  async getAvailableBackups(): Promise<BackupInfo[]> {
    try {
      const backups: BackupInfo[] = [];

      // Get all backup files
      const backupFiles = await fs.readdir(this.backupsPath);
      
      for (const file of backupFiles) {
        if (file.endsWith('.db')) {
          const filePath = path.join(this.backupsPath, file);
          const stats = await fs.stat(filePath);
          
          // Check for catalog backup pattern: catalog_backup_${timestamp}.db
          const catalogMatch = file.match(/^catalog_backup_(\d+)\.db$/);
          if (catalogMatch) {
            const [, timestampStr] = catalogMatch;
            const timestamp = parseInt(timestampStr);
            console.log(`Parsing catalog backup file: ${file}, timestamp: ${timestamp}`);
            
            backups.push({
              id: file.replace('.db', ''), // Use filename without extension as ID
              type: 'catalog',
              driveId: 'catalog', // Catalog backups don't belong to a specific drive
              driveName: 'Catalog Database',
              timestamp,
              size: stats.size,
              path: filePath
            });
            continue; // Skip to next file
          }
          
          // Parse filename: backup_${driveId}${suffix}.db (e.g., backup_drive123_init.db or backup_drive123_sync2.db)
          const match = file.match(/^backup_(.+?)(_(?:init|sync\d+))\.db$/);
          if (match) {
            const [, fileDriveId, suffix] = match;
            console.log(`Parsing backup file: ${file}, driveId: ${fileDriveId}, suffix: ${suffix}`);
            
            // Read metadata from drive_metadata table
            let driveId = fileDriveId;
            let driveName = 'Unknown Drive';
            let type = 'drive';
            let timestamp = stats.mtime.getTime(); // Use file modification time as fallback
            let driveInfo: any = {};
            
            try {
              const db = new Database(filePath, { readonly: true });
              
              // First try to read from new drive_metadata table
              const driveMetadata = db.prepare('SELECT * FROM drive_metadata LIMIT 1').get();
              
              if (driveMetadata) {
                const meta = driveMetadata as any;
                driveId = meta.id || fileDriveId;
                driveName = meta.name || 'Unknown Drive';
                
                // Determine if this is init or sync based on filename suffix
                const scanType = suffix === '_init' ? 'initial' : 'sync';
                
                // Use the appropriate date based on scan type
                if (scanType === 'initial' && meta.added_date) {
                  timestamp = new Date(meta.added_date).getTime();
                } else if (meta.last_updated) {
                  timestamp = new Date(meta.last_updated).getTime();
                } else if (meta.added_date) {
                  timestamp = new Date(meta.added_date).getTime();
                }
                
                driveInfo = {
                  totalCapacity: meta.total_capacity,
                  usedSpace: meta.used_space,
                  freeSpace: meta.free_space,
                  formatType: meta.format_type,
                  fileCount: meta.file_count,
                  addedDate: meta.added_date,
                  lastUpdated: meta.last_updated,
                  scanType: scanType
                };
              } else {
                // Fallback to legacy backup_metadata table
                try {
                  const metadata = db.prepare('SELECT key, value FROM backup_metadata').all();
                  
                  for (const row of metadata) {
                    const metaRow = row as { key: string; value: string };
                    if (metaRow.key === 'driveName') driveName = metaRow.value;
                    if (metaRow.key === 'type') type = metaRow.value;
                    if (metaRow.key === 'timestamp') timestamp = parseInt(metaRow.value);
                    if (metaRow.key !== 'driveId' && metaRow.key !== 'driveName' && metaRow.key !== 'timestamp' && metaRow.key !== 'type') {
                      driveInfo[metaRow.key] = metaRow.value;
                    }
                  }
                } catch (legacyError) {
                  console.warn(`No legacy backup_metadata found for ${file}`);
                }
              }
              
              db.close();
            } catch (error) {
              console.warn(`Failed to read metadata for ${file}:`, error);
            }
            
            backups.push({
              id: `backup_${fileDriveId}${suffix}`,
              type: type as 'drive' | 'catalog',
              driveId,
              driveName,
              timestamp,
              size: stats.size,
              path: filePath,
              ...driveInfo
            });
          } else {
            // Handle old backup files without suffix (fallback)
            const oldMatch = file.match(/^backup_(.+)\.db$/);
            if (oldMatch) {
              const [, fileDriveId] = oldMatch;
              console.log(`Parsing old backup file (no suffix): ${file}, driveId: ${fileDriveId}`);
              
              // Read metadata from database
              let driveId = fileDriveId;
              let driveName = 'Unknown Drive';
              let type = 'drive';
              let timestamp = stats.mtime.getTime(); // Use file modification time as fallback
              let driveInfo: any = {};
              
              try {
                const db = new Database(filePath, { readonly: true });
                
                // First try to read from new drive_metadata table
                const driveMetadata = db.prepare('SELECT * FROM drive_metadata LIMIT 1').get();
                
                if (driveMetadata) {
                  const meta = driveMetadata as any;
                  driveId = meta.id || fileDriveId;
                  driveName = meta.name || 'Unknown Drive';
                  
                  if (meta.added_date) {
                    timestamp = new Date(meta.added_date).getTime();
                  } else if (meta.last_updated) {
                    timestamp = new Date(meta.last_updated).getTime();
                  }
                  
                  driveInfo = {
                    totalCapacity: meta.total_capacity,
                    usedSpace: meta.used_space,
                    freeSpace: meta.free_space,
                    formatType: meta.format_type,
                    fileCount: meta.file_count,
                    addedDate: meta.added_date,
                    lastUpdated: meta.last_updated,
                    scanType: 'unknown'
                  };
                } else {
                  // Fallback to legacy backup_metadata table
                  try {
                    const metadata = db.prepare('SELECT key, value FROM backup_metadata').all();
                    
                    for (const row of metadata) {
                      const metaRow = row as { key: string; value: string };
                      if (metaRow.key === 'driveName') driveName = metaRow.value;
                      if (metaRow.key === 'type') type = metaRow.value;
                      if (metaRow.key === 'timestamp') timestamp = parseInt(metaRow.value);
                      if (metaRow.key !== 'driveId' && metaRow.key !== 'driveName' && metaRow.key !== 'timestamp' && metaRow.key !== 'type') {
                        driveInfo[metaRow.key] = metaRow.value;
                      }
                    }
                  } catch (legacyError) {
                    console.warn(`No legacy backup_metadata found for old backup ${file}`);
                  }
                }
                
                db.close();
              } catch (error) {
                console.warn(`Failed to read metadata for old backup ${file}:`, error);
              }
              
              backups.push({
                id: `backup_${fileDriveId}`, // Old format without suffix
                type: type as 'drive' | 'catalog',
                driveId,
                driveName,
                timestamp,
                size: stats.size,
                path: filePath,
                ...driveInfo
              });
            }
          }
        }
      }

      // Sort by timestamp (newest first)
      return backups.sort((a, b) => b.timestamp - a.timestamp);
    } catch (error) {
      console.error('Failed to get available backups:', error);
      return [];
    }
  }

  /**
   * Restore a drive from backup
   */
  async restoreDrive(backupInfo: BackupInfo): Promise<RestoreResult> {
    try {
      console.log('=== STARTING DRIVE RESTORE ===');
      console.log('Backup info:', JSON.stringify(backupInfo, null, 2));

      if (backupInfo.type !== 'drive') {
        console.error('Invalid backup type:', backupInfo.type);
        return { success: false, message: 'Invalid backup type for drive restore' };
      }

      if (!fs.existsSync(backupInfo.path)) {
        console.error('Backup file not found:', backupInfo.path);
        return { success: false, message: 'Backup file not found' };
      }

      // Get the target directory (parent of backups folder)
      const userStorageDir = path.dirname(path.dirname(backupInfo.path));
      console.log('User storage directory:', userStorageDir);

      // Read metadata from backup database
      console.log('Reading drive metadata from backup...');
      const db = new Database(backupInfo.path, { readonly: true });
      
      // Check if drive_metadata table exists
      const hasMetadataTable = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='drive_metadata'
      `).get();
      
      let driveInfo: any = {};
      let originalDriveId = backupInfo.driveId;
      
      if (hasMetadataTable) {
        console.log('Found drive_metadata table, reading drive information...');
        const metadataRow = db.prepare('SELECT * FROM drive_metadata LIMIT 1').get();
        
        if (metadataRow) {
          const meta = metadataRow as any;
          console.log('Drive metadata from backup:', meta);
          
          originalDriveId = meta.id;
          driveInfo = {
            id: meta.id,
            name: meta.name,
            path: meta.path,
            totalCapacity: meta.total_capacity,
            usedSpace: meta.used_space,
            freeSpace: meta.free_space,
            formatType: meta.format_type,
            lastScan: meta.last_scan,
            fileCount: meta.file_count,
            status: meta.status,
            addedDate: meta.added_date,
            lastUpdated: meta.last_updated
          };
          console.log('Extracted drive info from metadata:', driveInfo);
        } else {
          console.log('drive_metadata table exists but is empty');
        }
      } else {
        console.log('No drive_metadata table found, checking legacy backup_metadata...');
        
        // Fall back to legacy backup_metadata for old backups
        try {
          const metadata = db.prepare('SELECT key, value FROM backup_metadata').all();
          console.log('Legacy backup metadata:', metadata);
          
          if (metadata && metadata.length > 0) {
            console.log('Processing legacy backup metadata entries:', metadata.length);
            
            // First pass to get the drive ID
            for (const row of metadata) {
              const metaRow = row as { key: string; value: string };
              if (metaRow.key === 'driveId') {
                originalDriveId = metaRow.value;
                console.log('Found driveId in legacy metadata:', originalDriveId);
                break;
              }
            }

            // Second pass for other metadata
            for (const row of metadata) {
              const metaRow = row as { key: string; value: string };
              console.log(`Processing legacy metadata: ${metaRow.key} = ${metaRow.value}`);
              
              if (metaRow.key !== 'driveId' && metaRow.key !== 'timestamp' && metaRow.key !== 'type') {
                try {
                  driveInfo[metaRow.key] = JSON.parse(metaRow.value);
                  console.log(`Parsed ${metaRow.key} as JSON:`, driveInfo[metaRow.key]);
                } catch {
                  driveInfo[metaRow.key] = metaRow.value;
                  console.log(`Using ${metaRow.key} as string:`, metaRow.value);
                }
              }
            }
          }
        } catch (legacyError) {
          console.log('No legacy backup_metadata table found either');
        }
      }
      
      db.close();

      // Final fallback to backup info properties if no metadata found
      if (!originalDriveId || Object.keys(driveInfo).length === 0) {
        console.log('No metadata found in backup, using backup info directly');
        originalDriveId = backupInfo.driveId;
        if (backupInfo.driveName) {
          driveInfo.name = backupInfo.driveName;
          driveInfo.driveName = backupInfo.driveName;
        }
        if (backupInfo.totalCapacity) driveInfo.totalCapacity = backupInfo.totalCapacity;
        if (backupInfo.usedSpace) driveInfo.usedSpace = backupInfo.usedSpace;
        if (backupInfo.freeSpace) driveInfo.freeSpace = backupInfo.freeSpace;
        if (backupInfo.formatType) driveInfo.formatType = backupInfo.formatType;
        if (backupInfo.serialNumber) driveInfo.serialNumber = backupInfo.serialNumber;
        if (backupInfo.addedDate) driveInfo.addedDate = backupInfo.addedDate;
        if (backupInfo.fileCount) driveInfo.fileCount = backupInfo.fileCount;
      }
      
      if (!originalDriveId) {
        throw new Error('Could not find drive ID in backup metadata or backup info');
      }
      
      console.log('Original drive ID:', originalDriveId);
      console.log('Reconstructed drive info:', driveInfo);

      // Extract the suffix from the backup filename to restore with correct naming
      const backupFileName = path.basename(backupInfo.path);
      console.log(`Backup filename: ${backupFileName}`);
      
      // Parse the backup filename to extract the original suffix
      let suffix = '_init'; // default suffix
      const match = backupFileName.match(/^backup_.+?(_(?:init|sync\d+))\.db$/);
      if (match) {
        suffix = match[1];
        console.log(`Extracted suffix from backup: ${suffix}`);
      } else {
        console.log(`Could not extract suffix from backup ${backupFileName}, using default: ${suffix}`);
      }

      // Set up target path using original drive ID with preserved suffix
      const targetDriveDbPath = path.join(userStorageDir, `${originalDriveId}${suffix}.db`);
      console.log('Target path:', targetDriveDbPath);
      
      // Copy backup to target location
      console.log('Copying backup database to target location...');
      await fs.copy(backupInfo.path, targetDriveDbPath);
      console.log('Database file restored successfully');

      // Re-add drive to catalog and initialize it
      console.log('Adding drive back to catalog...');
      const catalogRestored = await this.storageManager.addDriveToCatalog(originalDriveId, driveInfo);
      if (!catalogRestored) {
        throw new Error('Failed to add drive back to catalog');
      }
      console.log('Drive added to catalog successfully');

      // Initialize the drive database connection
      console.log('Initializing drive database connection...');
      await this.storageManager.initializeDriveDatabase(originalDriveId);
      console.log('Drive database initialized');

      // Rebuild search index for this drive
      console.log('Rebuilding search index...');
      await this.storageManager.rebuildSearchIndexForDrive(originalDriveId);
      console.log('Search index rebuilt successfully');

      // Verify the drive is now in the catalog
      const restoredDrive = await this.storageManager.getDriveById(originalDriveId);
      console.log('Verified restored drive in catalog:', restoredDrive);

      console.log('=== DRIVE RESTORE COMPLETED SUCCESSFULLY ===');
      return { 
        success: true, 
        message: `Drive ${driveInfo.driveName || driveInfo.name || originalDriveId} restored successfully`,
        restoredFiles: [targetDriveDbPath],
        restoredDrive: restoredDrive
      };
    } catch (error: unknown) {
      console.error('=== DRIVE RESTORE FAILED ===');
      console.error('Error:', error instanceof Error ? error.message : String(error));
      console.error('Stack:', error instanceof Error ? error.stack : undefined);
      return { success: false, message: `Restore failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  /**
   * Restore catalog from backup
   */
  async restoreCatalog(backupInfo: BackupInfo, targetCatalogPath: string): Promise<RestoreResult> {
    try {
      if (backupInfo.type !== 'catalog') {
        return { success: false, message: 'Invalid backup type for catalog restore' };
      }

      if (!fs.existsSync(backupInfo.path)) {
        return { success: false, message: 'Backup file not found' };
      }

      // Ensure target directory exists
      fs.ensureDirSync(path.dirname(targetCatalogPath));

      // Copy backup to target location
      await fs.copy(backupInfo.path, targetCatalogPath);

      console.log(`Restored catalog from backup ${backupInfo.id}`);
      return { 
        success: true, 
        message: 'Catalog restored successfully',
        restoredFiles: [targetCatalogPath]
      };
    } catch (error: unknown) {
      console.error('Failed to restore catalog:', error);
      return { success: false, message: `Restore failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  /**
   * Delete old backups to manage storage
   */
  async cleanupOldBackups(maxAgeDays: number = 30): Promise<number> {
    try {
      const cutoffTime = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);
      let deletedCount = 0;

      const backups = await this.getAvailableBackups();
      
      for (const backup of backups) {
        if (backup.timestamp < cutoffTime) {
          try {
            await fs.remove(backup.path);
            deletedCount++;
            console.log(`Deleted old backup: ${backup.id}`);
          } catch (error) {
            console.error(`Failed to delete backup ${backup.id}:`, error);
          }
        }
      }

      return deletedCount;
    } catch (error) {
      console.error('Failed to cleanup old backups:', error);
      return 0;
    }
  }

  /**
   * Get total backup storage usage
   */
  async getBackupStorageUsage(): Promise<{ totalSize: number; fileCount: number }> {
    try {
      const backups = await this.getAvailableBackups();
      const totalSize = backups.reduce((sum, backup) => sum + backup.size, 0);
      
      return {
        totalSize,
        fileCount: backups.length
      };
    } catch (error) {
      console.error('Failed to get backup storage usage:', error);
      return { totalSize: 0, fileCount: 0 };
    }
  }

  /**
   * Validate backup file integrity
   */
  async validateBackup(backupInfo: BackupInfo): Promise<boolean> {
    try {
      if (!fs.existsSync(backupInfo.path)) {
        return false;
      }

      // Try to open the database to validate it's not corrupted
      const db = new Database(backupInfo.path, { readonly: true });
      
      if (backupInfo.type === 'drive') {
        // Check if it has the expected tables
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
        db.close();
        return tables.length > 0;
      } else if (backupInfo.type === 'catalog') {
        // Check if it has the expected tables
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
        db.close();
        return tables.some((table: any) => table.name === 'drives' || table.name === 'files');
      }

      return false;
    } catch (error) {
      console.error(`Failed to validate backup ${backupInfo.id}:`, error);
      return false;
    }
  }

  /**
   * Delete a specific backup by ID
   */
  async deleteBackup(backupId: string): Promise<boolean> {
    try {
      const backups = await this.getAvailableBackups();
      const backup = backups.find(b => b.id === backupId);
      
      if (!backup) {
        console.log(`Backup not found: ${backupId}`);
        return false;
      }

      if (!fs.existsSync(backup.path)) {
        console.log(`Backup file not found: ${backup.path}`);
        return false;
      }

      await fs.remove(backup.path);
      console.log(`Deleted backup: ${backupId} (${backup.path})`);
      return true;
    } catch (error) {
      console.error(`Failed to delete backup ${backupId}:`, error);
      return false;
    }
  }

  /**
   * Get root files from a backup database (mirroring listRoot from storage manager)
   */
  async listBackupRoot(backupId: string): Promise<any[]> {
    try {
      const backups = await this.getAvailableBackups();
      const backup = backups.find(b => b.id === backupId);
      
      if (!backup || !fs.existsSync(backup.path)) {
        console.log(`Backup not found or file doesn't exist: ${backupId}`);
        return [];
      }

      console.log(`Opening backup database: ${backup.path}`);
      const db = new Database(backup.path, { readonly: true });
      
      // Query for files that are at the root level (mirroring the main app pattern)
      const query = `
        SELECT 
          id,
          name,
          path,
          parent_path as parentPath,
          is_directory as isDirectory,
          size,
          created,
          modified as modifiedDate
        FROM files 
        WHERE (parent_path = '' OR parent_path IS NULL)
          AND deleted = 0
        ORDER BY is_directory DESC, name ASC
        LIMIT 1000
      `;

      const files = db.prepare(query).all();
      db.close();

      console.log(`Retrieved ${files.length} root files from backup ${backupId}`);

      // Convert to display format matching FileMetadata interface
      return files.map((file: any) => ({
        id: file.id || `backup-${backupId}-${file.name}`,
        name: file.name || 'Unknown',
        path: file.path || '',
        parentPath: file.parentPath || '',
        size: file.size || 0,
        isDirectory: file.isDirectory === 1,
        created: file.created,
        modified: file.modifiedDate,
        driveId: backupId, // Use backupId as driveId for compatibility
        folderPath: file.path || '',
        depth: 0
      }));
    } catch (error) {
      console.error(`Failed to get root files for backup ${backupId}:`, error);
      return [];
    }
  }

  /**
   * Get children files from a backup database (mirroring listChildren from storage manager)
   */
  async listBackupChildren(backupId: string, parentPath: string, limit: number = 500, offset: number = 0): Promise<{ files: any[]; hasMore: boolean }> {
    try {
      const backups = await this.getAvailableBackups();
      const backup = backups.find(b => b.id === backupId);
      
      if (!backup || !fs.existsSync(backup.path)) {
        console.log(`Backup not found or file doesn't exist: ${backupId}`);
        return { files: [], hasMore: false };
      }

      const db = new Database(backup.path, { readonly: true });
      
      // Query for children of the specified parent path
      let query = `
        SELECT 
          id,
          name,
          path,
          parent_path as parentPath,
          is_directory as isDirectory,
          size,
          created,
          modified as modifiedDate
        FROM files 
        WHERE parent_path = ? 
          AND deleted = 0
        ORDER BY is_directory DESC, name ASC
      `;

      if (limit) {
        query += ` LIMIT ${limit + 1}`;
        if (offset) {
          query += ` OFFSET ${offset}`;
        }
      }

      const files = db.prepare(query).all(parentPath);
      
      // Check if there are more files
      const hasMore = files.length > limit;
      const resultFiles = hasMore ? files.slice(0, limit) : files;

      db.close();

      console.log(`Retrieved ${resultFiles.length} children for path '${parentPath}' from backup ${backupId}`);

      // Convert to display format matching FileMetadata interface
      const convertedFiles = resultFiles.map((file: any) => ({
        id: file.id || `backup-${backupId}-${file.name}`,
        name: file.name || 'Unknown',
        path: file.path || '',
        parentPath: file.parentPath || '',
        size: file.size || 0,
        isDirectory: file.isDirectory === 1,
        created: file.created,
        modified: file.modifiedDate,
        driveId: backupId, // Use backupId as driveId for compatibility
        folderPath: file.path || '',
        depth: (parentPath.split('/').length - 1) + 1
      }));

      return { files: convertedFiles, hasMore };
    } catch (error) {
      console.error(`Failed to get children for backup ${backupId}, path ${parentPath}:`, error);
      return { files: [], hasMore: false };
    }
  }

  /**
   * Get backups grouped by drive with proper sequencing
   */
  async getGroupedBackups(): Promise<any[]> {
    try {
      const allBackups = await this.getAvailableBackups();
      const groupedMap = new Map<string, any[]>();
      
      // Group backups by drive ID
      for (const backup of allBackups) {
        if (backup.driveId && backup.type === 'drive') {
          if (!groupedMap.has(backup.driveId)) {
            groupedMap.set(backup.driveId, []);
          }
          
          // Parse sequence number from filename suffix
          let backupSequence = 0;
          let scanType: 'initial' | 'sync' | 'unknown' = 'unknown';
          
          const fileName = path.basename(backup.path);
          const match = fileName.match(/backup_.+?_(init|sync(\d+))\.db$/);
          if (match) {
            if (match[1] === 'init') {
              scanType = 'initial';
              backupSequence = 0;
            } else if (match[2]) {
              scanType = 'sync';
              backupSequence = parseInt(match[2]);
            }
          }
          
          // Update backup with parsed info
          const enhancedBackup = {
            ...backup,
            scanType,
            backupSequence
          };
          
          groupedMap.get(backup.driveId)!.push(enhancedBackup);
        }
      }
      
      // Convert to grouped format and sort
      const grouped: any[] = [];
      
      for (const [driveId, backups] of groupedMap.entries()) {
        // Sort backups by sequence (init first, then sync1, sync2, etc.)
        backups.sort((a, b) => {
          if (a.backupSequence !== b.backupSequence) {
            return a.backupSequence - b.backupSequence;
          }
          return b.timestamp - a.timestamp; // Fallback to timestamp
        });
        
        const latestBackup = backups[backups.length - 1]; // Most recent backup
        const driveName = latestBackup.driveName || backups.find((b: any) => b.driveName)?.driveName || 'Unknown Drive';
        
        grouped.push({
          driveId,
          driveName,
          backups,
          latestBackup,
          totalBackups: backups.length
        });
      }
      
      // Sort groups by most recent backup timestamp
      return grouped.sort((a, b) => b.latestBackup.timestamp - a.latestBackup.timestamp);
    } catch (error) {
      console.error('Failed to get grouped backups:', error);
      return [];
    }
  }

  /**
   * Get all files from a backup database to build hierarchical tree
   */
  async getBackupFileTree(backupId: string): Promise<any[]> {
    try {
      const backups = await this.getAvailableBackups();
      const backup = backups.find(b => b.id === backupId);
      
      if (!backup || !fs.existsSync(backup.path)) {
        console.log(`Backup not found or file doesn't exist: ${backupId}`);
        return [];
      }

      console.log(`Opening backup database for file tree: ${backup.path}`);
      const db = new Database(backup.path, { readonly: true });
      
      // Get ALL files (not just root) to build proper hierarchy
      const query = `
        SELECT 
          id,
          name,
          path,
          parent_path as parentPath,
          is_directory as isDirectory,
          size,
          created,
          modified as modifiedDate
        FROM files 
        WHERE deleted = 0
        ORDER BY is_directory DESC, name ASC
        LIMIT 5000
      `;

      const files = db.prepare(query).all();
      db.close();

      console.log(`Retrieved ${files.length} total files from backup ${backupId}`);

      // Convert to display format matching FileMetadata interface
      return files.map((file: any) => ({
        id: file.id || `backup-${backupId}-${file.name}`,
        name: file.name || 'Unknown',
        path: file.path || '',
        parentPath: file.parentPath || '',
        size: file.size || 0,
        isDirectory: file.isDirectory === 1,
        created: file.created,
        modified: file.modifiedDate,
        driveId: backupId, // Use backupId as driveId for compatibility
        folderPath: file.path || '',
        depth: (file.parentPath || '').split('/').length - 1
      }));
    } catch (error) {
      console.error(`Failed to get file tree for backup ${backupId}:`, error);
      return [];
    }
  }
}
