# Supabase Setup Guide

This guide explains how to set up Supabase for the Archivist app, including authentication, database configuration, and admin operations.

## Environment Variables

### Required Variables

Create a `.env` file in your project root with the following variables:

```bash
# Supabase Configuration
REACT_APP_SUPABASE_URL=https://your-project-id.supabase.co
REACT_APP_SUPABASE_ANON_KEY=your-anon-key-here

# Admin Operations (Optional)
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

### Getting Your Supabase Credentials

1. **Go to your Supabase Dashboard**
2. **Navigate to Settings > API**
3. **Copy the following values:**
   - **Project URL**: Use as `REACT_APP_SUPABASE_URL`
   - **anon public**: Use as `REACT_APP_SUPABASE_ANON_KEY`
   - **service_role secret**: Use as `SUPABASE_SERVICE_ROLE_KEY` (for admin operations)

## Database Schema Setup

### Option A: SQL Editor (Recommended)

1. Go to your Supabase dashboard
2. Navigate to **SQL Editor**
3. Copy and paste the contents of `supabase-schema.sql`
4. Click **Run** to execute the schema

### Option B: Incremental Updates

If you already have some tables created, use `supabase-schema-incremental.sql` instead:

1. Go to your Supabase dashboard
2. Navigate to **SQL Editor**
3. Copy and paste the contents of `supabase-schema-incremental.sql`
4. Click **Run** to execute the incremental updates

## Row-Level Security (RLS)

The database schema includes comprehensive RLS policies that ensure:

- **Data Isolation**: Users can only access their own data
- **Automatic Filtering**: All queries are filtered by user ID
- **Unauthenticated Access Blocked**: No data access without authentication
- **Cross-User Access Blocked**: Users cannot access other users' data

### RLS Policies Implemented

- **Profiles**: Users can only view/update their own profile
- **Drives**: Users can only access their own drives
- **Files**: Users can only access their own files
- **Metadata**: Users can only access their own metadata

## Admin Operations (Service Role Key)

### What is the Service Role Key?

The service role key provides admin-level access to your Supabase database, bypassing RLS policies. This is used for:

- **User Management**: Create, update, delete users
- **Data Management**: Access any user's data
- **System Operations**: Get system statistics, cleanup orphaned data
- **Backup Operations**: Create user data backups

### Security Considerations

⚠️ **IMPORTANT**: The service role key has full admin access to your database. Keep it secure:

1. **Never expose it to the client-side code**
2. **Only use it in the Electron main process**
3. **Store it in environment variables**
4. **Rotate it regularly**

### Setting Up Admin Operations

1. **Get your service role key** from Supabase dashboard > Settings > API
2. **Add it to your `.env` file**:
   ```bash
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
   ```
3. **Test the admin operations**:
   ```bash
   node test-admin-operations.js
   ```

### Admin Operations Available

#### User Management
- `getUserById(userId)` - Get user profile by ID
- `updateUserProfile(userId, updates)` - Update user profile
- `deleteUser(userId)` - Delete user and all their data

#### Data Management
- `getAllUserData(userId)` - Get all data for a user
- `deleteUserData(userId)` - Delete all data for a user
- `migrateUserData(fromUserId, toUserId)` - Move data between users

#### System Operations
- `getSystemStats()` - Get system-wide statistics
- `cleanupOrphanedData()` - Remove orphaned data
- `backupUserData(userId)` - Create user data backup

### Using Admin Operations

#### In the Main Process (Electron)
```typescript
import { supabaseAdmin } from './supabase-admin';

// Get system stats
const stats = await supabaseAdmin.getSystemStats();

// Backup user data
const backup = await supabaseAdmin.backupUserData(userId);
```

#### In the Renderer Process (React)
```typescript
import { supabaseAdminClient } from './supabase-admin-client';

// Get system stats via IPC
const stats = await supabaseAdminClient.getSystemStats();

// Backup user data via IPC
const backup = await supabaseAdminClient.backupUserData(userId);
```

## Testing Your Setup

### 1. Test Environment Variables
```bash
node test-env-vars.js
```

### 2. Test RLS Policies
```bash
node test-rls-policies.js
```

### 3. Test Admin Operations
```bash
node test-admin-operations.js
```

### 4. Test Supabase Connection
```bash
node test-supabase.js
```

## Troubleshooting

### Common Issues

1. **"Environment variable not set" errors**:
   - Check that your `.env` file exists and has the correct variable names
   - Ensure the file is in the project root directory
   - Verify the variable names match exactly (including `REACT_APP_` prefix)

2. **"RLS policy violation" errors**:
   - Check that the user is authenticated
   - Verify the user_id matches the authenticated user
   - Ensure the table has RLS enabled

3. **"Service role key not set" errors**:
   - Add `SUPABASE_SERVICE_ROLE_KEY` to your `.env` file
   - Get the key from Supabase dashboard > Settings > API
   - Admin operations will be disabled if not set

4. **"Permission denied" errors**:
   - Ensure the user is signed in
   - Check that RLS policies are correctly configured
   - Verify the table has RLS enabled

### Debugging Tips

1. **Check environment variables**:
   ```javascript
   console.log('SUPABASE_URL:', process.env.REACT_APP_SUPABASE_URL);
   console.log('SUPABASE_ANON_KEY:', process.env.REACT_APP_SUPABASE_ANON_KEY ? 'set' : 'not set');
   console.log('SUPABASE_SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? 'set' : 'not set');
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

1. **Environment Variables**:
   - Use `REACT_APP_` prefix for client-side variables
   - Keep service role key secure and server-side only
   - Never commit `.env` files to version control

2. **Security**:
   - Always use RLS policies for user data
   - Use service role key only for admin operations
   - Implement proper error handling for auth failures

3. **Testing**:
   - Test RLS policies regularly
   - Verify admin operations work correctly
   - Monitor for policy violations

4. **Performance**:
   - Use indexes for frequently queried columns
   - Implement caching where appropriate
   - Monitor query performance

## Migration from Local Storage

The app includes migration helpers to move from local JSON storage to Supabase:

```typescript
// Migrate from local storage to Supabase
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