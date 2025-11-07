import { supabase } from './supabase';

// Database types that match our Supabase schema
export interface DatabaseProfile {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface DatabaseDrive {
  id: string;
  user_id: string;
  name: string;
  path: string;
  total_capacity: number;
  used_space: number;
  free_space: number;
  serial_number: string | null;
  format_type: string | null;
  added_date: string;
  created_at: string;
  updated_at: string;
}

export interface DatabaseFile {
  id: string;
  user_id: string;
  drive_id: string;
  name: string;
  path: string;
  parent_path: string | null;
  size: number;
  created_at_file: string | null;
  modified_at_file: string | null;
  is_directory: boolean;
  folder_path: string;
  depth: number;
  created_at: string;
  updated_at: string;
}

export interface DatabaseMetadata {
  id: string;
  user_id: string;
  folder_path: string;
  metadata_type: string;
  key: string;
  value: string | null;
  created_at: string;
  updated_at: string;
}

// Database operations with RLS support
export class SupabaseDatabase {
  // Profile operations
  async getProfile(userId: string): Promise<DatabaseProfile | null> {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) {
      console.error('Error fetching profile:', error);
      return null;
    }

    return data;
  }

  async upsertProfile(profile: Partial<DatabaseProfile>): Promise<DatabaseProfile | null> {
    const { data, error } = await supabase
      .from('profiles')
      .upsert(profile)
      .select()
      .single();

    if (error) {
      console.error('Error upserting profile:', error);
      return null;
    }

    return data;
  }

  // Drive operations
  async getDrives(): Promise<DatabaseDrive[]> {
    const { data, error } = await supabase
      .from('drives')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching drives:', error);
      return [];
    }

