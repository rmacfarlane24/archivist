// Export all types needed by the StorageManager interface

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

export interface FileInfo {
  id: string;
  name: string;
  path: string;
  parentPath: string | null;
  size: number;
  created: string | null;
  modified: string | null;
  isDirectory: boolean;
  folderPath: string;
  driveId: string;
  depth: number;
  inode?: number;
  hardLinkCount?: number;
  isHardLink?: boolean;
  hardLinkGroup?: string;
  file_type?: string;
}

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

export interface ScanProgress {
  type: 'start' | 'progress' | 'complete' | 'batch' | 'streaming-progress';
  driveId?: string;
  files?: Omit<FileInfo, 'id'>[];
  processed?: number;
  total?: number; // Add total count for accurate progress calculation
  errors?: number;
  message: string;
  rate?: string;
  memoryUsage?: any;
  errorMessages?: string[];
}

// Recovery functionality removed for MVP
