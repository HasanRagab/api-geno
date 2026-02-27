# API Geno - Full Feature Support

## Content Type Support

The generated API client now supports multiple content types:

### 1. JSON Bodies (application/json)

```typescript
import { coursesService } from './generated/client.js';

// Send JSON body
const course = await coursesService.coursesCreate({
  params: {},
  body: {
    title: "Advanced TypeScript",
    description: "Learn advanced TypeScript patterns",
    priceUSD: 99.99,
    priceEGP: 1500,
  },
  headers: { 'Authorization': 'Bearer token' }
});
```

### 2. FormData / Multipart Requests (multipart/form-data)

For file uploads and multipart form data:

```typescript
import { uploadService } from './generated/client.js';

// Create FormData manually
const formData = new FormData();
formData.append('file', fileInput.files[0]);
formData.append('description', 'My course thumbnail');
formData.append('courseId', '123');

// Or just pass an object - generates FormData automatically
const result = await uploadService.uploadFile({
  params: {},
  body: {
    file: fileInput.files[0],
    description: 'My course thumbnail',
    courseId: '123'
  },
  headers: { 'Authorization': 'Bearer token' }
});
```

**Benefits:**
- Automatic FormData creation from objects
- File and Blob support via `instanceof File | Blob` detection
- Proper boundary handling by axios
- Note: Content-Type is NOT set (let axios handle it with boundary)

### 3. URL-Encoded Forms (application/x-www-form-urlencoded)

```typescript
import { authService } from './generated/client.js';

const result = await authService.refreshToken({
  params: {},
  body: {
    refreshToken: 'token123',
    clientId: 'app-id',
  }
});
```

## Request Features

### Query Parameters

```typescript
const courses = await coursesService.coursesFindAll({
  params: {
    page: 1,
    limit: 20,
    search: "TypeScript",
    categoryId: "cat-123",
    level: "advanced",
    isPublished: true,
    sortBy: "createdAt",
    sortOrder: "desc"
  }
});
// GET /api/courses?page=1&limit=20&search=TypeScript&...
```

### Path Parameters

```typescript
const course = await coursesService.coursesFindById({
  params: {
    id: "course-123"
  }
});
// GET /api/courses/course-123
```

### Headers

```typescript
const result = await coursesService.coursesCreate({
  params: {},
  body: { ... },
  headers: {
    'Authorization': 'Bearer token123',
    'X-Custom-Header': 'value',
    'X-Request-ID': 'req-123'
  }
});
```

### Cookies

```typescript
const result = await coursesService.coursesCreate({
  params: {},
  body: { ... },
  headers: { 'Authorization': 'Bearer token' },
  cookies: {
    'sessionId': 'sess-abc123',
    'userId': 'user-456'
  }
});
// Automatically converted to: Cookie: sessionId=sess-abc123; userId=user-456
```

## Configuration

All requests respect the global config in `openapi.config.ts`:

```typescript
import { OpenAPI } from './generated/openapi.config.js';

// Set base URL
OpenAPI.BASE = 'https://api.example.com';

// Set default authentication
OpenAPI.TOKEN = 'your-bearer-token';
// OR use a function for dynamic tokens
OpenAPI.TOKEN = async () => {
  const token = await getTokenFromStorage();
  return token;
};

// Set default headers
OpenAPI.HEADERS = {
  'X-API-Version': '2024-01',
  'X-App-ID': 'my-app'
};

// Set request credentials
OpenAPI.WITH_CREDENTIALS = true;
OpenAPI.CREDENTIALS = 'include';

// Custom path encoder
OpenAPI.ENCODE_PATH = (path) => {
  return path.replace(/\s+/g, '-');
};
```

## HTTP Adapter

The HTTP adapter automatically:

1. **Prepends BASE URL** to all requests
2. **Merges headers** from config and request
3. **Adds Authentication** (Bearer token or Basic auth)
4. **Handles FormData** (removes Content-Type for proper boundary)
5. **Sets Credentials** for CORS requests
6. **Encodes paths** with custom encoder if provided
7. **Resolves dynamic values** from async functions

## Content-Type Detection

The parser automatically detects content types from OpenAPI spec and generates appropriate code:

| Content Type | Handling |
|---|---|
| `application/json` | `JSON.stringify(body)` |
| `multipart/form-data` | Create `FormData` and append values, don't set Content-Type header |
| `application/x-www-form-urlencoded` | `URLSearchParams.toString()` |
| Other | Treated as JSON string |

## Error Handling

All requests include error handling:

```typescript
try {
  const result = await coursesService.coursesCreate({
    params: {},
    body: { ... }
  });
} catch (error) {
  console.log(error.message); 
  // "HTTP 400: Bad Request"
  // "HTTP 500: Internal Server Error"
}
```

## Type Safety

All generated services are fully type-safe:

```typescript
// ✅ Type-safe parameters
await coursesService.coursesFindAll({
  params: {
    page: 1, // ✅ number
    limit: "20", // ❌ Error: string not allowed
    search: "TypeScript" // ✅ string
  }
});

// ✅ Type-safe request body
await coursesService.coursesCreate({
  params: {},
  body: {
    title: "...", // ✅ required
    description: "...", // ✅ required
    priceUSD: 99.99, // ✅ required
    priceEGP: 1500, // ✅ required
    tags: [], // ✅ optional, string array
    categoryId: "cat-123" // ❌ Error: not in schema
  }
});

// ✅ Type-safe response
const result: CourseResponseDto = await coursesService.coursesCreate({
  params: {},
  body: { ... }
});
```

## Service Organization

Services are automatically grouped by OpenAPI tags:

```typescript
// Courses-related endpoints
import { coursesService } from './generated/client.js';

// Quiz-related endpoints
import { quizzesService } from './generated/client.js';

// User management
import { usersService } from './generated/client.js';

// Authentication
import { authenticationService } from './generated/client.js';

// 30+ services, all auto-organized!
```
