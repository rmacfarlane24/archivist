# Production Build Configuration

This document explains how the production build process works and how environment variables are handled.

## Build Process

### Development vs Production

- **Development**: Uses Vite dev server with hot reload
- **Production**: Static files built with embedded environment variables

### Build Scripts

```bash
# Development build
npm run build:dev

# Production build (default)
npm run build

# Test production build
npm run test:build

# Package for distribution
npm run package
```

## Environment Variables

### Configuration

Environment variables are configured in `vite.config.ts`:

```typescript
define: {
  'process.env.REACT_APP_SUPABASE_URL': JSON.stringify(env.REACT_APP_SUPABASE_URL),
  'process.env.REACT_APP_SUPABASE_ANON_KEY': JSON.stringify(env.REACT_APP_SUPABASE_ANON_KEY),
  'process.env.NODE_ENV': JSON.stringify(mode),
  'process.env.MODE': JSON.stringify(mode)
}
```

### Variable Types

#### Client-Side Variables (Embedded in Build)
- `REACT_APP_SUPABASE_URL` - Supabase project URL
- `REACT_APP_SUPABASE_ANON_KEY` - Supabase anonymous key

#### Server-Side Variables (Main Process Only)
- `SUPABASE_SERVICE_ROLE_KEY` - Admin operations key
- `NODE_ENV` - Environment mode

## Architecture

### Current Implementation

The app uses a **hybrid architecture**:

1. **Main Process** (`src/main.ts`):
   - Handles all Supabase operations via IPC
   - Has access to all environment variables
   - Manages admin operations with service role key

2. **Renderer Process** (`app/src/`):
   - React frontend
   - Communicates with main process via IPC
   - No direct Supabase access (for security)

### Why Client-Side Variables Aren't Embedded

The environment variables aren't embedded in the client-side bundle because:

1. **Security**: Keeps sensitive keys in main process only
2. **Architecture**: App uses IPC for all database operations
3. **Design**: Prevents client-side access to admin operations

## Testing Production Builds

### Environment Check
```bash
node test-production-env.js
```

### Build Test
```bash
node test-production-build.js
```

### Full Production Test
```bash
npm run test:build
```

## Production Deployment

### 1. Environment Setup
```bash
# Copy template
cp env.production.template .env.production

# Edit with your values
nano .env.production
```

### 2. Build for Production
```bash
npm run build
```

### 3. Test Production Build
```bash
npm run test:production
```

### 4. Package for Distribution
```bash
# macOS
npm run package:mac

# Windows
npm run package:win

# Linux
npm run package:linux
```

## Security Considerations

### ✅ Secure Practices
- Service role key only in main process
- Client-side uses IPC for all operations
- Environment variables properly isolated
- No sensitive keys in client bundle

### ⚠️ Important Notes
- `.env` files should never be committed to version control
- Service role key should be rotated regularly
- Production builds should be tested thoroughly

## Troubleshooting

### Common Issues

1. **"Environment variable not set"**:
   - Check `.env` file exists and has correct values
   - Ensure variable names match exactly

2. **"Build fails"**:
   - Run `npm run build:dev` to test development build
   - Check TypeScript compilation errors

3. **"App doesn't start in production"**:
   - Test with `npm run test:production`
   - Check main process logs

### Debug Commands

```bash
# Check environment variables
node test-env-vars.js

# Test Supabase connection
node test-supabase.js

# Test RLS policies
node test-rls-policies.js

# Test admin operations
node test-admin-operations.js

# Test production build
node test-production-build.js
```

## Build Output

### Files Generated
- `app/dist/` - Frontend build files
- `lib/` - Main process compiled files
- `dist/` - Packaged application

### Distribution
- `dist/` contains the final packaged application
- Ready for distribution to users
- Includes all necessary files and dependencies

## Performance

### Build Optimization
- Vite optimizes the frontend bundle
- TypeScript compilation for main process
- Environment variables embedded at build time

### Runtime Performance
- Static files served from local filesystem
- No network requests for environment variables
- Efficient IPC communication

## Next Steps

1. **Test thoroughly** before distribution
2. **Monitor logs** for any issues
3. **Update documentation** as needed
4. **Consider CI/CD** for automated builds 