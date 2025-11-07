# Row-Level Security (RLS) Setup Guide

This guide explains how to set up Row-Level Security (RLS) policies for the Archivist app to ensure users can only access their own data.

## What is Row-Level Security?

Row-Level Security (RLS) is a security feature that restricts which rows users can access in database tables. In our app, this ensures that:

- Users can only see their own drives, files, and metadata
- Users cannot access other users' data
- Unauthenticated users cannot access any data
- All data operations are automatically filtered by user ID

## Database Schema

Our RLS implementation uses the following tables:

### 1. Profiles Table
```sql
CREATE TABLE public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT UNIQUE,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### 2. Drives Table
```sql
CREATE TABLE public.drives (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  total_capacity BIGINT DEFAULT 0,
  used_space BIGINT DEFAULT 0,
  free_space BIGINT DEFAULT 0,
  serial_number TEXT,
  format_type TEXT,
  added_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### 3. Files Table
```sql
CREATE TABLE public.files (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  drive_id UUID REFERENCES public.drives(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  parent_path TEXT,
  size BIGINT DEFAULT 0,
  created_at_file TIMESTAMP WITH TIME ZONE,
  modified_at_file TIMESTAMP WITH TIME ZONE,
  is_directory BOOLEAN DEFAULT FALSE,
  folder_path TEXT NOT NULL,
  depth INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### 4. Metadata Table
```sql
CREATE TABLE public.metadata (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  folder_path TEXT NOT NULL,
  metadata_type TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, folder_path, metadata_type, key)
);
```

## RLS Policies

Each table has RLS enabled with the following policies:

### Profiles Policies
- **SELECT**: Users can view their own profile
- **UPDATE**: Users can update their own profile
- **INSERT**: Users can insert their own profile

### Drives Policies
- **SELECT**: Users can view their own drives
- **INSERT**: Users can create their own drives
- **UPDATE**: Users can update their own drives
- **DELETE**: Users can delete their own drives

### Files Policies
- **SELECT**: Users can view their own files
- **INSERT**: Users can create their own files
- **UPDATE**: Users can update their own files
- **DELETE**: Users can delete their own files

### Metadata Policies
- **SELECT**: Users can view their own metadata
- **INSERT**: Users can create their own metadata
- **UPDATE**: Users can update their own metadata
- **DELETE**: Users can delete their own metadata

## Setup Instructions

### 1. Create the Database Schema

1. Go to your Supabase dashboard
2. Navigate to **SQL Editor**
3. Copy and paste the contents of `supabase-schema.sql`
4. Click **Run** to execute the schema

### 2. Verify RLS is Enabled

1. Go to **Table Editor** in your Supabase dashboard
2. Check that each table shows "RLS enabled" in the table info
3. Verify that policies are listed under each table

### 3. Test the RLS Policies

1. Create a test user in your Supabase dashboard:
   - Go to **Authentication > Users**
   - Click **Add User**
   - Enter email: `test@example.com`
   - Set password: `testpassword123`

2. Run the RLS test:
   ```bash
   node test-rls-policies.js
   ```

3. Verify that:
   - Unauthenticated access is blocked
   - Authenticated users can create/read their own data
   - Cross-user access is blocked

## Security Benefits

### 1. Data Isolation
- Each user's data is completely isolated
- No user can access another user's drives, files, or metadata
- Even if a user knows another user's ID, they cannot access their data

### 2. Automatic Filtering
- All queries are automatically filtered by user ID
- No need to manually add `WHERE user_id = ?` to every query
- Reduces the chance of accidentally exposing other users' data

### 3. Defense in Depth
- RLS works at the database level
- Even if there's a bug in the application code, RLS prevents data leaks
- Provides an additional layer of security beyond application-level checks

## Implementation in the App

The app uses the `SupabaseDatabase` class (`src/supabase-database.ts`) which:

1. **Automatically handles authentication**: All database operations require a valid user session
2. **Provides type-safe operations**: TypeScript interfaces ensure data consistency
3. **Includes error handling**: Proper error handling for RLS violations
4. **Supports migration**: Helper functions to migrate from local storage to Supabase

## Testing RLS Policies

### Manual Testing

1. **Unauthenticated Access**:
   ```javascript
   const { data, error } = await supabase.from('drives').select('*');
   // Should return error or empty array
   ```

2. **Authenticated Access**:
   ```javascript
   await supabase.auth.signInWithPassword({ email, password });
   const { data, error } = await supabase.from('drives').select('*');
   // Should return only user's drives
   ```

3. **Cross-User Access**:
   ```javascript
   const { data, error } = await supabase
     .from('drives')
     .select('*')
     .eq('user_id', 'different-user-id');
   // Should return empty array
   ```

### Automated Testing

Run the test script:
```bash
node test-rls-policies.js
```

This will test:
- ✅ Unauthenticated access blocking
- ✅ Authenticated user data access
- ✅ Cross-user access blocking
- ✅ CRUD operations for all tables

## Troubleshooting

### Common Issues

1. **"RLS policy violation" errors**:
   - Check that the user is authenticated
   - Verify the user_id matches the authenticated user
   - Ensure the table has RLS enabled

2. **"No rows returned" when expecting data**:
   - Check that the user_id in the query matches the authenticated user
   - Verify that the data belongs to the authenticated user

3. **"Permission denied" errors**:
   - Ensure the user is signed in
   - Check that the RLS policies are correctly configured
   - Verify the table has RLS enabled

### Debugging Tips

1. **Check user authentication**:
   ```javascript
   const { data: { user } } = await supabase.auth.getUser();
   console.log('Current user:', user?.id);
   ```

2. **Verify RLS policies**:
   - Go to Supabase dashboard > Table Editor
   - Check that RLS is enabled for each table
   - Verify policies are listed and active

3. **Test with SQL Editor**:
   ```sql
   -- Check if RLS is enabled
   SELECT schemaname, tablename, rowsecurity 
   FROM pg_tables 
   WHERE schemaname = 'public';
   ```

## Best Practices

1. **Always use the SupabaseDatabase class**: This ensures consistent RLS handling
2. **Test RLS policies regularly**: Run the test script after any schema changes
3. **Monitor for RLS violations**: Check Supabase logs for policy violations
4. **Use type-safe operations**: Leverage TypeScript interfaces for data consistency
5. **Implement proper error handling**: Handle RLS violations gracefully in the UI

## Migration from Local Storage

The `SupabaseDatabase` class includes a migration helper:

```javascript
// Migrate from local JSON storage to Supabase
const success = await supabaseDatabase.migrateFromLocalStorage(
  localDrives,  // Array of drives from local storage
  localFiles    // Array of files from local storage
);
```

This will:
- Create Supabase records for each local drive
- Create Supabase records for each local file
- Maintain the user association
- Preserve all metadata and relationships 