    return data || [];
  }

  async getDrive(driveId: string): Promise<DatabaseDrive | null> {
    const { data, error } = await supabase
      .from('drives')
      .select('*')
      .eq('id', driveId)
      .single();

    if (error) {
      console.error('Error fetching drive:', error);
      return null;
    }

    return data;
  }

  async createDrive(drive: Omit<DatabaseDrive, 'id' | 'created_at' | 'updated_at'>): Promise<DatabaseDrive | null> {
    const { data, error } = await supabase
      .from('drives')
      .insert(drive)
      .select()
      .single();

    if (error) {
      console.error('Error creating drive:', error);
      return null;
    }

    return data;
  }

  async updateDrive(driveId: string, updates: Partial<DatabaseDrive>): Promise<DatabaseDrive | null> {
    const { data, error } = await supabase
      .from('drives')
      .update(updates)
      .eq('id', driveId)
      .select()
      .single();

    if (error) {
      console.error('Error updating drive:', error);
      return null;
    }

    return data;
  }

  async deleteDrive(driveId: string): Promise<boolean> {
    const { error } = await supabase
      .from('drives')
      .delete()
      .eq('id', driveId);

    if (error) {
      console.error('Error deleting drive:', error);
      return false;
    }

    return true;
  }

  // File operations
  async getFiles(driveId: string): Promise<DatabaseFile[]> {
    const { data, error } = await supabase
      .from('files')
      .select('*')
      .eq('drive_id', driveId)
      .order('name', { ascending: true });

    if (error) {
      console.error('Error fetching files:', error);
      return [];
    }

    return data || [];
  }

  async getFile(fileId: string): Promise<DatabaseFile | null> {
    const { data, error } = await supabase
      .from('files')
      .select('*')
      .eq('id', fileId)
      .single();

    if (error) {
      console.error('Error fetching file:', error);
      return null;
    }

    return data;
  }

  async createFile(file: Omit<DatabaseFile, 'id' | 'created_at' | 'updated_at'>): Promise<DatabaseFile | null> {
    const { data, error } = await supabase
      .from('files')
      .insert(file)
      .select()
      .single();

    if (error) {
      console.error('Error creating file:', error);
      return null;
    }

    return data;
  }

  async createFiles(files: Omit<DatabaseFile, 'id' | 'created_at' | 'updated_at'>[]): Promise<DatabaseFile[]> {
    if (files.length === 0) return [];

    const { data, error } = await supabase
      .from('files')
      .insert(files)
      .select();

    if (error) {
      console.error('Error creating files:', error);
      return [];
    }

    return data || [];
  }

  async updateFile(fileId: string, updates: Partial<DatabaseFile>): Promise<DatabaseFile | null> {
    const { data, error } = await supabase
      .from('files')
      .update(updates)
      .eq('id', fileId)
      .select()
      .single();

    if (error) {
      console.error('Error updating file:', error);
      return null;
    }

    return data;
  }

  async deleteFile(fileId: string): Promise<boolean> {
    const { error } = await supabase
      .from('files')
      .delete()
      .eq('id', fileId);

    if (error) {
      console.error('Error deleting file:', error);
      return false;
    }

    return true;
  }

  async deleteFilesByDrive(driveId: string): Promise<boolean> {
    const { error } = await supabase
      .from('files')
      .delete()
      .eq('drive_id', driveId);

    if (error) {
      console.error('Error deleting files by drive:', error);
      return false;
    }

    return true;
  }

  // Metadata operations
  async getMetadata(folderPath: string, metadataType?: string): Promise<DatabaseMetadata[]> {
    let query = supabase
      .from('metadata')
      .select('*')
      .eq('folder_path', folderPath);

    if (metadataType) {
      query = query.eq('metadata_type', metadataType);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching metadata:', error);
      return [];
    }

    return data || [];
  }

  async createMetadata(metadata: Omit<DatabaseMetadata, 'id' | 'created_at' | 'updated_at'>): Promise<DatabaseMetadata | null> {
    const { data, error } = await supabase
      .from('metadata')
      .insert(metadata)
      .select()
      .single();

    if (error) {
      console.error('Error creating metadata:', error);
      return null;
    }

    return data;
  }

  async updateMetadata(metadataId: string, updates: Partial<DatabaseMetadata>): Promise<DatabaseMetadata | null> {
    const { data, error } = await supabase
      .from('metadata')
      .update(updates)
      .eq('id', metadataId)
      .select()
      .single();

    if (error) {
      console.error('Error updating metadata:', error);
      return null;
    }

    return data;
  }

  async deleteMetadata(metadataId: string): Promise<boolean> {
    const { error } = await supabase
      .from('metadata')
      .delete()
      .eq('id', metadataId);

    if (error) {
      console.error('Error deleting metadata:', error);
      return false;
    }

    return true;
  }

  // Statistics and helper functions
  async getUserStorageUsage(): Promise<{ total_files: number; total_size: number } | null> {
    const { data, error } = await supabase
      .rpc('get_user_storage_usage', { user_uuid: (await supabase.auth.getUser()).data.user?.id });

    if (error) {
      console.error('Error getting user storage usage:', error);
      return null;
    }

    return data?.[0] || { total_files: 0, total_size: 0 };
  }

  async getDriveStats(driveId: string): Promise<{ file_count: number; total_size: number; directory_count: number } | null> {
    const { data, error } = await supabase
      .rpc('get_drive_stats', { drive_uuid: driveId });

    if (error) {
      console.error('Error getting drive stats:', error);
      return null;
    }

    return data?.[0] || { file_count: 0, total_size: 0, directory_count: 0 };
  }

  // Migration helper - convert local storage to Supabase
  async migrateFromLocalStorage(localDrives: any[], localFiles: any[]): Promise<boolean> {
    try {
      const user = (await supabase.auth.getUser()).data.user;
      if (!user) {
        console.error('No authenticated user for migration');
        return false;
      }

      // Migrate drives
      for (const drive of localDrives) {
        const driveData = {
          user_id: user.id,
          name: drive.name,
          path: drive.path,
          total_capacity: drive.totalCapacity || 0,
          used_space: drive.usedSpace || 0,
          free_space: drive.freeSpace || 0,
          serial_number: drive.serialNumber || null,
          format_type: drive.formatType || null,
          added_date: drive.addedDate || new Date().toISOString()
        };

        const createdDrive = await this.createDrive(driveData);
        if (!createdDrive) {
          console.error('Failed to migrate drive:', drive.name);
          continue;
        }

        // Migrate files for this drive
        const driveFiles = localFiles.filter(file => file.driveId === drive.id);
        const fileData = driveFiles.map(file => ({
          user_id: user.id,
          drive_id: createdDrive.id,
          name: file.name,
          path: file.path,
          parent_path: file.parentPath || null,
          size: file.size || 0,
          created_at_file: file.created || null,
          modified_at_file: file.modified || null,
          is_directory: file.isDirectory || false,
          folder_path: file.folderPath || '',
          depth: file.depth || 0
        }));

        if (fileData.length > 0) {
          await this.createFiles(fileData);
        }
      }

      return true;
    } catch (error) {
      console.error('Migration failed:', error);
      return false;
    }
  }
}

// Export a singleton instance
export const supabaseDatabase = new SupabaseDatabase(); 